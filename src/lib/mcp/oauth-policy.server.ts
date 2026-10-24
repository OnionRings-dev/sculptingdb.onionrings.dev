import "@tanstack/react-start/server-only"
import { and, eq, isNull } from "drizzle-orm"
import { APIError } from "better-auth/api"
import { oauthProvider } from "@better-auth/oauth-provider"
import * as schema from "@/db/schema"
import { projectAccess } from "./access.server"
import type { Database } from "./access.server"
import { MCP_SCOPES, resourceProjectId } from "./config"

export function projectOAuthProvider(database: Database, origin: string) {
  return oauthProvider({
    loginPage: "/login",
    consentPage: "/api/mcp/consent",
    scopes: [...MCP_SCOPES],
    grantTypes: ["authorization_code", "refresh_token"],
    // Project resources are provisioned dynamically; each still requires an
    // explicit signed consent and an active project grant before token issuance.
    enforcePerClientResources: false,
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultScopes: [...MCP_SCOPES],
    clientRegistrationAllowedScopes: [...MCP_SCOPES],
    clientRegistrationRequirePKCE: true,
    accessTokenExpiresIn: 15 * 60,
    refreshTokenExpiresIn: 30 * 24 * 60 * 60,
    extensions: [
      {
        claims: {
          accessToken: async ({ user, client, resources, scopes }) => {
            const projectId =
              resources?.length === 1
                ? resourceProjectId(origin, resources[0])
                : null
            if (!user || !projectId)
              throw new APIError("FORBIDDEN", { error: "invalid_target" })
            const access = await projectAccess(database, user.id, projectId)
            const grant = (
              await database
                .select()
                .from(schema.mcpAuthorization)
                .where(
                  and(
                    eq(schema.mcpAuthorization.userId, user.id),
                    eq(schema.mcpAuthorization.clientId, client.clientId),
                    eq(schema.mcpAuthorization.projectId, projectId),
                    isNull(schema.mcpAuthorization.revokedAt)
                  )
                )
            ).at(0)
            if (
              !access ||
              !grant ||
              (scopes.includes("diagram:write") && !access.canEdit)
            ) {
              throw new APIError("FORBIDDEN", {
                error: "access_denied",
                error_description: "Authorize this project again.",
              })
            }
            return {
              mcp_authorization_id: grant.id,
              mcp_authorization_key: grant.key,
            }
          },
        },
      },
    ],
  })
}
