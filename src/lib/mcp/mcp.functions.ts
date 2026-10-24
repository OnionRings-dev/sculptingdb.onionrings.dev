import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { z } from "zod"
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { auth, db, requireUser } from "@/lib/auth/auth.server"
import { projectAccess } from "./access.server"
import {
  authorizeProject,
  connectionStatus,
  prepareConnection,
  revokeAuthorization,
} from "./authorization-store.server"
import { MCP_SCOPES, projectMcpResource, resourceProjectId } from "./config"

const requestSchema = z.object({ projectId: z.uuid() })
const oauthQuerySchema = z.object({ oauthQuery: z.string().min(1).max(16_000) })

export const getMcpConnection = createServerFn({ method: "POST" })
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    const origin = new URL(auth.options.baseURL).origin
    const prepared = await prepareConnection(
      db,
      user.id,
      data.projectId,
      origin
    )
    return prepared
      ? {
          ...prepared,
          status: await connectionStatus(db, user.id, data.projectId),
        }
      : null
  })
export const getMcpStatus = createServerFn({ method: "GET" })
  .validator((data: unknown) => requestSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireUser(getRequestHeaders())
    return connectionStatus(db, user.id, data.projectId)
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

async function consentContext(oauthQuery: string) {
  const headers = getRequestHeaders()
  const user = await requireUser(headers)
  const context = await auth.$context
  if (!(await verifyOAuthQueryParams(oauthQuery, context.secret)))
    throw new Error("Authorization request expired or invalid")
  const query = new URLSearchParams(oauthQuery)
  const resources = query.getAll("resource")
  const origin = new URL(auth.options.baseURL).origin
  const projectId =
    resources.length === 1 ? resourceProjectId(origin, resources[0]) : null
  const clientId = query.get("client_id")
  if (!projectId || !clientId) throw new Error("A single project is required")
  const access = await projectAccess(db, user.id, projectId)
  if (!access) throw new Error("Project unavailable")
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
      (scope !== "diagram:write" || access.canEdit)
  )
  return {
    headers,
    user,
    projectId,
    clientId,
    clientName: client.client_name ?? "MCP client",
    projectName: access.name,
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
      resource: projectMcpResource(context.origin, context.projectId),
    }
  })
export const decideMcpConsent = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    oauthQuerySchema.extend({ accept: z.boolean() }).parse(data)
  )
  .handler(async ({ data }) => {
    const context = await consentContext(data.oauthQuery)
    if (
      data.accept &&
      !(await authorizeProject(
        db,
        context.user.id,
        context.projectId,
        context.clientId,
        context.origin
      ))
    )
      throw new Error("Project unavailable")
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
