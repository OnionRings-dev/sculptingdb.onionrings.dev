export function proxyRequest(request: Request, trustProxy: boolean): Request {
  if (!trustProxy || request.headers.get("x-forwarded-proto") !== "https") {
    return request
  }

  // Preserve the original host and Origin header for the app's origin checks.
  const url = new URL(request.url)
  url.protocol = "https:"
  return new Request(url, request)
}
