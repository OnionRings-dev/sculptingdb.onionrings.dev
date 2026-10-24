import "@tanstack/react-start/server-only"

export function consentRedirect(request: Request) {
  const source = new URL(request.url)
  const target = new URL("/mcp/consent", source.origin)
  // Preserve the signed query (including repeated parameters) before the
  // frontend router normalizes the query string.
  target.searchParams.set("oauth_query", source.search.slice(1))
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  })
}
