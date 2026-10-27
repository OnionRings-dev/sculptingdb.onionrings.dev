import "@tanstack/react-start/server-only"

import { eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import * as schema from "@/db/schema"
import { randomUUID } from "node:crypto"
import { decodeJwt } from "jose"
import { z } from "zod"
import {
  APIError,
  addOAuthServerContext,
  createAuthEndpoint,
  createAuthMiddleware,
  formCsrfMiddleware,
  getOAuthState,
  originCheckMiddleware,
} from "better-auth/api"
import { deleteSessionCookie } from "better-auth/cookies"
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto"
import type { GenericEndpointContext } from "@better-auth/core"
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth"
import type { AuthEnv } from "./env.server"

const credentialsSchema = z.object({
  issuer: z.literal("https://auth.onionrings.dev/api/auth"),
  subject: z.string().min(1),
  idToken: z.string().min(1),
  accessToken: z.string().min(1),
  expiresAt: z.number(),
  fence: z.string().min(1),
})

function unavailable() {
  return new APIError("SERVICE_UNAVAILABLE", {
    message: "Identity provider is unavailable. Please retry.",
  })
}

export function onionRingsSessions(
  env: AuthEnv,
  database: NodePgDatabase<typeof schema>
) {
  // These maps contain only this request's verified callback data, never the
  // shared account's latest credentials. Database hooks share this context.
  const pending = new WeakMap<object, string>()
  let metadata:
    { userInfo: string; endSession: string; until: number } | undefined

  async function discovery() {
    if (metadata && metadata.until > Date.now()) return metadata
    try {
      const response = await fetch(
        `${env.issuer}/.well-known/openid-configuration`,
        {
          signal: AbortSignal.timeout(5000),
          redirect: "error",
          cache: "no-store",
        }
      )
      if (!response.ok) throw unavailable()
      const document = await response.json()
      if (document.issuer !== env.issuer) throw unavailable()
      function endpoint(value: unknown) {
        if (typeof value !== "string") throw unavailable()
        const url = new URL(value)
        if (
          url.origin !== new URL(env.issuer).origin ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.hash
        )
          throw unavailable()
        return url.href
      }
      metadata = {
        userInfo: endpoint(document.userinfo_endpoint),
        endSession: endpoint(document.end_session_endpoint),
        until: Date.now() + 300_000,
      }
      return metadata
    } catch {
      throw unavailable()
    }
  }

  const fenceName = "onionrings-login"
  function fenceCookie(ctx: GenericEndpointContext) {
    return ctx.context.createAuthCookie(fenceName, {
      maxAge: 7 * 24 * 60 * 60,
    })
  }
  async function readCredentials(value: unknown) {
    if (typeof value !== "string") return null
    try {
      return credentialsSchema.parse(
        JSON.parse(
          await symmetricDecrypt({
            key: env.secret,
            data: value,
          })
        )
      )
    } catch {
      return null
    }
  }
  async function activeFence(ctx: GenericEndpointContext, fence: string) {
    const record =
      await ctx.context.internalAdapter.findVerificationValue(fence)
    return !!record && record.expiresAt.getTime() > Date.now()
  }

  // Better Auth invokes these hooks only after the OAuth callback has verified
  // state, PKCE, nonce, signature, issuer and audience. Its access token is
  // already encrypted here; its ID token is not. Do not retain plaintext hints
  // in the shared account table either.
  async function capture(
    account: {
      providerId?: string
      idToken?: string | null
      accessToken?: string | null
      accessTokenExpiresAt?: Date | null
    },
    ctx: GenericEndpointContext | null
  ) {
    if (account.providerId !== "onionrings") return
    if (ctx?.path === "/callback/:id" && ctx.params?.id === "onionrings") {
      const fence = (await getOAuthState())?.serverContext?.onionFence
      if (
        !account.idToken ||
        !account.accessToken ||
        !account.accessTokenExpiresAt ||
        typeof fence !== "string"
      )
        throw new APIError("UNAUTHORIZED", { message: "Please sign in again" })
      const claims = decodeJwt(account.idToken) // Verification has already succeeded.
      if (
        claims.iss !== env.issuer ||
        !claims.sub ||
        !(await activeFence(ctx, fence))
      )
        throw new APIError("UNAUTHORIZED", { message: "Sign-in was cancelled" })
      pending.set(
        ctx.context,
        await symmetricEncrypt({
          key: env.secret,
          data: JSON.stringify({
            issuer: claims.iss,
            subject: claims.sub,
            idToken: account.idToken,
            accessToken: await symmetricDecrypt({
              key: env.secret,
              data: account.accessToken,
            }),
            expiresAt: account.accessTokenExpiresAt.getTime(),
            fence,
          }),
        })
      )
    }
    return { data: { ...account, idToken: null } }
  }

  const databaseHooks = {
    account: { create: { before: capture }, update: { before: capture } },
    session: {
      create: {
        before: async (session, ctx) => {
          const encrypted = ctx && pending.get(ctx.context)
          const credentials = await readCredentials(encrypted)
          if (
            !ctx ||
            !credentials ||
            !(await activeFence(ctx, credentials.fence))
          )
            throw new APIError("UNAUTHORIZED", {
              message: "Please sign in again",
            })
          return { data: { ...session, onionCredentials: encrypted } }
        },
      },
    },
  } satisfies BetterAuthOptions["databaseHooks"]

  const plugin = {
    id: "onionrings-sessions",
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/social",
          handler: createAuthMiddleware(async (ctx) => {
            const fence = (await getOAuthState())?.serverContext?.onionFence
            if (typeof fence === "string") {
              const cookie = fenceCookie(ctx)
              await ctx.setSignedCookie(
                cookie.name,
                fence,
                env.secret,
                cookie.attributes
              )
            }
          }),
        },
      ],
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            ctx.setHeader("Cache-Control", "private, no-store")
            if (ctx.path === "/sign-in/social") {
              // Keep the redirect flow as the sole credential acquisition path.
              if (ctx.body?.idToken)
                throw new APIError("BAD_REQUEST", {
                  message: "Use browser sign-in",
                })
              await discovery()
              const cookie = fenceCookie(ctx)
              let fence = await ctx.getSignedCookie(cookie.name, env.secret)
              if (!fence || !(await activeFence(ctx, fence))) {
                fence = `onion-login:${randomUUID()}`
                await ctx.context.internalAdapter.createVerificationValue({
                  identifier: fence,
                  value: "active",
                  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                })
              }
              await addOAuthServerContext({ onionFence: fence })
              return
            }
            if (ctx.path === "/sign-out" || ctx.path.startsWith("/callback/"))
              return
            const token = await ctx.getSignedCookie(
              ctx.context.authCookies.sessionToken.name,
              env.secret
            )
            if (!token) return
            // InternalAdapter.findSession filters returned:false fields, so read
            // this private column through Drizzle instead of a public session API.
            const current = (
              await database
                .select()
                .from(schema.session)
                .where(eq(schema.session.token, token))
            ).at(0)
            if (!current) return
            const credentials = await readCredentials(current.onionCredentials)
            let valid =
              !!credentials &&
              credentials.expiresAt > Date.now() &&
              (await activeFence(ctx, credentials.fence))
            if (valid && credentials) {
              const { userInfo } = await discovery()
              let response: Response
              try {
                response = await fetch(userInfo, {
                  headers: {
                    Authorization: `Bearer ${credentials.accessToken}`,
                  },
                  signal: AbortSignal.timeout(5000),
                  redirect: "error",
                  cache: "no-store",
                })
              } catch {
                throw unavailable()
              }
              if (response.status === 401 || response.status === 403)
                valid = false
              else {
                if (!response.ok) throw unavailable()
                let profile
                try {
                  profile = await response.json()
                } catch {
                  throw unavailable()
                }
                valid =
                  typeof profile?.sub === "string" &&
                  profile.sub === credentials.subject
              }
            }
            if (!valid) {
              await ctx.context.internalAdapter.deleteSession(token)
              deleteSessionCookie(ctx)
              ctx.context.session = null
            }
          }),
        },
      ],
    },
    endpoints: {
      // A supported plugin endpoint override: preserve Better Auth's cookie and
      // CSRF handling, while avoiding its account-wide logout hint lookup.
      signOut: createAuthEndpoint(
        "/sign-out",
        {
          method: "POST",
          requireHeaders: true,
          use: [originCheckMiddleware, formCsrfMiddleware],
          body: z
            .object({
              callbackURL: z.string().optional(),
              disableRedirect: z.boolean().optional(),
              state: z.string().optional(),
            })
            .optional(),
        },
        async (ctx) => {
          const token = await ctx.getSignedCookie(
            ctx.context.authCookies.sessionToken.name,
            env.secret
          )
          const current = token
            ? (
                await database
                  .select()
                  .from(schema.session)
                  .where(eq(schema.session.token, token))
              ).at(0)
            : null
          const credentials = await readCredentials(current?.onionCredentials)
          let url: URL | undefined
          let failed = false
          try {
            const advertised = new URL((await discovery()).endSession)
            const provider = ctx.context.socialProviders.find(
              ({ id }) => id === "onionrings"
            )
            const destination = await provider?.createEndSessionURL?.({
              idToken: credentials?.idToken,
              postLogoutRedirectURI: new URL("/", env.baseURL).href,
            })
            if (!destination) throw unavailable()
            url = new URL(destination.toString())
            if (
              url.origin !== advertised.origin ||
              url.pathname !== advertised.pathname
            )
              throw unavailable()
          } catch {
            failed = true
          }
          // Cancel pending callbacks, including ones whose token exchange is in
          // flight. Their credentials stay unusable even if their cookie arrives late.
          const cookie = fenceCookie(ctx)
          const browserFence = await ctx.getSignedCookie(
            cookie.name,
            env.secret
          )
          for (const fence of new Set([browserFence, credentials?.fence])) {
            if (fence)
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                fence
              )
          }
          if (token) await ctx.context.internalAdapter.deleteSession(token)
          deleteSessionCookie(ctx)
          ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 })
          ctx.setHeader("Cache-Control", "private, no-store")
          ctx.setHeader("Referrer-Policy", "no-referrer")
          if (failed || !url) throw unavailable()
          const redirect = !ctx.body?.disableRedirect
          if (redirect) ctx.setHeader("Location", url.href)
          return ctx.json({ success: true, url: url.href, redirect })
        }
      ),
    },
  } satisfies BetterAuthPlugin

  return { plugin, databaseHooks }
}
