import "@tanstack/react-start/server-only"

export function legacyLoginRedirect(request: Request) {
  const { search } = new URL(request.url)
  // Forward the raw query before the router converts repeated OAuth parameters
  // into JSON arrays, which would invalidate the signature.
  return new Response(null, {
    status: 307,
    headers: {
      Location: `/${search}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  })
}
