import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { getCurrentUser } from "@/lib/auth/auth.server"
import { requiresBrowserSession } from "@/lib/auth/api-policy"
import { proxyRequest } from "@/lib/proxy-request"

export default createServerEntry({
  async fetch(request, options) {
    request = proxyRequest(request, process.env.TRUST_PROXY === "true")
    let pathname: string
    try {
      // Match Start's URI decoding and case-insensitive route matching.
      pathname = decodeURI(new URL(request.url).pathname).toLowerCase()
    } catch {
      return Response.json({ error: "Invalid request path" }, { status: 400 })
    }
    // Route beforeLoad guards do not authorize API handlers. Protect all app
    // APIs here, except handlers that perform their own OAuth authentication.
    if (requiresBrowserSession(pathname)) {
      let user
      try {
        user = await getCurrentUser(request.headers)
      } catch (error) {
        if (error instanceof Response) return error
        throw error
      }
      if (!user) {
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
