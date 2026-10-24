import "@tanstack/react-start/server-only"
import { and, arrayContains, eq, isNull, or } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import * as schema from "@/db/schema"
import type { Database, Executor } from "./access.server"
import { projectAccess } from "./access.server"
import { projectMcpResource } from "./config"

export async function prepareConnection(
  database: Database,
  userId: string,
  projectId: string,
  origin: string
) {
  const access = await projectAccess(database, userId, projectId)
  if (!access) return null
  const resource = projectMcpResource(origin, projectId)
  await database
    .insert(schema.oauthResource)
    .values({
      id: randomUUID(),
      identifier: resource,
      name: "Sculpting DB project",
      createdAt: new Date(),
    })
    .onConflictDoNothing()
  return { resource, canEdit: access.canEdit }
}

async function removeOAuthCredentials(
  executor: Executor,
  userId: string,
  clientId: string,
  resource: string
) {
  // OAuth revocation covers refresh credentials as well as our immediate JWT gate.
  for (const table of [
    schema.oauthAccessToken,
    schema.oauthRefreshToken,
    schema.oauthConsent,
  ]) {
    await executor
      .delete(table)
      .where(
        and(
          eq(table.userId, userId),
          eq(table.clientId, clientId),
          arrayContains(table.resources, [resource])
        )
      )
  }
}

export async function authorizeProject(
  database: Database,
  userId: string,
  projectId: string,
  clientId: string,
  origin: string
) {
  return database.transaction(async (transaction) => {
    // Same project lock as acquisition/revocation: approvals cannot race a disconnect.
    await transaction
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.id, projectId))
      .for("update")
    if (!(await projectAccess(transaction, userId, projectId))) return null
    await removeOAuthCredentials(
      transaction,
      userId,
      clientId,
      projectMcpResource(origin, projectId)
    )
    const [grant] = await transaction
      .insert(schema.mcpAuthorization)
      .values({ projectId, userId, clientId })
      .onConflictDoUpdate({
        target: [
          schema.mcpAuthorization.projectId,
          schema.mcpAuthorization.userId,
          schema.mcpAuthorization.clientId,
        ],
        set: { key: randomUUID(), revokedAt: null, createdAt: new Date() },
      })
      .returning()
    await transaction
      .delete(schema.projectMcpLease)
      .where(
        and(
          eq(schema.projectMcpLease.projectId, projectId),
          eq(schema.projectMcpLease.authorizationId, grant.id)
        )
      )
    return grant
  })
}

export async function connectionStatus(
  database: Database,
  userId: string,
  projectId: string
) {
  const access = await projectAccess(database, userId, projectId)
  if (!access) return null
  const lease = (
    await database
      .select({
        id: schema.projectMcpLease.leaseId,
        userId: schema.user.id,
        userName: schema.user.name,
        clientName: schema.oauthClient.name,
        expiresAt: schema.projectMcpLease.expiresAt,
      })
      .from(schema.projectMcpLease)
      .innerJoin(schema.user, eq(schema.projectMcpLease.userId, schema.user.id))
      .leftJoin(
        schema.mcpAuthorization,
        eq(schema.projectMcpLease.authorizationId, schema.mcpAuthorization.id)
      )
      .leftJoin(
        schema.oauthClient,
        eq(schema.mcpAuthorization.clientId, schema.oauthClient.clientId)
      )
      .where(eq(schema.projectMcpLease.projectId, projectId))
  ).at(0)
  const active = lease && lease.expiresAt > new Date() ? lease : null
  const grants = await database
    .select({
      id: schema.mcpAuthorization.id,
      userName: schema.user.name,
      clientName: schema.oauthClient.name,
      createdAt: schema.mcpAuthorization.createdAt,
    })
    .from(schema.mcpAuthorization)
    .innerJoin(schema.user, eq(schema.mcpAuthorization.userId, schema.user.id))
    .innerJoin(
      schema.oauthClient,
      eq(schema.mcpAuthorization.clientId, schema.oauthClient.clientId)
    )
    .where(
      and(
        eq(schema.mcpAuthorization.projectId, projectId),
        isNull(schema.mcpAuthorization.revokedAt),
        access.canManage
          ? undefined
          : eq(schema.mcpAuthorization.userId, userId)
      )
    )
  return {
    lease: active
      ? { ...active, expiresAt: active.expiresAt.toISOString() }
      : null,
    canDisconnect: !!active && (access.canManage || active.userId === userId),
    grants: grants.map((grant) => ({
      ...grant,
      createdAt: grant.createdAt.toISOString(),
    })),
  }
}

export async function revokeAuthorization(
  database: Database,
  actorId: string,
  projectId: string,
  authorizationId: string,
  origin: string
) {
  return database.transaction(async (transaction) => {
    await transaction
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.id, projectId))
      .for("update")
    const access = await projectAccess(transaction, actorId, projectId)
    if (!access) return false
    const grants = await transaction
      .update(schema.mcpAuthorization)
      .set({ revokedAt: new Date(), key: randomUUID() })
      .where(
        and(
          eq(schema.mcpAuthorization.id, authorizationId),
          eq(schema.mcpAuthorization.projectId, projectId),
          or(
            eq(schema.mcpAuthorization.userId, actorId),
            access.canManage
              ? eq(schema.mcpAuthorization.projectId, projectId)
              : undefined
          )
        )
      )
      .returning()
    const grant = grants.at(0)
    if (!grant) return false
    await transaction
      .delete(schema.projectMcpLease)
      .where(
        and(
          eq(schema.projectMcpLease.projectId, projectId),
          eq(schema.projectMcpLease.authorizationId, authorizationId)
        )
      )
    await removeOAuthCredentials(
      transaction,
      grant.userId,
      grant.clientId,
      projectMcpResource(origin, projectId)
    )
    return true
  })
}
