import { expect, test } from "bun:test"
import { legacyLoginRedirect } from "../src/lib/auth/redirects.server"

test("legacy login forwards to the landing and preserves repeated OAuth parameters verbatim", () => {
  const query =
    "?sig=signed&ba_param=client_id&ba_param=scope&ba_param=state&client_id=qa&scope=diagram%3Aread+offline_access&state=keep%2Bthis&error=access_denied"
  const response = legacyLoginRedirect(
    new Request(`http://localhost:3000/login${query}`)
  )
  expect(response.status).toBe(307)
  expect(response.headers.get("Location")).toBe(`/${query}`)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer")
})

test("legacy login always targets the local landing, including when a return URL is supplied", () => {
  expect(
    legacyLoginRedirect(new Request("http://localhost:3000/login")).headers.get(
      "Location"
    )
  ).toBe("/")
  const response = legacyLoginRedirect(
    new Request(
      "http://localhost:3000/login?redirect=https%3A%2F%2Fexample.test"
    )
  )
  const target = new URL(
    response.headers.get("Location")!,
    "http://localhost:3000"
  )
  expect(target.origin).toBe("http://localhost:3000")
  expect(target.pathname).toBe("/")
})
