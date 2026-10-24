import "@tanstack/react-start/server-only"

// Keep this provider ID bound to one issuer for the lifetime of stored accounts.
export const ONIONRINGS_ISSUER = "https://auth.onionrings.dev/api/auth"

export function readAuthEnv(values: NodeJS.ProcessEnv) {
  function required(name: string) {
    const value = values[name]?.trim()
    if (!value)
      throw new Error(`Missing required server environment variable: ${name}`)
    return value
  }

  function parseURL(value: string, name: string) {
    try {
      return new URL(value)
    } catch {
      throw new Error(`${name} must be a valid URL`)
    }
  }

  const baseURL = required("BETTER_AUTH_URL")
  const origin = parseURL(baseURL, "BETTER_AUTH_URL")
  const production = values.NODE_ENV === "production"
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)

  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" &&
      (origin.protocol !== "http:" || !loopback || production))
  ) {
    throw new Error(
      "BETTER_AUTH_URL must be an HTTPS origin (HTTP loopback is allowed in development)"
    )
  }

  const secret = required("BETTER_AUTH_SECRET")
  if (secret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters")

  const issuer = required("ONIONRINGS_ISSUER")
  if (issuer !== ONIONRINGS_ISSUER) {
    throw new Error(
      "ONIONRINGS_ISSUER must match the issuer bound to the onionrings provider"
    )
  }

  const databaseURL = required("DATABASE_URL")
  if (
    !["postgres:", "postgresql:"].includes(
      parseURL(databaseURL, "DATABASE_URL").protocol
    )
  ) {
    throw new Error("DATABASE_URL must use PostgreSQL")
  }

  return {
    baseURL: origin.origin,
    secret,
    issuer,
    clientId: required("ONIONRINGS_CLIENT_ID"),
    clientSecret: required("ONIONRINGS_CLIENT_SECRET"),
    databaseURL,
    production,
  }
}

export type AuthEnv = ReturnType<typeof readAuthEnv>
