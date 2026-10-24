// MCP bearer authentication and OAuth discovery must work without a browser
// cookie. All other application APIs retain the session guard.
export function requiresBrowserSession(pathname: string) {
  const path = pathname.toLowerCase()
  if (path !== "/api" && !path.startsWith("/api/")) return false
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return false
  if (path === "/api/mcp/consent") return false
  if (path === "/api/mcp" || path === "/api/mcp/") return false
  return !/^\/api\/mcp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/.test(
    path
  )
}
