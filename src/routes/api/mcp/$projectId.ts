import { createFileRoute } from "@tanstack/react-router"
import { auth, db } from "@/lib/auth/auth.server"
import { serveProjectMcp } from "@/lib/mcp/server.server"

export const Route = createFileRoute("/api/mcp/$projectId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        serveProjectMcp(
          request,
          params.projectId,
          db,
          auth,
          new URL(auth.options.baseURL).origin
        ),
      GET: ({ request, params }) =>
        serveProjectMcp(
          request,
          params.projectId,
          db,
          auth,
          new URL(auth.options.baseURL).origin
        ),
      DELETE: ({ request, params }) =>
        serveProjectMcp(
          request,
          params.projectId,
          db,
          auth,
          new URL(auth.options.baseURL).origin
        ),
    },
  },
})
