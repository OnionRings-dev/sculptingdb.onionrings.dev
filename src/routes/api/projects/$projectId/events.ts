import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { db, getCurrentUser } from "@/lib/auth/auth.server"
import { projectEvents } from "@/lib/diagram/events.server"

export const Route = createFileRoute("/api/projects/$projectId/events")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await getCurrentUser(request.headers)
        if (!user) return new Response("Unauthorized", { status: 401 })
        if (!z.uuid().safeParse(params.projectId).success)
          return new Response("Not found", { status: 404 })
        return projectEvents(request, db, user.id, params.projectId)
      },
    },
  },
})
