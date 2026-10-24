import { createFileRoute } from "@tanstack/react-router"
import { auth, db } from "@/lib/auth/auth.server"
import { serveAppMcp } from "@/lib/mcp/server.server"

const handle = ({ request }: { request: Request }) =>
  serveAppMcp(request, db, auth, new URL(auth.options.baseURL).origin)
export const Route = createFileRoute("/api/mcp/")({
  server: { handlers: { POST: handle, GET: handle, DELETE: handle } },
})
