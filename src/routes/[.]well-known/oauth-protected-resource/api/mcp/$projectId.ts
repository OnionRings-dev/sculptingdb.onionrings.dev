import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { auth } from "@/lib/auth/auth.server"
import { protectedResourceMetadata } from "@/lib/mcp/server.server"

export const Route = createFileRoute(
  "/.well-known/oauth-protected-resource/api/mcp/$projectId"
)({
  server: {
    handlers: {
      GET: ({ params }) =>
        z.uuid().safeParse(params.projectId).success
          ? Response.json(
              protectedResourceMetadata(
                new URL(auth.options.baseURL).origin,
                params.projectId
              ),
              { headers: { "Cache-Control": "no-store" } }
            )
          : new Response("Not found", { status: 404 }),
    },
  },
})
