import "@tanstack/react-start/server-only"
import { and, eq, or } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import * as schema from "@/db/schema"

export type Database = NodePgDatabase<typeof schema>
export type Executor = Pick<Database, "select" | "insert" | "update" | "delete">

export async function projectAccess(
  executor: Executor,
  userId: string,
  projectId: string
) {
  const { project, workspace, projectMember, diagram } = schema
  const rows = await executor
    .select({
      id: project.id,
      name: project.name,
      ownerId: workspace.ownerUserId,
      role: projectMember.role,
      revision: diagram.revision,
      updatedAt: project.updatedAt,
    })
    .from(project)
    .innerJoin(workspace, eq(project.workspaceId, workspace.id))
    .innerJoin(diagram, eq(diagram.projectId, project.id))
    .leftJoin(
      projectMember,
      and(
        eq(projectMember.projectId, project.id),
        eq(projectMember.userId, userId)
      )
    )
    .where(
      and(
        eq(project.id, projectId),
        or(eq(workspace.ownerUserId, userId), eq(projectMember.userId, userId))
      )
    )
  const found = rows.at(0)
  return found
    ? {
        ...found,
        canEdit: found.ownerId === userId || found.role === "edit",
        canManage: found.ownerId === userId,
      }
    : null
}

export async function activeAuthorization(
  executor: Executor,
  id: string,
  key: string,
  userId: string,
  projectId: string,
  clientId: string
) {
  const { mcpAuthorization } = schema
  const found = (
    await executor
      .select()
      .from(mcpAuthorization)
      .where(
        and(
          eq(mcpAuthorization.id, id),
          eq(mcpAuthorization.key, key),
          eq(mcpAuthorization.userId, userId),
          eq(mcpAuthorization.projectId, projectId),
          eq(mcpAuthorization.clientId, clientId)
        )
      )
  ).at(0)
  return found && !found.revokedAt ? found : null
}
