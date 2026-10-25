import { expect, test } from "bun:test"
import { proxyRequest } from "../src/lib/proxy-request"

test("forwarded protocol is ignored unless proxy trust is explicitly enabled", () => {
  const request = new Request("http://sculpting.example/api/mcp", {
    headers: { "X-Forwarded-Proto": "https" },
  })
  expect(proxyRequest(request, false)).toBe(request)
})

test("trusted HTTPS termination preserves host, origin, path, query and body", async () => {
  const request = new Request("http://sculpting.example/api/mcp?key=value", {
    method: "POST",
    headers: {
      Host: "sculpting.example",
      Origin: "https://untrusted.example",
      "X-Forwarded-Host": "untrusted.example",
      "X-Forwarded-Proto": "https",
      Authorization: "Bearer test-token",
    },
    body: "streamed request body",
  })
  const result = proxyRequest(request, true)
  expect(result.url).toBe("https://sculpting.example/api/mcp?key=value")
  expect(result.headers.get("host")).toBe("sculpting.example")
  expect(result.headers.get("origin")).toBe("https://untrusted.example")
  expect(result.headers.get("authorization")).toBe("Bearer test-token")
  expect(result.method).toBe("POST")
  expect(await result.text()).toBe("streamed request body")
})

test("missing, ambiguous and unsupported forwarded protocols are ignored", () => {
  for (const protocol of [undefined, "http", "https, http", "file"]) {
    const request = new Request("http://sculpting.example/api/mcp", {
      headers: protocol ? { "X-Forwarded-Proto": protocol } : {},
    })
    expect(proxyRequest(request, true)).toBe(request)
  }
})
