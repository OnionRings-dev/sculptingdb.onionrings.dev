import "@tanstack/react-start/server-only"
import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import { activeConnection, projectAccess } from "./access.server"
import type { Database } from "./access.server"
import {
  connectionStatus,
  removeOAuthCredentials,
} from "./authorization-store.server"
import { appMcpResource, projectMcpResource } from "./config"

export async function prepareAppConnection(database: Database, origin: string) {
  const resource = appMcpResource(origin)
  await database
    .insert(schema.oauthResource)
    .values({
      id: randomUUID(),
      identifier: resource,
      name: "Sculpting DB",
      createdAt: new Date(),
    })
    .onConflictDoNothing()
  return resource
}

export async function authorizeConnection(
  database: Database,
  userId: string,
  clientId: string,
  origin: string
) {
  return database.transaction(async (tx) => {
    const client = (
      await tx
        .select()
        .from(schema.oauthClient)
        .where(eq(schema.oauthClient.clientId, clientId))
    ).at(0)
    if (!client || client.disabled) return null
    const [connection] = await tx
      .insert(schema.mcpConnection)
      .values({ userId, clientId })
      .onConflictDoUpdate({
        target: [schema.mcpConnection.userId, schema.mcpConnection.clientId],
        set: { key: randomUUID(), revokedAt: null, createdAt: new Date() },
      })
      .returning()
    await removeOAuthCredentials(tx, userId, clientId, appMcpResource(origin))
    return connection
  })
}

export async function setClientProjectAccess(
  database: Database,
  actorId: string,
  projectId: string,
  connectionId: string,
  enabled: boolean
) {
  return database.transaction(async (tx) => {
    await tx
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.id, projectId))
      .for("update")
    const access = await projectAccess(tx, actorId, projectId)
    const candidate = (
      await tx
        .select()
        .from(schema.mcpConnection)
        .where(eq(schema.mcpConnection.id, connectionId))
    ).at(0)
    if (!access || !candidate) return false
    // Users opt their own clients in. Owners can remove a collaborator's grant,
    // but cannot silently opt another user's client in.
    if (candidate.userId !== actorId && (enabled || !access.canManage))
      return false
    const connection = await activeConnection(
      tx,
      candidate.userId,
      candidate.clientId,
      connectionId
    )
    if (
      !connection ||
      (enabled && !(await projectAccess(tx, connection.userId, projectId)))
    )
      return false
    const current = (
      await tx
        .select()
        .from(schema.mcpAuthorization)
        .where(
          and(
            eq(schema.mcpAuthorization.projectId, projectId),
            eq(schema.mcpAuthorization.userId, connection.userId),
            eq(schema.mcpAuthorization.clientId, connection.clientId)
          )
        )
    ).at(0)
    if (enabled && current && !current.revokedAt) return true
    if (enabled) {
      await tx
        .insert(schema.mcpAuthorization)
        .values({
          projectId,
          userId: connection.userId,
          clientId: connection.clientId,
        })
        .onConflictDoUpdate({
          target: [
            schema.mcpAuthorization.projectId,
            schema.mcpAuthorization.userId,
            schema.mcpAuthorization.clientId,
          ],
          set: { key: randomUUID(), revokedAt: null, createdAt: new Date() },
        })
    } else if (current) {
      await tx
        .update(schema.mcpAuthorization)
        .set({ revokedAt: new Date(), key: randomUUID() })
        .where(eq(schema.mcpAuthorization.id, current.id))
      await tx
        .delete(schema.projectMcpLease)
        .where(
          and(
            eq(schema.projectMcpLease.projectId, projectId),
            eq(schema.projectMcpLease.authorizationId, current.id)
          )
        )
    }
    return true
  })
}

export async function disconnectClient(
  database: Database,
  userId: string,
  connectionId: string,
  origin: string
) {
  return database.transaction(async (tx) => {
    const rows = await tx
      .update(schema.mcpConnection)
      .set({ revokedAt: new Date(), key: sql`gen_random_uuid()` })
      .where(
        and(
          eq(schema.mcpConnection.id, connectionId),
          eq(schema.mcpConnection.userId, userId)
        )
      )
      .returning()
    const connection = rows.at(0)
    if (!connection) return false
    const grants = await tx
      .update(schema.mcpAuthorization)
      .set({ revokedAt: new Date(), key: sql`gen_random_uuid()` })
      .where(
        and(
          eq(schema.mcpAuthorization.userId, userId),
          eq(schema.mcpAuthorization.clientId, connection.clientId)
        )
      )
      .returning()
    if (grants.length)
      await tx.delete(schema.projectMcpLease).where(
        inArray(
          schema.projectMcpLease.authorizationId,
          grants.map((grant) => grant.id)
        )
      )
    for (const resource of [
      appMcpResource(origin),
      ...grants.map((grant) => projectMcpResource(origin, grant.projectId)),
    ])
      await removeOAuthCredentials(tx, userId, connection.clientId, resource)
    return true
  })
}

export async function projectConnectionStatus(
  database: Database,
  userId: string,
  projectId: string
) {
  const access = await projectAccess(database, userId, projectId)
  if (!access) return null
  const status = await connectionStatus(database, userId, projectId)
  const connections = await database
    .select({
      id: schema.mcpConnection.id,
      clientId: schema.mcpConnection.clientId,
      userId: schema.mcpConnection.userId,
      userName: schema.user.name,
      clientName: schema.oauthClient.name,
      createdAt: schema.mcpConnection.createdAt,
      authorizationId: schema.mcpAuthorization.id,
      revokedAt: schema.mcpAuthorization.revokedAt,
    })
    .from(schema.mcpConnection)
    .innerJoin(schema.user, eq(schema.user.id, schema.mcpConnection.userId))
    .innerJoin(
      schema.oauthClient,
      eq(schema.oauthClient.clientId, schema.mcpConnection.clientId)
    )
    .leftJoin(
      schema.mcpAuthorization,
      and(
        eq(schema.mcpAuthorization.projectId, projectId),
        eq(schema.mcpAuthorization.userId, schema.mcpConnection.userId),
        eq(schema.mcpAuthorization.clientId, schema.mcpConnection.clientId)
      )
    )
    .where(
      and(
        isNull(schema.mcpConnection.revokedAt),
        or(
          eq(schema.oauthClient.disabled, false),
          isNull(schema.oauthClient.disabled)
        ),
        or(
          eq(schema.mcpConnection.userId, userId),
          access.canManage
            ? and(
                isNull(schema.mcpAuthorization.revokedAt),
                eq(schema.mcpAuthorization.projectId, projectId)
              )
            : undefined
        )
      )
    )
    .orderBy(asc(schema.mcpConnection.createdAt), asc(schema.mcpConnection.id))
  const newGrantIds = new Set(
    connections.map((connection) => connection.authorizationId)
  )
  return {
    lease: status?.lease ?? null,
    clients: connections.map((connection) => ({
      id: connection.id,
      clientId: connection.clientId,
      kind: "app" as const,
      userName: connection.userName,
      clientName: connection.clientName ?? "MCP client",
      createdAt: connection.createdAt.toISOString(),
      isOwn: connection.userId === userId,
      enabled: !!connection.authorizationId && !connection.revokedAt,
      canToggle: connection.userId === userId || access.canManage,
    })),
    legacy: (status?.grants ?? []).filter(
      (grant) => !newGrantIds.has(grant.id)
    ),
  }
}
