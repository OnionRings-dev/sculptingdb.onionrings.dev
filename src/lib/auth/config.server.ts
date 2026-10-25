import "@tanstack/react-start/server-only"

import { betterAuth } from "better-auth/minimal"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { genericOAuth } from "better-auth/plugins/generic-oauth"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { jwt } from "better-auth/plugins/jwt"
import { projectOAuthProvider } from "@/lib/mcp/oauth-policy.server"
import type { BetterAuthPlugin } from "better-auth"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type { AuthEnv } from "./env.server"
import * as schema from "@/db/schema"

export function createAppAuth(
  env: AuthEnv,
  database: NodePgDatabase<typeof schema>
) {
  function verifyIssuer(providers: Array<{ id: string; issuer?: string }>) {
    const provider = providers.find(({ id }) => id === "onionrings")
    if (provider && provider.issuer !== env.issuer) {
      throw new APIError("SERVICE_UNAVAILABLE", {
        message: "Identity provider configuration is unavailable",
      })
    }
  }

  // Generic OAuth uses the discovered issuer for verification. Also pin it to
  // our configured issuer, including after a failed discovery is retried.
  const trustedIssuer = {
    id: "onionrings-trusted-issuer",
    init: (context) => {
      verifyIssuer(context.socialProviders)
    },
    hooks: {
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (context) => {
            verifyIssuer(context.context.socialProviders)
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin

  return betterAuth({
    appName: "Sculpting DB",
    baseURL: env.baseURL,
    basePath: "/api/auth",
    secret: env.secret,
    database: drizzleAdapter(database, { provider: "pg", schema }),
    trustedOrigins: [env.baseURL],
    disabledPaths: ["/get-access-token", "/refresh-token", "/token"],
    emailAndPassword: { enabled: false },
    account: {
      accountLinking: { enabled: false, disableImplicitLinking: true },
      encryptOAuthTokens: true,
      storeAccountCookie: false,
      storeStateStrategy: "database",
    },
    session: { cookieCache: { enabled: false } },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: env.production || env.baseURL.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    onAPIError: { errorURL: `${env.baseURL}/?error=sign_in_failed` },
    // Do not emit callback parameters or provider error responses into logs.
    logger: { disabled: true },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "onionrings",
            clientId: env.clientId,
            clientSecret: env.clientSecret,
            discoveryUrl: `${env.issuer}/.well-known/openid-configuration`,
            tokenEndpointAuth: { method: "client_secret_basic" },
            requireIdTokenVerification: true,
            pkce: true,
            scopes: ["openid", "profile", "email"],
            disableProviderLogout: true,
            disableSignUp: false,
            disableImplicitSignUp: false,
            mapProfileToUser: (profile) => ({ name: profile.name ?? "" }),
          },
        ],
      }),
      trustedIssuer,
      jwt({ jwt: { issuer: `${env.baseURL}/api/auth` } }),
      projectOAuthProvider(database, env.baseURL),
      tanstackStartCookies(),
    ],
  })
}
