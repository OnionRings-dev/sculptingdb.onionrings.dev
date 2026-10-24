import { expect, test } from "bun:test"
import { requiresBrowserSession } from "../src/lib/auth/api-policy"

test("only auth and exact project MCP endpoints bypass the API cookie guard", () => {
  const projectId = "77a3fe53-33b7-4a3a-be48-7f7e21de3643"
  for (const path of [
    "/api/auth",
    "/api/auth/oauth2/token",
    "/api/mcp/consent",
    "/api/mcp",
    "/api/mcp/",
    `/api/mcp/${projectId}`,
    `/API/MCP/${projectId.toUpperCase()}/`,
  ])
    expect(requiresBrowserSession(path)).toBe(false)
  for (const path of [
    "/api",
    "/api/projects",
    `/api/projects/${projectId}/events`,
    "/api/mcp/not-a-project",
    `/api/mcp/${projectId}/other`,
    "/api/authentication",
    "/api/mcp/consent/other",
  ])
    expect(requiresBrowserSession(path)).toBe(true)
})
