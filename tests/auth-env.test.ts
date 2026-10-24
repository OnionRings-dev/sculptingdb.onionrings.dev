import { describe, expect, test } from "bun:test"
import { readAuthEnv, ONIONRINGS_ISSUER } from "../src/lib/auth/env.server"

const values = {
  DATABASE_URL: "postgresql://localhost/sculpting_db_test",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-only-independent-secret-at-least-32-characters",
  ONIONRINGS_ISSUER,
  ONIONRINGS_CLIENT_ID: "test-client",
  ONIONRINGS_CLIENT_SECRET: "test-only-client-secret",
}

describe("server environment", () => {
  test("accepts local development and HTTPS production origins", () => {
    expect(readAuthEnv(values).baseURL).toBe("http://localhost:3000")
    expect(
      readAuthEnv({
        ...values,
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://app.example.com",
      }).production
    ).toBe(true)
  })

  test("requires credentials and an independent app secret", () => {
    for (const key of Object.keys(values)) {
      expect(() => readAuthEnv({ ...values, [key]: "" })).toThrow(key)
    }
    expect(() =>
      readAuthEnv({ ...values, BETTER_AUTH_SECRET: "short" })
    ).toThrow("32 characters")
  })

  test("rejects insecure production, non-loopback HTTP and non-origin URLs", () => {
    expect(() => readAuthEnv({ ...values, NODE_ENV: "production" })).toThrow(
      "HTTPS"
    )
    for (const url of [
      "http://app.example.com",
      "https://app.example.com/path",
      "https://app.example.com/?x=1",
      "https://user:password@app.example.com",
      "https://app.example.com/#hash",
    ]) {
      expect(() => readAuthEnv({ ...values, BETTER_AUTH_URL: url })).toThrow(
        "HTTPS origin"
      )
    }
  })

  test("keeps onionrings accounts bound to the exact trusted issuer", () => {
    for (const issuer of [
      "https://other.example.com/api/auth",
      `${ONIONRINGS_ISSUER}/`,
    ]) {
      expect(() =>
        readAuthEnv({ ...values, ONIONRINGS_ISSUER: issuer })
      ).toThrow("issuer bound")
    }
  })

  test("does not expose malformed database URLs in validation errors", () => {
    const secret = "not-a-url-with-a-password"
    try {
      readAuthEnv({ ...values, DATABASE_URL: secret })
      throw new Error("Expected validation to fail")
    } catch (error) {
      expect(String(error)).toContain("DATABASE_URL must be a valid URL")
      expect(String(error)).not.toContain(secret)
    }
  })
})
