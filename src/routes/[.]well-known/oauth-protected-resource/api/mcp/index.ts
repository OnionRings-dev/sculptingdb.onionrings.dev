import { createFileRoute } from "@tanstack/react-router"
import { auth, db } from "@/lib/auth/auth.server"
import { protectedResourceMetadata } from "@/lib/mcp/server.server"
import { prepareAppConnection } from "@/lib/mcp/connection-store.server"

export const Route = createFileRoute(
  "/.well-known/oauth-protected-resource/api/mcp/"
)({
  server: {
    handlers: {
      GET: async () => {
        const origin = new URL(auth.options.baseURL).origin
        await prepareAppConnection(db, origin)
        return Response.json(protectedResourceMetadata(origin), {
          headers: { "Cache-Control": "no-store" },
        })
      },
    },
  },
})
