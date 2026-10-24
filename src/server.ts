import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { getCurrentUser } from "@/lib/auth/auth.server"

export default createServerEntry({
  async fetch(request, options) {
    let pathname: string
    try {
      // Match Start's URI decoding and case-insensitive route matching.
      pathname = decodeURI(new URL(request.url).pathname).toLowerCase()
    } catch {
      return Response.json({ error: "Invalid request path" }, { status: 400 })
    }
    const authEndpoint =
      pathname === "/api/auth" || pathname.startsWith("/api/auth/")

    // Route beforeLoad guards do not authorize API handlers. Protect all app
    // APIs here, leaving Better Auth's own handler publicly reachable.
    if (
      (pathname === "/api" || pathname.startsWith("/api/")) &&
      !authEndpoint
    ) {
      if (!(await getCurrentUser(request.headers))) {
        return Response.json(
          { error: "Unauthorized" },
          {
            status: 401,
            headers: { "Cache-Control": "private, no-store" },
          }
        )
      }
    }

    const response = await handler.fetch(request, options)
    response.headers.set("Cache-Control", "private, no-store")
    return response
  },
})
