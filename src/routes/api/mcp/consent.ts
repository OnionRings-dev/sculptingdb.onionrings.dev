import { createFileRoute } from "@tanstack/react-router"
import { consentRedirect } from "@/lib/mcp/consent-redirect.server"

export const Route = createFileRoute("/api/mcp/consent")({
  server: { handlers: { GET: ({ request }) => consentRedirect(request) } },
})
