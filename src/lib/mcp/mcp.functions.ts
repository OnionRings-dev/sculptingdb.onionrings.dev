import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { z } from "zod"
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { auth, db, requireUser } from "@/lib/auth/auth.server"
import { projectAccess } from "./access.server"
import {
  authorizeProject,
  revokeAuthorization,
} from "./authorization-store.server"
import {
  MCP_SCOPES,
  appMcpResource,
  projectMcpResource,
  resourceProjectId,
} from "./config"

import {
  authorizeConnection,
  disconnectClient,
  prepareAppConnection,
  projectConnectionStatus,
  setClientProjectAccess,
} from "./connection-store.server"

const requestSchema = z.object({ projectId: z.uuid() })
const oauthQuerySchema = z.object({ oauthQuery: z.string().min(1).max(16_000) })

export const getMcpConnection = createServerFn({ method: "POST" })
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    const origin = new URL(auth.options.baseURL).origin
    if (!(await projectAccess(db, user.id, data.projectId))) return null
    return {
      resource: await prepareAppConnection(db, origin),
      status: await projectConnectionStatus(db, user.id, data.projectId),
    }
  })
export const getMcpStatus = createServerFn({ method: "GET" })
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return projectConnectionStatus(db, user.id, data.projectId)
  })
export const disconnectMcp = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    requestSchema.extend({ authorizationId: z.uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return revokeAuthorization(
      db,
      user.id,
      data.projectId,
      data.authorizationId,
      new URL(auth.options.baseURL).origin
    )
  })

export const setMcpProjectAccess = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    requestSchema
      .extend({ connectionId: z.uuid(), enabled: z.boolean() })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return setClientProjectAccess(
      db,
      user.id,
      data.projectId,
      data.connectionId,
      data.enabled
    )
  })
export const disconnectMcpClient = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ connectionId: z.uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return disconnectClient(
      db,
      user.id,
      data.connectionId,
      new URL(auth.options.baseURL).origin
    )
  })

async function consentContext(oauthQuery: string) {
  const headers = getRequestHeaders()
  const user = await requireUser(headers)
  const context = await auth.$context
  if (!(await verifyOAuthQueryParams(oauthQuery, context.secret)))
    throw new Error("Authorization request expired or invalid")
  const query = new URLSearchParams(oauthQuery)
  const resources = query.getAll("resource")
  const origin = new URL(auth.options.baseURL).origin
  const appConnection =
    resources.length === 1 && resources[0] === appMcpResource(origin)
  const projectId =
    resources.length === 1 ? resourceProjectId(origin, resources[0]) : null
  const clientId = query.get("client_id")
  if ((!appConnection && !projectId) || !clientId)
    throw new Error("Invalid MCP resource")
  const access = projectId ? await projectAccess(db, user.id, projectId) : null
  if (projectId && !access) throw new Error("Project unavailable")
  const client = await auth.api.getOAuthClientPublic({
    headers,
    query: { client_id: clientId },
  })
  const requestedScopes = (query.get("scope") ?? MCP_SCOPES.join(" ")).split(
    " "
  )
  if (!requestedScopes.includes("diagram:read"))
    throw new Error("Diagram read access is required")
  const scopes = requestedScopes.filter(
    (scope) =>
      MCP_SCOPES.some((allowed) => allowed === scope) &&
      (scope !== "diagram:write" || appConnection || access?.canEdit)
  )
  return {
    headers,
    user,
    projectId,
    clientId,
    clientName: client.client_name ?? "MCP client",
    projectName: access?.name ?? null,
    appConnection,
    scopes,
    origin,
  }
}

export const getMcpConsent = createServerFn({ method: "GET" })
  .validator((data: unknown) => oauthQuerySchema.parse(data))
  .handler(async ({ data }) => {
    const context = await consentContext(data.oauthQuery)
    return {
      projectName: context.projectName,
      clientName: context.clientName,
      canWrite: context.scopes.includes("diagram:write"),
      resource: context.projectId
        ? projectMcpResource(context.origin, context.projectId)
        : appMcpResource(context.origin),
    }
  })
export const decideMcpConsent = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    oauthQuerySchema.extend({ accept: z.boolean() }).parse(data)
  )
  .handler(async ({ data }) => {
    const context = await consentContext(data.oauthQuery)
    if (data.accept) {
      const granted = context.appConnection
        ? await authorizeConnection(
            db,
            context.user.id,
            context.clientId,
            context.origin
          )
        : context.projectId &&
          (await authorizeProject(
            db,
            context.user.id,
            context.projectId,
            context.clientId,
            context.origin
          ))
      if (!granted) throw new Error("Authorization unavailable")
    }
    const response = await auth.handler(
      new Request(`${context.origin}/api/auth/oauth2/consent`, {
        method: "POST",
        headers: {
          Cookie: context.headers.get("cookie") ?? "",
          Origin: context.origin,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accept: data.accept,
          scope: context.scopes.join(" "),
          oauth_query: data.oauthQuery,
        }),
      })
    )
    const location = response.headers.get("location")
    if (response.status >= 300 && response.status < 400 && location)
      return { url: location }
    const result = (await response.json()) as { url?: string; error?: string }
    if (!response.ok || !result.url)
      throw new Error("OAuth authorization could not be completed")
    return { url: result.url }
  })
