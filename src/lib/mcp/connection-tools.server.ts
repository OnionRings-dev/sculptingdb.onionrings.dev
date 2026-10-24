import "@tanstack/react-start/server-only"
import { and, asc, eq, isNull, or } from "drizzle-orm"
import { z } from "zod"
import * as schema from "@/db/schema"
import type { Database } from "./access.server"
import { activeConnection } from "./access.server"
import { McpOperationError } from "./project-tools.server"
import type { McpPrincipal } from "./project-tools.server"

export const connectionPrincipalSchema = z.object({
  userId: z.string().min(1),
  clientId: z.string().min(1),
  connectionId: z.uuid(),
  connectionKey: z.uuid(),
  canWrite: z.boolean(),
})
export type ConnectionPrincipal = z.infer<typeof connectionPrincipalSchema>

export async function projectPrincipal(
  database: Database,
  principal: ConnectionPrincipal,
  projectId: string
): Promise<McpPrincipal> {
  const grant = (
    await database
      .select()
      .from(schema.mcpAuthorization)
      .where(
        and(
          eq(schema.mcpAuthorization.projectId, projectId),
          eq(schema.mcpAuthorization.userId, principal.userId),
          eq(schema.mcpAuthorization.clientId, principal.clientId),
          isNull(schema.mcpAuthorization.revokedAt)
        )
      )
  ).at(0)
  if (!grant)
    throw new McpOperationError(
      "access_denied",
      "Project unavailable. Enable access for this client in the project's MCP panel."
    )
  return {
    ...principal,
    projectId,
    authorizationId: grant.id,
    authorizationKey: grant.key,
  }
}

export async function listConnectionProjects(
  database: Database,
  principal: ConnectionPrincipal
) {
  return database.transaction(async (tx) => {
    if (
      !(await activeConnection(
        tx,
        principal.userId,
        principal.clientId,
        principal.connectionId,
        principal.connectionKey
      ))
    )
      throw new McpOperationError("access_denied", "Client access was revoked.")
    const { project, workspace, projectMember, mcpAuthorization } = schema
    const rows = await tx
      .select({
        id: project.id,
        name: project.name,
        description: project.description,
        ownerId: workspace.ownerUserId,
        role: projectMember.role,
      })
      .from(mcpAuthorization)
      .innerJoin(project, eq(project.id, mcpAuthorization.projectId))
      .innerJoin(workspace, eq(workspace.id, project.workspaceId))
      .leftJoin(
        projectMember,
        and(
          eq(projectMember.projectId, project.id),
          eq(projectMember.userId, principal.userId)
        )
      )
      .where(
        and(
          eq(mcpAuthorization.userId, principal.userId),
          eq(mcpAuthorization.clientId, principal.clientId),
          isNull(mcpAuthorization.revokedAt),
          or(
            eq(workspace.ownerUserId, principal.userId),
            eq(projectMember.userId, principal.userId)
          )
        )
      )
      .orderBy(asc(project.name), asc(project.id))
    return {
      projects: rows.map(({ ownerId, role, ...projectData }) => ({
        ...projectData,
        canEdit:
          principal.canWrite &&
          (ownerId === principal.userId || role === "edit"),
      })),
    }
  })
}
