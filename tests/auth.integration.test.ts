import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose"
import { createAppAuth } from "../src/lib/auth/config.server"
import { ONIONRINGS_ISSUER } from "../src/lib/auth/env.server"
import * as schema from "../src/db/schema"
import { eq } from "drizzle-orm"
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto"
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { createUntitledProject } from "../src/lib/projects/project-store.server"
import { prepareConnection } from "../src/lib/mcp/authorization-store.server"
import { mcpLoginCallback } from "../src/lib/mcp/login"

const databaseURL = process.env.TEST_DATABASE_URL
const baseURL = "http://localhost:3000"
const clientId = "integration-test-client"
const clientSecret = randomBytes(32).toString("hex")
const originalFetch = globalThis.fetch

type Authorization = {
  nonce: string
  challenge: string
  subject: string
  email: string
  emailVerified?: boolean
  invalidNonce?: boolean
  sso?: string
  invalidSignature?: boolean
}

describe.skipIf(!databaseURL)(
  "Better Auth with PostgreSQL and a simulated OIDC provider",
  () => {
    const pool = new Pool({ connectionString: databaseURL })
    const db = drizzle(pool, { schema })
    let auth: ReturnType<typeof createAppAuth>
    let keys: Awaited<ReturnType<typeof generateKeyPair>>
    let jwk: Awaited<ReturnType<typeof exportJWK>>
    let discoveryIssuer = ONIONRINGS_ISSUER
    let discoveryAvailable = true
    const authorizations = new Map<string, Authorization>()
    let exchanges = 0
    let userInfoStatus = 200
    let wrongSubject = false
    let networkFailure = false
    let endSessionEndpoint = `${ONIONRINGS_ISSUER}/oauth2/end-session`
    const accessTokens = new Map<
      string,
      { subject: string; sso: string; revoked: boolean }
    >()

    async function mockFetch(
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> {
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (url.origin !== "https://auth.onionrings.dev")
        throw new Error("Unexpected network request in auth test")

      if (url.pathname.endsWith("/.well-known/openid-configuration")) {
        if (!discoveryAvailable)
          return Response.json({ error: "unavailable" }, { status: 503 })
        return Response.json({
          issuer: discoveryIssuer,
          authorization_endpoint: `${ONIONRINGS_ISSUER}/oauth2/authorize`,
          token_endpoint: `${ONIONRINGS_ISSUER}/oauth2/token`,
          userinfo_endpoint: `${ONIONRINGS_ISSUER}/oauth2/userinfo`,
          jwks_uri: `${ONIONRINGS_ISSUER}/jwks`,
          end_session_endpoint: endSessionEndpoint,
          id_token_signing_alg_values_supported: ["EdDSA"],
        })
      }
      if (url.pathname.endsWith("/oauth2/userinfo")) {
        if (networkFailure) throw new TypeError("Simulated network failure")
        const token = request.headers.get("authorization")?.slice(7) ?? ""
        const record = accessTokens.get(token)
        if (!record || record.revoked) return Response.json({}, { status: 401 })
        if (userInfoStatus !== 200)
          return Response.json({}, { status: userInfoStatus })
        return Response.json({
          sub: wrongSubject ? "another-subject" : record.subject,
        })
      }
      if (url.pathname.endsWith("/oauth2/end-session")) {
        const hint = decodeJwt(url.searchParams.get("id_token_hint")!)
        for (const record of accessTokens.values())
          if (record.sso === hint.sid) record.revoked = true
        return Response.redirect(
          url.searchParams.get("post_logout_redirect_uri")!
        )
      }
      if (url.pathname.endsWith("/jwks")) return Response.json({ keys: [jwk] })
      if (!url.pathname.endsWith("/oauth2/token"))
        throw new Error("Unexpected OIDC endpoint")

      const body = new URLSearchParams(await request.text())
      const authorization = authorizations.get(body.get("code") ?? "")
      if (!authorization)
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      authorizations.delete(body.get("code")!)
      exchanges++

      expect(request.headers.get("authorization")).toBe(
        `Basic ${btoa(`${clientId}:${clientSecret}`)}`
      )
      expect(body.get("client_secret")).toBeNull()
      expect(body.get("grant_type")).toBe("authorization_code")
      expect(body.get("redirect_uri")).toBe(
        `${baseURL}/api/auth/callback/onionrings`
      )
      const verifier = body.get("code_verifier")!
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier)
      )
      expect(Buffer.from(digest).toString("base64url")).toBe(
        authorization.challenge
      )

      const signingKey = authorization.invalidSignature
        ? (await generateKeyPair("EdDSA")).privateKey
        : keys.privateKey
      const idToken = await new SignJWT({
        sid: authorization.sso ?? "browser-one",
        email: authorization.email,
        email_verified: authorization.emailVerified ?? true,
        nonce: authorization.invalidNonce ? "wrong-nonce" : authorization.nonce,
        // Missing name/image are valid optional profile attributes.
      })
        .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
        .setIssuer(ONIONRINGS_ISSUER)
        .setAudience(clientId)
        .setSubject(authorization.subject)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(signingKey)

      const accessToken = `test-access-token-${randomBytes(16).toString("hex")}`
      accessTokens.set(accessToken, {
        subject: authorization.subject,
        sso: authorization.sso ?? "browser-one",
        revoked: false,
      })
      return Response.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken,
      })
    }

    function createAuth() {
      return createAppAuth(
        {
          baseURL,
          secret: "integration-test-app-secret-at-least-32-characters",
          issuer: ONIONRINGS_ISSUER,
          clientId,
          clientSecret,
          databaseURL: databaseURL!,
          production: false,
        },
        db
      )
    }

    function cookies(response: Response) {
      return response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; ")
    }

    async function begin(oauthQuery?: string) {
      const errorQuery = new URLSearchParams(oauthQuery ?? "")
      errorQuery.set("error", "sign_in_failed")
      const response = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: baseURL },
          body: JSON.stringify({
            provider: "onionrings",
            callbackURL: mcpLoginCallback(oauthQuery ?? ""),
            errorCallbackURL: `/?${errorQuery}`,
            oauth_query: oauthQuery,
          }),
        })
      )
      expect(response.status).toBe(200)
      const { url } = (await response.json()) as { url: string }
      const authorizationURL = new URL(url)
      expect(authorizationURL.origin + authorizationURL.pathname).toBe(
        `${ONIONRINGS_ISSUER}/oauth2/authorize`
      )
      expect(
        authorizationURL.searchParams.get("scope")?.split(" ").sort()
      ).toEqual(["email", "openid", "profile"])
      expect(authorizationURL.searchParams.get("code_challenge_method")).toBe(
        "S256"
      )
      expect(authorizationURL.searchParams.get("nonce")).toBeTruthy()
      return { authorizationURL, cookie: cookies(response) }
    }

    async function complete(
      subject: string,
      email: string,
      options: Partial<Authorization> = {},
      oauthQuery?: string
    ) {
      const { authorizationURL, cookie } = await begin(oauthQuery)
      const code = randomBytes(16).toString("hex")
      authorizations.set(code, {
        nonce: authorizationURL.searchParams.get("nonce")!,
        challenge: authorizationURL.searchParams.get("code_challenge")!,
        subject,
        email,
        ...options,
      })
      const url = new URL(`${baseURL}/api/auth/callback/onionrings`)
      url.searchParams.set("state", authorizationURL.searchParams.get("state")!)
      url.searchParams.set("code", code)
      url.searchParams.set("iss", ONIONRINGS_ISSUER)
      return auth.handler(new Request(url, { headers: { Cookie: cookie } }))
    }

    beforeAll(async () => {
      if (!new URL(databaseURL!).pathname.endsWith("_test"))
        throw new Error(
          "TEST_DATABASE_URL must point to a disposable database ending in _test"
        )
      await migrate(db, { migrationsFolder: "./drizzle" })
      await pool.query(
        'TRUNCATE "verification", "session", "account", "user" CASCADE'
      )
      keys = await generateKeyPair("EdDSA", { extractable: true })
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: "test-key",
        alg: "EdDSA",
        use: "sig",
      }
      globalThis.fetch = mockFetch as typeof fetch
      auth = createAuth()
      await auth.$context
    })

    afterAll(async () => {
      globalThis.fetch = originalFetch
      if (databaseURL && new URL(databaseURL).pathname.endsWith("_test")) {
        await pool.query(
          'TRUNCATE "verification", "session", "account", "user" CASCADE'
        )
      }
      await pool.end()
    })

    test("anonymous requests have no application session", async () => {
      expect(await auth.api.getSession({ headers: new Headers() })).toBeNull()
    })

    test("first login encrypts session-specific credentials and prepares provider logout", async () => {
      const response = await complete("subject-one", "first@example.com")
      expect(response.status).toBe(302)
      expect(new URL(response.headers.get("location")!, baseURL).pathname).toBe(
        "/"
      )
      const cookie = cookies(response)
      const headers = new Headers({ Cookie: cookie })
      const session = await auth.api.getSession({ headers })
      expect(session?.user.email).toBe("first@example.com")
      expect(session?.user.emailVerified).toBe(true)
      const [account] = await db.select().from(schema.account)
      expect(account.accountId).toBe("subject-one")
      expect(account.providerId).toBe("onionrings")
      expect(account.accessToken).not.toStartWith("test-access-token")
      expect(account.idToken).toBeNull()
      const [stored] = await db
        .select()
        .from(schema.session)
        .where(eq(schema.session.id, session!.session.id))
      expect(stored.onionCredentials).toBeTruthy()
      expect(stored.onionCredentials).not.toContain("test-access-token")
      expect(stored.onionCredentials).not.toContain("subject-one")
      expect(JSON.stringify(session)).not.toContain("onionCredentials")
      expect(JSON.stringify(session)).not.toContain("test-access-token")
      expect(cookie).not.toContain("test-access-token")
      const sessionCookie = response.headers
        .getSetCookie()
        .find((value) => value.includes("session_token"))!
      expect(sessionCookie).toContain("HttpOnly")
      expect(sessionCookie).toContain("SameSite=Lax")

      const logoutResponse = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: baseURL,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      )
      expect(logoutResponse.status).toBe(200)
      const logoutURL = new URL(logoutResponse.headers.get("location")!)
      expect(logoutURL.origin + logoutURL.pathname).toBe(
        `${ONIONRINGS_ISSUER}/oauth2/end-session`
      )
      expect(logoutURL.searchParams.get("post_logout_redirect_uri")).toBe(
        `${baseURL}/`
      )
      expect(decodeJwt(logoutURL.searchParams.get("id_token_hint")!).sub).toBe(
        "subject-one"
      )
      expect(await auth.api.getSession({ headers })).toBeNull()
    })

    test("the subject recognizes returning users even when the email changes", async () => {
      const response = await complete("subject-one", "renamed@example.com")
      expect(new URL(response.headers.get("location")!, baseURL).pathname).toBe(
        "/"
      )
      expect(await db.select().from(schema.user)).toHaveLength(1)
      expect(await db.select().from(schema.account)).toHaveLength(1)
    })

    test("a matching email never implicitly links a different external subject", async () => {
      const response = await complete("different-subject", "first@example.com")
      expect(new URL(response.headers.get("location")!, baseURL).pathname).toBe(
        "/"
      )
      expect(await db.select().from(schema.account)).toHaveLength(1)
      expect(cookies(response)).not.toContain("session_token")
    })

    test("preserves the provider's unverified-email attribute", async () => {
      const response = await complete(
        "unverified-subject",
        "unverified@example.com",
        { emailVerified: false }
      )
      const session = await auth.api.getSession({
        headers: new Headers({ Cookie: cookies(response) }),
      })
      expect(session?.user.emailVerified).toBe(false)
    })

    test("rejects forged signatures and incorrect nonce without creating accounts", async () => {
      const accountsBefore = await db.select().from(schema.account)
      for (const options of [
        { invalidSignature: true },
        { invalidNonce: true },
      ]) {
        const response = await complete(
          "invalid-subject",
          "invalid@example.com",
          options
        )
        expect(
          new URL(response.headers.get("location")!, baseURL).pathname
        ).toBe("/")
        expect(cookies(response)).not.toContain("session_token")
      }
      expect(await db.select().from(schema.account)).toHaveLength(
        accountsBefore.length
      )
    })

    test("consent denial returns to the landing without exchanging a code", async () => {
      const { authorizationURL, cookie } = await begin()
      const count = exchanges
      const url = new URL(`${baseURL}/api/auth/callback/onionrings`)
      url.searchParams.set("state", authorizationURL.searchParams.get("state")!)
      url.searchParams.set("error", "access_denied")
      const response = await auth.handler(
        new Request(url, { headers: { Cookie: cookie } })
      )
      expect(new URL(response.headers.get("location")!, baseURL).pathname).toBe(
        "/"
      )
      expect(exchanges).toBe(count)
    })

    test("invalid and expired transactions fail without a token exchange", async () => {
      const count = exchanges
      const invalid = await auth.handler(
        new Request(
          `${baseURL}/api/auth/callback/onionrings?state=unknown&code=invalid`
        )
      )
      expect(new URL(invalid.headers.get("location")!, baseURL).pathname).toBe(
        "/"
      )

      const { authorizationURL, cookie } = await begin()
      await pool.query(
        'UPDATE "verification" SET "expires_at" = NOW() - INTERVAL \'1 hour\''
      )
      const url = new URL(`${baseURL}/api/auth/callback/onionrings`)
      url.searchParams.set("state", authorizationURL.searchParams.get("state")!)
      url.searchParams.set("code", "expired")
      const expired = await auth.handler(
        new Request(url, { headers: { Cookie: cookie } })
      )
      expect(new URL(expired.headers.get("location")!, baseURL).pathname).toBe(
        "/"
      )
      expect(exchanges).toBe(count)
    })

    test("rejects external final destinations", async () => {
      const response = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: baseURL },
          body: JSON.stringify({
            provider: "onionrings",
            callbackURL: "https://attacker.example.com",
          }),
        })
      )
      expect(response.status).toBe(403)
    })

    test("rejects cross-origin requests with cookies and does not expose provider-token APIs", async () => {
      const response = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://attacker.example.com",
            "Sec-Fetch-Site": "cross-site",
            Cookie: "better-auth.session_token=invalid-session",
          },
          body: JSON.stringify({ provider: "onionrings", callbackURL: "/" }),
        })
      )
      expect(response.status).toBe(403)
      for (const path of ["get-access-token", "refresh-token"]) {
        const disabled = await auth.handler(
          new Request(`${baseURL}/api/auth/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: baseURL },
            body: "{}",
          })
        )
        expect(disabled.status).toBe(404)
      }
    })

    test("a discovery outage fails sign-in recoverably and a retry still pins the issuer", async () => {
      discoveryAvailable = false
      const unavailable = createAuth()
      await unavailable.$context
      const response = await unavailable.handler(
        new Request(`${baseURL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: baseURL },
          body: JSON.stringify({ provider: "onionrings", callbackURL: "/" }),
        })
      )
      expect(response.status).toBeGreaterThanOrEqual(400)
      discoveryAvailable = true
      discoveryIssuer = "https://unexpected.example.com/api/auth"
      const retried = await unavailable.handler(
        new Request(`${baseURL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: baseURL },
          body: JSON.stringify({ provider: "onionrings", callbackURL: "/" }),
        })
      )
      expect(retried.status).toBe(503)
      discoveryIssuer = ONIONRINGS_ISSUER
    })

    test("rejects discovery metadata with a different issuer at initialization", async () => {
      discoveryIssuer = "https://unexpected.example.com/api/auth"
      try {
        await expect(createAuth().$context).rejects.toThrow(
          "Identity provider configuration is unavailable"
        )
      } finally {
        discoveryIssuer = ONIONRINGS_ISSUER
      }
    })

    async function logout(cookie: string, body: Record<string, unknown> = {}) {
      return auth.handler(
        new Request(`${baseURL}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: baseURL,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        })
      )
    }

    test("concurrent same-account logins retain distinct hints; SSO revokes peers and preserves another device", async () => {
      const [a, b, other] = await Promise.all([
        complete("subject-one", "first@example.com", { sso: "shared-browser" }),
        complete("subject-one", "first@example.com", { sso: "shared-browser" }),
        complete("subject-one", "first@example.com", { sso: "other-device" }),
      ])
      const headersA = new Headers({ Cookie: cookies(a) })
      const headersB = new Headers({ Cookie: cookies(b) })
      const headersOther = new Headers({ Cookie: cookies(other) })
      const original = await auth.api.getSession({ headers: headersA })
      const binding = (
        await db
          .select()
          .from(schema.session)
          .where(eq(schema.session.id, original!.session.id))
      )[0].onionCredentials
      const response = await logout(cookies(a), {
        callbackURL: "/unregistered?return=evil",
        disableRedirect: true,
        state: "untrusted",
      })
      expect(response.status).toBe(200)
      expect(response.headers.get("location")).toBeNull()
      const url = new URL((await response.json()).url)
      expect(decodeJwt(url.searchParams.get("id_token_hint")!).sid).toBe(
        "shared-browser"
      )
      expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
        `${baseURL}/`
      )
      expect(url.searchParams.has("state")).toBe(false)
      expect(await auth.api.getSession({ headers: headersA })).toBeNull()
      const providerReturn = await mockFetch(url)
      expect(providerReturn.headers.get("location")).toBe(`${baseURL}/`)
      const revoked = await auth.handler(
        new Request(`${baseURL}/api/auth/get-session`, { headers: headersB })
      )
      expect(await revoked.json()).toBeNull()
      expect(
        revoked.headers
          .getSetCookie()
          .some(
            (value) =>
              value.includes("session_token=") && value.includes("Max-Age=0")
          )
      ).toBe(true)
      expect(
        await auth.api.getSession({ headers: headersOther })
      ).not.toBeNull()
      expect(binding).toBeTruthy()
    })

    test("central/admin revocation, forbidden tokens and subject mismatch invalidate only the matching session", async () => {
      for (const mode of ["admin", "forbidden", "subject"]) {
        const response = await complete("subject-one", "first@example.com", {
          sso: `central-${mode}`,
        })
        const headers = new Headers({ Cookie: cookies(response) })
        const session = await auth.api.getSession({ headers })
        if (mode === "admin")
          for (const record of accessTokens.values()) {
            if (record.sso === `central-${mode}`) record.revoked = true
          }
        userInfoStatus = mode === "forbidden" ? 403 : 200
        wrongSubject = mode === "subject"
        try {
          if (mode === "admin") {
            const protectedCheck = await auth.handler(
              new Request(`${baseURL}/api/auth/list-sessions`, { headers })
            )
            expect(protectedCheck.status).toBe(401)
          }
          expect(await auth.api.getSession({ headers })).toBeNull()
          expect(
            await db
              .select()
              .from(schema.session)
              .where(eq(schema.session.id, session!.session.id))
          ).toHaveLength(0)
        } finally {
          userInfoStatus = 200
          wrongSubject = false
        }
      }
    })

    test("provider outages deny public and server session checks without deleting credentials", async () => {
      const response = await complete("subject-one", "first@example.com")
      const headers = new Headers({ Cookie: cookies(response) })
      const session = await auth.api.getSession({ headers })
      userInfoStatus = 503
      try {
        const publicCheck = await auth.handler(
          new Request(`${baseURL}/api/auth/get-session`, { headers })
        )
        expect(publicCheck.status).toBe(503)
        networkFailure = true
        const timeoutCheck = await auth.handler(
          new Request(`${baseURL}/api/auth/get-session`, { headers })
        )
        expect(timeoutCheck.status).toBe(503)
        networkFailure = false
        await expect(auth.api.getSession({ headers })).rejects.toMatchObject({
          statusCode: 503,
        })
        expect(
          await db
            .select()
            .from(schema.session)
            .where(eq(schema.session.id, session!.session.id))
        ).toHaveLength(1)
      } finally {
        userInfoStatus = 200
        networkFailure = false
      }
      expect(await auth.api.getSession({ headers })).not.toBeNull()
    })

    test("old unbound sessions require reauthentication and cannot borrow account tokens", async () => {
      const response = await complete("subject-one", "first@example.com")
      const headers = new Headers({ Cookie: cookies(response) })
      const session = await auth.api.getSession({ headers })
      await db
        .update(schema.session)
        .set({ onionCredentials: null })
        .where(eq(schema.session.id, session!.session.id))
      expect(await auth.api.getSession({ headers })).toBeNull()
    })

    test("expired provider tokens require fresh authentication without a refresh grant", async () => {
      const response = await complete("subject-one", "first@example.com")
      const headers = new Headers({ Cookie: cookies(response) })
      const session = await auth.api.getSession({ headers })
      const row = (
        await db
          .select()
          .from(schema.session)
          .where(eq(schema.session.id, session!.session.id))
      )[0]
      const credentials = JSON.parse(
        await symmetricDecrypt({
          key: "integration-test-app-secret-at-least-32-characters",
          data: row.onionCredentials!,
        })
      )
      credentials.expiresAt = Date.now() - 1
      await db
        .update(schema.session)
        .set({
          onionCredentials: await symmetricEncrypt({
            key: "integration-test-app-secret-at-least-32-characters",
            data: JSON.stringify(credentials),
          }),
        })
        .where(eq(schema.session.id, row.id))
      expect(await auth.api.getSession({ headers })).toBeNull()
    })

    test("logout follows the trusted advertised endpoint and rejects insecure discovery destinations", async () => {
      const previous = auth
      try {
        endSessionEndpoint = `${ONIONRINGS_ISSUER}/advertised-logout`
        auth = createAuth()
        const response = await complete("subject-one", "first@example.com")
        const result = await logout(cookies(response), {
          disableRedirect: true,
        })
        const url = new URL((await result.json()).url)
        expect(url.origin + url.pathname).toBe(endSessionEndpoint)
        for (const endpoint of [
          "http://auth.onionrings.dev/logout",
          "https://attacker.example/logout",
        ]) {
          endSessionEndpoint = endpoint
          auth = createAuth()
          const denied = await auth.handler(
            new Request(`${baseURL}/api/auth/sign-in/social`, {
              method: "POST",
              headers: { Origin: baseURL, "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: "onionrings",
                callbackURL: "/",
              }),
            })
          )
          expect(denied.status).toBe(503)
        }
      } finally {
        auth = previous
        endSessionEndpoint = `${ONIONRINGS_ISSUER}/oauth2/end-session`
      }
    })

    test("sign-out cancels an already started sign-in transaction", async () => {
      const { authorizationURL, cookie } = await begin()
      const code = randomBytes(16).toString("hex")
      authorizations.set(code, {
        nonce: authorizationURL.searchParams.get("nonce")!,
        challenge: authorizationURL.searchParams.get("code_challenge")!,
        subject: "subject-one",
        email: "first@example.com",
      })
      expect((await logout(cookie)).status).toBe(200)
      const callback = new URL(`${baseURL}/api/auth/callback/onionrings`)
      callback.searchParams.set(
        "state",
        authorizationURL.searchParams.get("state")!
      )
      callback.searchParams.set("code", code)
      const response = await auth.handler(
        new Request(callback, { headers: { Cookie: cookie } })
      )
      expect(cookies(response)).not.toContain("session_token")
      expect(
        await auth.api.getSession({
          headers: new Headers({ Cookie: cookies(response) }),
        })
      ).toBeNull()
    })

    test("cross-origin logout is rejected before changing the session", async () => {
      const response = await complete("subject-one", "first@example.com")
      const cookie = cookies(response)
      const denied = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "https://attacker.example.com",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      )
      expect(denied.status).toBe(403)
      expect(
        await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) })
      ).not.toBeNull()
    })

    test("an anonymous MCP authorization resumes after the external identity-provider login", async () => {
      const initial = await complete("mcp-owner", "mcp-owner@example.test")
      const owner = await auth.api.getSession({
        headers: new Headers({ Cookie: cookies(initial) }),
      })
      const project = await createUntitledProject(db, owner!.user.id)
      const prepared = await prepareConnection(
        db,
        owner!.user.id,
        project.id,
        baseURL
      )
      const registered = await auth.handler(
        new Request(`${baseURL}/api/auth/oauth2/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_name: "MCP login test",
            redirect_uris: ["http://127.0.0.1:59999/callback"],
            token_endpoint_auth_method: "none",
            application_type: "native",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          }),
        })
      )
      expect(registered.status).toBe(201)
      const client = (await registered.json()) as { client_id: string }
      try {
        const query = new URLSearchParams({
          client_id: client.client_id,
          response_type: "code",
          redirect_uri: "http://127.0.0.1:59999/callback",
          scope: "diagram:read diagram:write offline_access",
          resource: prepared!.resource,
          state: "mcp-login-state",
          code_challenge: randomBytes(32).toString("base64url"),
          code_challenge_method: "S256",
        })
        const anonymous = await auth.handler(
          new Request(`${baseURL}/api/auth/oauth2/authorize?${query}`, {
            headers: { Accept: "text/html" },
          })
        )
        const login = new URL(anonymous.headers.get("location")!, baseURL)
        expect(login.pathname).toBe("/")
        const signed = login.search.slice(1)
        expect(
          await verifyOAuthQueryParams(
            signed,
            "integration-test-app-secret-at-least-32-characters"
          )
        ).toBe(true)
        const attempt = await begin(signed)
        const deniedURL = new URL(`${baseURL}/api/auth/callback/onionrings`)
        deniedURL.searchParams.set(
          "state",
          attempt.authorizationURL.searchParams.get("state")!
        )
        deniedURL.searchParams.set("error", "access_denied")
        const denied = await auth.handler(
          new Request(deniedURL, { headers: { Cookie: attempt.cookie } })
        )
        const recovery = new URL(denied.headers.get("location")!, baseURL)
        expect(recovery.pathname).toBe("/")
        expect(recovery.searchParams.get("sig")).toBe(
          login.searchParams.get("sig")
        )
        expect(recovery.searchParams.has("error")).toBe(true)
        const callback = new URL(mcpLoginCallback(recovery.search), baseURL)
        expect(callback.pathname).toBe("/api/auth/oauth2/authorize")
        expect(callback.searchParams.get("state")).toBe("mcp-login-state")
        expect(callback.searchParams.has("error")).toBe(false)
        let response = await complete(
          "mcp-owner",
          "mcp-owner@example.test",
          {},
          signed
        )
        const cookie = cookies(response)
        let destination = new URL(response.headers.get("location")!, baseURL)
        for (
          let i = 0;
          i < 3 && destination.pathname.startsWith("/api/auth/");
          i++
        ) {
          response = await auth.handler(
            new Request(destination, {
              headers: { Cookie: cookie, Accept: "text/html" },
            })
          )
          destination = new URL(response.headers.get("location")!, baseURL)
        }
        expect(destination.pathname).toBe("/api/mcp/consent")
        expect(destination.searchParams.get("resource")).toBe(
          prepared!.resource
        )
        expect(destination.searchParams.get("state")).toBe("mcp-login-state")
        expect(
          await verifyOAuthQueryParams(
            destination.search.slice(1),
            "integration-test-app-secret-at-least-32-characters"
          )
        ).toBe(true)
      } finally {
        await db
          .delete(schema.oauthClient)
          .where(eq(schema.oauthClient.clientId, client.client_id))
        await db
          .delete(schema.oauthResource)
          .where(eq(schema.oauthResource.identifier, prepared!.resource))
      }
    })
  }
)
