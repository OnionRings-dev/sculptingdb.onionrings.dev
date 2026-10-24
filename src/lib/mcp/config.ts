export const MCP_SCOPES = [
  "diagram:read",
  "diagram:write",
  "offline_access",
] as const
export const LEASE_DURATION_MS = 10 * 60_000
export const MCP_PATH = "/api/mcp"
export const MCP_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp"
export const appMcpResource = (origin: string) => `${origin}${MCP_PATH}`
export const projectMcpPath = (projectId: string) => `/api/mcp/${projectId}`
export const projectMcpResource = (origin: string, projectId: string) =>
  `${origin}${projectMcpPath(projectId)}`
export const projectMetadataPath = (projectId: string) =>
  `/.well-known/oauth-protected-resource/api/mcp/${projectId}`

export function resourceProjectId(
  origin: string,
  resource: string
): string | null {
  try {
    const url = new URL(resource)
    if (
      url.origin !== origin ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return null
    return (
      /^\/api\/mcp\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.exec(
        url.pathname
      )?.[1] ?? null
    )
  } catch {
    return null
  }
}
