import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { randomBytes, randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"
import { makeSignature } from "better-auth/crypto"
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import * as schema from "../src/db/schema"
import { createAppAuth } from "../src/lib/auth/config.server"
import { ONIONRINGS_ISSUER } from "../src/lib/auth/env.server"
import { createUntitledProject } from "../src/lib/projects/project-store.server"
import {
  removeProjectMember,
  updateProjectMember,
} from "../src/lib/projects/sharing-store.server"
import {
  changeDiagram,
  loadDiagram,
} from "../src/lib/diagram/diagram-store.server"
import { projectEvents } from "../src/lib/diagram/events.server"
import {
  authorizeProject,
  prepareConnection,
  revokeAuthorization,
} from "../src/lib/mcp/authorization-store.server"
import {
  protectedResourceMetadata,
  serveProjectMcp,
  serveAppMcp,
} from "../src/lib/mcp/server.server"
import { appMcpResource, projectMcpResource } from "../src/lib/mcp/config"
import { consentRedirect } from "../src/lib/mcp/consent-redirect.server"

import {
  authorizeConnection,
  disconnectClient,
  prepareAppConnection,
  projectConnectionStatus,
  setClientProjectAccess,
} from "../src/lib/mcp/connection-store.server"

const databaseURL = process.env.TEST_DATABASE_URL
const appSecret = "integration-test-app-secret-at-least-32-characters"
const originalFetch = globalThis.fetch

describe.skipIf(!databaseURL)("project MCP, OAuth and live updates", () => {
  const pool = new Pool({ connectionString: databaseURL })
  const db = drizzle(pool, { schema })
  const ownerId = randomUUID(),
    memberId = randomUUID(),
    strangerId = randomUUID()
  const userIds = [ownerId, memberId, strangerId]
  let auth: ReturnType<typeof createAppAuth>
  let server: ReturnType<typeof Bun.serve>
  let origin: string, projectId: string, otherId: string
  const cookies = new Map<string, string>()
  const clients: Array<string> = []
  const resources: Array<string> = []
  const connected: Array<Client> = []

  beforeAll(async () => {
    if (!new URL(databaseURL!).pathname.endsWith("_test"))
      throw new Error("Use a disposable _test database")
    await migrate(db, { migrationsFolder: "./drizzle" })
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const request = new Request(input, init)
      if (new URL(request.url).origin === "https://auth.onionrings.dev")
        return Response.json({
          issuer: ONIONRINGS_ISSUER,
          authorization_endpoint: `${ONIONRINGS_ISSUER}/oauth2/authorize`,
          token_endpoint: `${ONIONRINGS_ISSUER}/oauth2/token`,
          jwks_uri: `${ONIONRINGS_ISSUER}/jwks`,
        })
      return originalFetch(input, init)
    }) as typeof fetch
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => {
        const path = new URL(request.url).pathname
        if (path.startsWith("/api/auth/")) return auth.handler(request)
        if (path === "/api/mcp") return serveAppMcp(request, db, auth, origin)
        if (path === "/.well-known/oauth-protected-resource/api/mcp")
          return Response.json(protectedResourceMetadata(origin))
        const id = path.split("/").pop()!
        if (path.startsWith("/.well-known/oauth-protected-resource/api/mcp/"))
          return Response.json(protectedResourceMetadata(origin, id))
        if (path.startsWith("/api/mcp/"))
          return serveProjectMcp(request, id, db, auth, origin)
        return new Response("Not found", { status: 404 })
      },
    })
    origin = server.url.origin
    auth = createAppAuth(
      {
        baseURL: origin,
        secret: appSecret,
        issuer: ONIONRINGS_ISSUER,
        clientId: "test",
        clientSecret: "test-only-provider-secret",
        production: false,
        databaseURL: databaseURL!,
      },
      db
    )
    await auth.$context
  })
  beforeEach(async () => {
    await db.insert(schema.user).values(
      userIds.map((id, index) => ({
        id,
        name: ["Owner", "Member", "Stranger"][index],
        email: `${id}@example.test`,
      }))
    )
    for (const id of userIds) {
      const sessionToken = randomBytes(32).toString("hex")
      await db.insert(schema.session).values({
        id: randomUUID(),
        userId: id,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 3600_000),
      })
      cookies.set(
        id,
        `better-auth.session_token=${encodeURIComponent(`${sessionToken}.${await makeSignature(sessionToken, appSecret)}`)}`
      )
      expect(
        (
          await auth.api.getSession({
            headers: new Headers({ Cookie: cookies.get(id)! }),
          })
        )?.user.id
      ).toBe(id)
    }
    projectId = (await createUntitledProject(db, ownerId)).id
    otherId = (await createUntitledProject(db, ownerId)).id
    await db
      .insert(schema.projectMember)
      .values({ projectId, userId: memberId, role: "edit" })
    resources.push(await prepareAppConnection(db, origin))
    for (const id of [projectId, otherId]) {
      const prepared = await prepareConnection(db, ownerId, id, origin)
      expect(prepared).not.toBeNull()
      resources.push(projectMcpResource(origin, id))
    }
  })
  afterEach(async () => {
    await Promise.all(connected.splice(0).map((client) => client.close()))
    await db.delete(schema.user).where(inArray(schema.user.id, userIds))
    if (clients.length)
      await db
        .delete(schema.oauthClient)
        .where(inArray(schema.oauthClient.clientId, clients.splice(0)))
    if (resources.length)
      await db
        .delete(schema.oauthResource)
        .where(inArray(schema.oauthResource.identifier, resources.splice(0)))
    cookies.clear()
  })
  afterAll(async () => {
    globalThis.fetch = originalFetch
    server.stop(true)
    await pool.end()
  })

  async function register(name = "Codex integration") {
    const result = await fetch(`${origin}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [`${origin}/callback`],
        token_endpoint_auth_method: "none",
        application_type: "native",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    })
    expect(result.status).toBe(201)
    const client = (await result.json()) as { client_id: string }
    clients.push(client.client_id)
    return client.client_id
  }
  async function authorization(
    clientId: string,
    userId = ownerId,
    resource = projectMcpResource(origin, projectId),
    scopes = "diagram:read diagram:write offline_access"
  ) {
    const verifier = randomBytes(32).toString("base64url")
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    )
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${origin}/callback`,
      response_type: "code",
      prompt: "consent",
      scope: scopes,
      resource,
      state: randomUUID(),
      code_challenge: Buffer.from(digest).toString("base64url"),
      code_challenge_method: "S256",
    })
    const response = await fetch(
      `${origin}/api/auth/oauth2/authorize?${query}`,
      {
        headers: { Cookie: cookies.get(userId)!, Accept: "text/html" },
        redirect: "manual",
      }
    )
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get("location")!, origin)
    if (location.pathname !== "/api/mcp/consent")
      throw new Error(
        `${location.searchParams.get("error")}: ${location.searchParams.get("error_description")}`
      )
    const oauthQuery = location.search.slice(1)
    expect(await verifyOAuthQueryParams(oauthQuery, appSecret)).toBe(true)
    const wrapped = consentRedirect(new Request(location))
    const preserved = new URL(
      wrapped.headers.get("location")!
    ).searchParams.get("oauth_query")!
    expect(preserved).toBe(oauthQuery)
    expect(await verifyOAuthQueryParams(preserved, appSecret)).toBe(true)
    return { verifier, oauthQuery }
  }
  async function consent(
    clientId: string,
    userId: string,
    oauthQuery: string,
    accept: boolean,
    scopes = "diagram:read diagram:write offline_access"
  ) {
    if (accept) {
      if (
        new URLSearchParams(oauthQuery).get("resource") ===
        appMcpResource(origin)
      )
        await authorizeConnection(db, userId, clientId, origin)
      else await authorizeProject(db, userId, projectId, clientId, origin)
    }
    const response = await fetch(`${origin}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: {
        Cookie: cookies.get(userId)!,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accept, oauth_query: oauthQuery, scope: scopes }),
    })
    expect(response.status).toBe(200)
    const result = (await response.json()) as { url: string }
    return new URL(result.url)
  }
  async function token(
    clientId: string,
    code: string,
    verifier: string,
    resource = projectMcpResource(origin, projectId)
  ) {
    return fetch(`${origin}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: `${origin}/callback`,
        resource,
      }),
    })
  }
  async function connect(
    mode: "legacy" | "modern" = "modern",
    userId = ownerId,
    scopes?: string,
    app = false
  ) {
    const clientId = await register(mode === "legacy" ? "Codex" : "OpenCode")
    const resource = app
      ? appMcpResource(origin)
      : projectMcpResource(origin, projectId)
    const request = await authorization(clientId, userId, resource, scopes)
    const redirect = await consent(
      clientId,
      userId,
      request.oauthQuery,
      true,
      scopes
    )
    expect(redirect.searchParams.get("iss")).toBe(`${origin}/api/auth`)
    const response = await token(
      clientId,
      redirect.searchParams.get("code")!,
      request.verifier,
      resource
    )
    expect(response.status).toBe(200)
    const tokens = (await response.json()) as {
      access_token: string
      refresh_token: string
    }
    const client = new Client(
      {
        name: mode === "modern" ? "OpenCode" : "Codex",
        version: "integration",
      },
      {
        versionNegotiation: {
          mode: mode === "modern" ? { pin: "2026-07-28" } : "legacy",
        },
      }
    )
    await client.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      })
    )
    connected.push(client)
    return { client, clientId, tokens }
  }
  async function call(
    client: Client,
    name: string,
    args: Record<string, unknown> = {}
  ) {
    const result = await client.callTool({ name, arguments: args })
    return {
      error: result.isError === true,
      data: result.structuredContent as Record<string, unknown>,
    }
  }
  async function connectionId(clientId: string, userId = ownerId) {
    const found = (
      await db
        .select()
        .from(schema.mcpConnection)
        .where(eq(schema.mcpConnection.clientId, clientId))
    ).find((row) => row.userId === userId)!
    return found.id
  }
  for (const mode of ["modern", "legacy"] as const)
    test(`one app connection serves multiple opt-in projects with ${mode} protocol`, async () => {
      const { client, clientId, tokens } = await connect(
        mode,
        ownerId,
        undefined,
        true
      )
      const id = await connectionId(clientId)
      expect(
        (await client.listTools()).tools.map((tool) => tool.name)
      ).toContain("list_projects")
      expect((await call(client, "list_projects")).data.projects).toEqual([])
      expect(
        (await call(client, "open_project", { projectId })).data.code
      ).toBe("access_denied")
      expect(
        await setClientProjectAccess(db, ownerId, projectId, id, true)
      ).toBe(true)
      expect((await call(client, "list_projects")).data.projects).toEqual([
        expect.objectContaining({ id: projectId, canEdit: true }),
      ])
      const first = await call(client, "open_project", { projectId })
      expect(first.error).toBe(false)
      const leaseId = first.data.leaseId
      expect(
        (await call(client, "open_project", { projectId: otherId })).data.code
      ).toBe("access_denied")
      expect(await setClientProjectAccess(db, ownerId, otherId, id, true)).toBe(
        true
      )
      const second = await call(client, "open_project", { projectId: otherId })
      expect(second.error).toBe(false)
      expect(
        (await call(client, "get_diagram", { projectId: otherId, leaseId }))
          .data.code
      ).toBe("lease_expired")
      const change = await call(client, "apply_changes", {
        projectId,
        leaseId,
        requestId: randomUUID(),
        expectedRevision: 0,
        summary: "App connection edit",
        changes: [{ type: "upsert_entity", entity: entity(), attributes: [] }],
      })
      expect(change.error).toBe(false)
      expect((await loadDiagram(db, ownerId, otherId))!.revision).toBe(0)
      expect((await loadDiagram(db, ownerId, projectId))!.revision).toBe(2)
      expect(
        (await call(client, "list_history", { projectId, leaseId })).data
          .history
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ revision: 2, origin: "mcp" }),
        ])
      )
      expect(
        (
          await call(client, "restore_revision", {
            projectId,
            leaseId,
            requestId: randomUUID(),
            expectedRevision: 2,
            revision: 1,
          })
        ).data.revision
      ).toBe(3)
      const renewed = await fetch(`${origin}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refresh_token,
          resource: appMcpResource(origin),
        }),
      })
      expect(renewed.status).toBe(200)

      expect(
        await setClientProjectAccess(db, ownerId, projectId, id, false)
      ).toBe(true)
      expect(
        (await call(client, "get_diagram", { projectId, leaseId })).data.code
      ).toBe("access_denied")
      expect((await call(client, "list_projects")).data.projects).toEqual([
        expect.objectContaining({ id: otherId }),
      ])
      expect(
        (
          await call(client, "get_diagram", {
            projectId: otherId,
            leaseId: second.data.leaseId,
          })
        ).error
      ).toBe(false)
      expect(
        await setClientProjectAccess(db, ownerId, projectId, id, true)
      ).toBe(true)
      const reopened = await call(client, "open_project", { projectId })
      expect(reopened.data.leaseId).not.toBe(leaseId)
      const wrongAudience = await fetch(projectMcpResource(origin, projectId), {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      expect(wrongAudience.status).toBe(401)
      expect(await disconnectClient(db, strangerId, id, origin)).toBe(false)
      expect(await disconnectClient(db, ownerId, id, origin)).toBe(true)
      const revoked = await fetch(appMcpResource(origin), {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      expect(revoked.status).toBe(401)
      expect(
        await db
          .select()
          .from(schema.projectMcpLease)
          .where(eq(schema.projectMcpLease.userId, ownerId))
      ).toHaveLength(0)
      const refreshed = await fetch(`${origin}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refresh_token,
          resource: appMcpResource(origin),
        }),
      })
      expect(refreshed.status).toBeGreaterThanOrEqual(400)
    })

  test("a read-only app token cannot write even when its owner can edit the enabled project", async () => {
    const { client, clientId } = await connect(
      "modern",
      ownerId,
      "diagram:read offline_access",
      true
    )
    expect(
      await setClientProjectAccess(
        db,
        ownerId,
        projectId,
        await connectionId(clientId),
        true
      )
    ).toBe(true)
    expect((await call(client, "list_projects")).data.projects).toEqual([
      expect.objectContaining({ id: projectId, canEdit: false }),
    ])
    const opened = await call(client, "open_project", { projectId })
    expect(opened.data.canEdit).toBe(false)
    expect(
      (
        await call(client, "apply_changes", {
          projectId,
          leaseId: opened.data.leaseId,
          requestId: randomUUID(),
          expectedRevision: 0,
          summary: "Denied",
          changes: [
            { type: "upsert_entity", entity: entity(), attributes: [] },
          ],
        })
      ).data.code
    ).toBe("read_only")
  })

  test("project toggles are per client and owners cannot grant clients belonging to other users", async () => {
    const first = await connect("modern", ownerId, undefined, true)
    const second = await connect("modern", ownerId, undefined, true)
    const firstId = await connectionId(first.clientId),
      secondId = await connectionId(second.clientId)
    expect(
      await setClientProjectAccess(db, strangerId, projectId, firstId, true)
    ).toBe(false)
    expect(
      await setClientProjectAccess(db, ownerId, projectId, firstId, true)
    ).toBe(true)
    const status = await projectConnectionStatus(db, ownerId, projectId)
    expect(
      status!.clients.map((row) => ({ id: row.id, enabled: row.enabled }))
    ).toEqual(
      expect.arrayContaining([
        { id: firstId, enabled: true },
        { id: secondId, enabled: false },
      ])
    )
    expect((await call(second.client, "list_projects")).data.projects).toEqual(
      []
    )
    const member = await connect("modern", memberId, undefined, true)
    const memberConnection = await connectionId(member.clientId, memberId)
    expect(
      await setClientProjectAccess(
        db,
        ownerId,
        projectId,
        memberConnection,
        true
      )
    ).toBe(false)
    expect(
      await setClientProjectAccess(
        db,
        memberId,
        projectId,
        memberConnection,
        true
      )
    ).toBe(true)
    expect(
      (await projectConnectionStatus(db, ownerId, projectId))!.clients.some(
        (row) => row.id === memberConnection && !row.isOwn
      )
    ).toBe(true)
    expect(
      (await projectConnectionStatus(db, memberId, projectId))!.clients.some(
        (row) => row.id === firstId
      )
    ).toBe(false)
    expect(
      await setClientProjectAccess(
        db,
        ownerId,
        projectId,
        memberConnection,
        false
      )
    ).toBe(true)
    expect((await call(member.client, "list_projects")).data.projects).toEqual(
      []
    )
    expect(await disconnectClient(db, ownerId, memberConnection, origin)).toBe(
      false
    )
  })

  test("an app token respects View/Edit changes and membership removal without revoking its other projects", async () => {
    const connectedMember = await connect("modern", memberId, undefined, true)
    const id = await connectionId(connectedMember.clientId, memberId)
    expect(
      await setClientProjectAccess(db, memberId, projectId, id, true)
    ).toBe(true)
    const ownedProjectId = (await createUntitledProject(db, memberId)).id
    expect(
      await setClientProjectAccess(db, memberId, ownedProjectId, id, true)
    ).toBe(true)
    const opened = await call(connectedMember.client, "open_project", {
      projectId,
    })
    const leaseId = opened.data.leaseId
    await updateProjectMember(db, ownerId, {
      projectId,
      userId: memberId,
      role: "view",
    })
    expect(
      (
        await call(connectedMember.client, "get_diagram", {
          projectId,
          leaseId,
        })
      ).data.canEdit
    ).toBe(false)
    expect(
      (
        await call(connectedMember.client, "apply_changes", {
          projectId,
          leaseId,
          requestId: randomUUID(),
          expectedRevision: 0,
          summary: "Denied",
          changes: [
            { type: "upsert_entity", entity: entity(), attributes: [] },
          ],
        })
      ).data.code
    ).toBe("read_only")
    await removeProjectMember(db, ownerId, { projectId, userId: memberId })
    expect(
      (await call(connectedMember.client, "list_projects")).data.projects
    ).toEqual([expect.objectContaining({ id: ownedProjectId })])
    expect(
      (await call(connectedMember.client, "open_project", { projectId })).data
        .code
    ).toBe("access_denied")
    expect(
      await setClientProjectAccess(db, memberId, projectId, id, true)
    ).toBe(false)
    expect((await connectedMember.client.listTools()).tools).toHaveLength(7)
  })

  const entity = () => ({
    id: randomUUID(),
    name: "Customer",
    description: null,
    positionX: 0,
    positionY: 0,
  })

  test("anonymous discovery challenges name the project resource and OAuth issues only consented audience-bound tokens", async () => {
    const resource = projectMcpResource(origin, projectId)
    const response = await fetch(resource, { method: "POST" })
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource/api/mcp/"
    )
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="diagram:read diagram:write offline_access"'
    )
    const metadata = protectedResourceMetadata(origin, projectId)
    expect(metadata.resource).toBe(resource)
    expect(metadata.authorization_servers).toEqual([`${origin}/api/auth`])
    const clientId = await register()
    const request = await authorization(clientId)
    expect(
      await verifyOAuthQueryParams(
        request.oauthQuery.replace("diagram%3Awrite", "diagram%3Aadmin"),
        appSecret
      )
    ).toBe(false)
    const denied = await consent(clientId, ownerId, request.oauthQuery, false)
    expect(denied.searchParams.get("error")).toBe("access_denied")
    expect(
      await db
        .select()
        .from(schema.mcpAuthorization)
        .where(eq(schema.mcpAuthorization.projectId, projectId))
    ).toHaveLength(0)
    const permitted = await connect()
    const wrongResource = await fetch(projectMcpResource(origin, otherId), {
      method: "POST",
      headers: { Authorization: `Bearer ${permitted.tokens.access_token}` },
    })
    expect(wrongResource.status).toBe(401)
    const wrongOrigin = await fetch(resource, {
      method: "POST",
      headers: {
        Origin: "https://untrusted.example",
        Authorization: `Bearer ${permitted.tokens.access_token}`,
      },
    })
    expect(wrongOrigin.status).toBe(403)
  })

  test("authorization codes enforce PKCE and single use; refresh keeps the project audience", async () => {
    const clientId = await register()
    const request = await authorization(clientId)
    const redirect = await consent(clientId, ownerId, request.oauthQuery, true)
    const code = redirect.searchParams.get("code")!
    expect(
      (await token(clientId, code, randomBytes(32).toString("base64url")))
        .status
    ).toBeGreaterThanOrEqual(400)
    // A failed verifier may consume the code; use a new authorization request.
    const fresh = await authorization(clientId)
    const approved = await consent(clientId, ownerId, fresh.oauthQuery, true)
    const freshCode = approved.searchParams.get("code")!
    const exchanged = await token(clientId, freshCode, fresh.verifier)
    expect(exchanged.status).toBe(200)
    const credentials = (await exchanged.json()) as { refresh_token: string }
    const renewed = await fetch(`${origin}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: credentials.refresh_token,
        resource: projectMcpResource(origin, projectId),
      }),
    })
    expect(renewed.status).toBe(200)
    const refreshed = (await renewed.json()) as { access_token: string }
    const headers = {
      Authorization: `Bearer ${refreshed.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }
    expect(
      (
        await fetch(projectMcpResource(origin, otherId), {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        })
      ).status
    ).toBe(401)
    expect(
      (
        await fetch(projectMcpResource(origin, projectId), {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        })
      ).status
    ).toBe(200)
    expect(
      (await token(clientId, freshCode, fresh.verifier)).status
    ).toBeGreaterThanOrEqual(400)
  })

  for (const mode of ["modern", "legacy"] as const)
    test(`${mode} clients discover tools and apply one atomic, retry-safe batch`, async () => {
      const { client } = await connect(mode)
      expect(
        (await client.listTools()).tools.map((tool) => tool.name).sort()
      ).toEqual([
        "apply_changes",
        "get_diagram",
        "list_history",
        "open_project",
        "release_project",
        "restore_revision",
      ])
      const opened = await call(client, "open_project")
      expect(opened.error).toBe(false)
      const leaseId = opened.data.leaseId
      const customer = entity(),
        order = { ...entity(), name: "Order", positionX: 300 }
      const args = {
        leaseId,
        requestId: randomUUID(),
        expectedRevision: 0,
        summary: "Model orders and customers",
        changes: [
          { type: "upsert_entity", entity: customer, attributes: [] },
          { type: "upsert_entity", entity: order, attributes: [] },
          {
            type: "upsert_relationship",
            relationship: {
              id: randomUUID(),
              sourceEntityId: customer.id,
              targetEntityId: order.id,
              sourceCardinality: "one",
              targetCardinality: "zero_or_many",
              label: "places",
              description: null,
            },
          },
        ],
      }
      const saved = await call(client, "apply_changes", args)
      expect(saved).toMatchObject({
        error: false,
        data: { revision: 2, replayed: false },
      })
      expect(await call(client, "apply_changes", args)).toMatchObject({
        error: false,
        data: { revision: 2, replayed: true },
      })
      expect(
        await call(client, "apply_changes", {
          ...args,
          summary: "Different request",
        })
      ).toMatchObject({ error: true, data: { code: "request_id_reused" } })
      const data = (await loadDiagram(db, ownerId, projectId))!
      expect(data.snapshot.entities).toHaveLength(2)
      expect(data.snapshot.relationships).toHaveLength(1)
      expect(data.history).toHaveLength(2)
      expect(data.history[0]).toMatchObject({
        origin: "mcp",
        actorName: "Owner",
        summary: args.summary,
      })
      expect(
        (await call(client, "list_history", { leaseId })).data.history
      ).toHaveLength(2)
      expect(
        await call(client, "restore_revision", {
          leaseId,
          requestId: randomUUID(),
          expectedRevision: 2,
          revision: 1,
        })
      ).toMatchObject({ error: false, data: { revision: 3 } })
      expect(
        (await loadDiagram(db, ownerId, projectId))?.snapshot.entities
      ).toHaveLength(0)
      expect(await call(client, "release_project", { leaseId })).toMatchObject({
        error: false,
        data: { released: true },
      })
      expect(await call(client, "get_diagram", { leaseId })).toMatchObject({
        error: true,
        data: { code: "lease_expired" },
      })
    })

  test("conflicting manual edits and an invalid batch cannot overwrite graph or history", async () => {
    const { client } = await connect()
    const { leaseId } = (await call(client, "open_project")).data
    const customer = entity()
    await changeDiagram(db, ownerId, {
      projectId,
      expectedRevision: 0,
      command: { type: "upsert_entity", entity: customer, attributes: [] },
    })
    const before = await loadDiagram(db, ownerId, projectId)
    expect(
      await call(client, "apply_changes", {
        leaseId,
        requestId: randomUUID(),
        expectedRevision: 0,
        summary: "Stale",
        changes: [
          {
            type: "delete_selection",
            entityIds: [customer.id],
            relationshipIds: [],
          },
        ],
      })
    ).toMatchObject({ error: true, data: { code: "conflict", revision: 2 } })
    const newEntity = entity()
    expect(
      (
        await call(client, "apply_changes", {
          leaseId,
          requestId: randomUUID(),
          expectedRevision: 2,
          summary: "Invalid",
          changes: [
            { type: "upsert_entity", entity: newEntity, attributes: [] },
            {
              type: "move_entities",
              positions: [{ id: randomUUID(), x: 0, y: 0 }],
            },
          ],
        })
      ).error
    ).toBe(true)
    expect(await loadDiagram(db, ownerId, projectId)).toEqual(before)
  })

  test("only one authorization holds a lease and stale clients cannot release a successor", async () => {
    const first = await connect(),
      second = await connect("legacy")
    const { leaseId } = (await call(first.client, "open_project")).data
    expect(await call(second.client, "open_project")).toMatchObject({
      error: true,
      data: { code: "project_busy" },
    })
    await db
      .update(schema.projectMcpLease)
      .set({
        acquiredAt: new Date(Date.now() - 20_000),
        expiresAt: new Date(Date.now() - 10_000),
      })
      .where(eq(schema.projectMcpLease.projectId, projectId))
    const successor = await call(second.client, "open_project")
    expect(successor.error).toBe(false)
    expect(successor.data.leaseId).not.toBe(leaseId)
    expect(
      (await call(first.client, "release_project", { leaseId })).error
    ).toBe(true)
    expect(
      (
        await call(second.client, "get_diagram", {
          leaseId: successor.data.leaseId,
        })
      ).error
    ).toBe(false)
  })

  test("View grants, permission changes and membership revocation are enforced per operation", async () => {
    const reader = await connect(
      "modern",
      memberId,
      "diagram:read offline_access"
    )
    const { leaseId } = (await call(reader.client, "open_project")).data
    expect((await call(reader.client, "get_diagram", { leaseId })).error).toBe(
      false
    )
    expect(
      await call(reader.client, "apply_changes", {
        leaseId,
        expectedRevision: 0,
        requestId: randomUUID(),
        summary: "Forbidden",
        changes: [{ type: "upsert_entity", entity: entity(), attributes: [] }],
      })
    ).toMatchObject({ error: true, data: { code: "read_only" } })
    await updateProjectMember(db, ownerId, {
      projectId,
      userId: memberId,
      role: "view",
    })
    expect((await call(reader.client, "get_diagram", { leaseId })).error).toBe(
      false
    )
    await removeProjectMember(db, ownerId, { projectId, userId: memberId })
    expect(
      (
        await fetch(projectMcpResource(origin, projectId), {
          method: "POST",
          headers: { Authorization: `Bearer ${reader.tokens.access_token}` },
        })
      ).status
    ).toBe(401)
    expect(
      await db
        .select()
        .from(schema.projectMcpLease)
        .where(eq(schema.projectMcpLease.projectId, projectId))
    ).toHaveLength(0)
  })

  test("explicit revocation rejects access and refresh tokens without revoking another client's authorization", async () => {
    const first = await connect(),
      second = await connect("legacy")
    const { leaseId } = (await call(first.client, "open_project")).data
    const grant = (
      await db
        .select()
        .from(schema.mcpAuthorization)
        .where(eq(schema.mcpAuthorization.clientId, first.clientId))
    )[0]
    expect(
      await revokeAuthorization(db, strangerId, projectId, grant.id, origin)
    ).toBe(false)
    expect(
      await revokeAuthorization(db, ownerId, projectId, grant.id, origin)
    ).toBe(true)
    expect(
      (
        await fetch(projectMcpResource(origin, projectId), {
          method: "POST",
          headers: { Authorization: `Bearer ${first.tokens.access_token}` },
        })
      ).status
    ).toBe(401)
    const refresh = await fetch(`${origin}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: first.clientId,
        refresh_token: first.tokens.refresh_token,
        resource: projectMcpResource(origin, projectId),
      }),
    })
    expect(refresh.status).not.toBe(200)
    expect((await call(second.client, "open_project")).error).toBe(false)
    expect(
      (
        await db
          .select()
          .from(schema.projectMcpLease)
          .where(eq(schema.projectMcpLease.projectId, projectId))
      )[0].leaseId
    ).not.toBe(leaseId)
  })

  test("SSE detects committed revisions and stops when project access is revoked", async () => {
    const controller = new AbortController()
    const response = await projectEvents(
      new Request(`${origin}/events`, { signal: controller.signal }),
      db,
      memberId,
      projectId
    )
    const reader = response.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('"revision":0')
    await changeDiagram(db, ownerId, {
      projectId,
      expectedRevision: 0,
      command: { type: "upsert_entity", entity: entity(), attributes: [] },
    })
    const next = new TextDecoder().decode((await reader.read()).value)
    expect(next).toContain('"revision":2')
    await removeProjectMember(db, ownerId, { projectId, userId: memberId })
    const revoked = new TextDecoder().decode((await reader.read()).value)
    expect(revoked).toContain("event: revoked")
    expect((await reader.read()).done).toBe(true)
    controller.abort()
  })
})
