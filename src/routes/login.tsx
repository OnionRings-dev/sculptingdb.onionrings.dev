import { createFileRoute, redirect } from "@tanstack/react-router"
import { legacyLoginRedirect } from "@/lib/auth/redirects.server"

// Keep old bookmarks and in-flight OAuth callbacks working without a login UI.
export const Route = createFileRoute("/login")({
  server: { handlers: { GET: ({ request }) => legacyLoginRedirect(request) } },
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/${location.searchStr}`,
      replace: true,
      reloadDocument: true,
    })
  },
})
