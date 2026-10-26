import "@tanstack/react-start/server-only"
import { createHash, randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import * as schema from "@/db/schema"
import {
  changeDiagramTransaction,
  readEditor,
} from "@/lib/diagram/diagram-store.server"
import { commandSchema } from "@/lib/diagram/model"
import type { Database, Executor } from "./access.server"
import {
  activeAuthorization,
  activeConnection,
  projectAccess,
} from "./access.server"
import { arrangeServerDiagram } from "@/lib/diagram/auto-layout.server"
import { LEASE_DURATION_MS } from "./config"

export const principalSchema = z.object({
  userId: z.string().min(1),
  clientId: z.string().min(1),
  projectId: z.uuid(),
  authorizationId: z.uuid(),
  authorizationKey: z.uuid(),
  canWrite: z.boolean(),
  connectionId: z.uuid().optional(),
  connectionKey: z.uuid().optional(),
})
export type McpPrincipal = z.infer<typeof principalSchema>
export class McpOperationError extends Error {
  constructor(
    public code: string,
    message: string,
    public revision?: number
  ) {
    super(message)
  }
}
async function checkPrincipal(executor: Executor, principal: McpPrincipal) {
  if (
    principal.connectionId &&
    !(await activeConnection(
      executor,
      principal.userId,
      principal.clientId,
      principal.connectionId,
      principal.connectionKey
    ))
  )
    throw new McpOperationError(
      "access_denied",
      "Client access was revoked. Connect the client again."
    )
  const grant = await activeAuthorization(
    executor,
    principal.authorizationId,
    principal.authorizationKey,
    principal.userId,
    principal.projectId,
    principal.clientId
  )
  const access = grant
    ? await projectAccess(executor, principal.userId, principal.projectId)
    : null
  if (!access)
    throw new McpOperationError(
      "access_denied",
      "Project access was revoked. Authorize the connection again."
    )
  return access
}
async function lockProject(executor: Executor, projectId: string) {
  // Diagram -> project is also the manual editor's lock order.
  await executor
    .select({ id: schema.diagram.projectId })
    .from(schema.diagram)
    .where(eq(schema.diagram.projectId, projectId))
    .for("update")
  await executor
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(eq(schema.project.id, projectId))
    .for("update")
}
function graph(data: NonNullable<Awaited<ReturnType<typeof readEditor>>>) {
  return {
    project: data.project,
    revision: data.revision,
    snapshot: data.snapshot,
    canEdit: data.canEdit,
  }
}
export async function openProject(database: Database, principal: McpPrincipal) {
  return database.transaction(async (transaction) => {
    await lockProject(transaction, principal.projectId)
    await checkPrincipal(transaction, principal)
    const current = (
      await transaction
        .select()
        .from(schema.projectMcpLease)
        .where(eq(schema.projectMcpLease.projectId, principal.projectId))
    ).at(0)
    const now = new Date()
    if (
      current &&
      current.expiresAt > now &&
      current.authorizationId !== principal.authorizationId
    ) {
      throw new McpOperationError(
        "project_busy",
        "Another MCP client is using this project. Disconnect it from the web editor or wait for the lease to expire."
      )
    }
    const leaseId =
      current?.authorizationId === principal.authorizationId &&
      current.expiresAt > now
        ? current.leaseId
        : randomUUID()
    const expiresAt = new Date(Date.now() + LEASE_DURATION_MS)
    await transaction
      .insert(schema.projectMcpLease)
      .values({
        projectId: principal.projectId,
        userId: principal.userId,
        leaseId,
        authorizationId: principal.authorizationId,
        acquiredAt: now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: schema.projectMcpLease.projectId,
        set: {
          userId: principal.userId,
          leaseId,
          authorizationId: principal.authorizationId,
          acquiredAt: now,
          expiresAt,
        },
      })
    const data = await readEditor(
      transaction,
      principal.userId,
      principal.projectId
    )
    if (!data)
      throw new McpOperationError("access_denied", "Project unavailable")
    return {
      ...graph(data),
      canEdit: data.canEdit && principal.canWrite,
      leaseId,
      expiresAt: expiresAt.toISOString(),
    }
  })
}

async function withLease<T>(
  database: Database,
  principal: McpPrincipal,
  leaseId: string,
  write: boolean,
  work: (transaction: Executor) => Promise<T>
) {
  return database.transaction(async (transaction) => {
    await lockProject(transaction, principal.projectId)
    const access = await checkPrincipal(transaction, principal)
    if (write && (!principal.canWrite || !access.canEdit))
      throw new McpOperationError("read_only", "Edit access is required.")
    const lease = (
      await transaction
        .select()
        .from(schema.projectMcpLease)
        .where(
          and(
            eq(schema.projectMcpLease.projectId, principal.projectId),
            eq(schema.projectMcpLease.leaseId, leaseId),
            eq(
              schema.projectMcpLease.authorizationId,
              principal.authorizationId
            ),
            eq(schema.projectMcpLease.userId, principal.userId)
          )
        )
    ).at(0)
    if (!lease || lease.expiresAt <= new Date())
      throw new McpOperationError(
        "lease_expired",
        "Open the project again with open_project before continuing."
      )
    await transaction
      .update(schema.projectMcpLease)
      .set({ expiresAt: new Date(Date.now() + LEASE_DURATION_MS) })
      .where(eq(schema.projectMcpLease.projectId, principal.projectId))
    return work(transaction)
  })
}
export async function getProjectDiagram(
  database: Database,
  principal: McpPrincipal,
  leaseId: string
) {
  return withLease(database, principal, leaseId, false, async (transaction) => {
    const data = (await readEditor(
      transaction,
      principal.userId,
      principal.projectId
    ))!
    return { ...graph(data), canEdit: data.canEdit && principal.canWrite }
  })
}
export async function getProjectHistory(
  database: Database,
  principal: McpPrincipal,
  leaseId: string,
  before?: number
) {
  return withLease(database, principal, leaseId, false, async (transaction) => {
    const data = (await readEditor(
      transaction,
      principal.userId,
      principal.projectId
    ))!
    const history = data.history
      .filter((entry) => before === undefined || entry.revision < before)
      .slice(0, 50)
    return {
      revision: data.revision,
      history,
      nextBefore: history.length === 50 ? history.at(-1)!.revision : null,
    }
  })
}

export const mcpChangeSchema = z.object({
  leaseId: z.uuid(),
  requestId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  command: commandSchema,
})
export async function changeProjectDiagram(
  database: Database,
  principal: McpPrincipal,
  input: unknown
) {
  const data = mcpChangeSchema.parse(input)
  const payloadHash = hashMutation({
    expectedRevision: data.expectedRevision,
    command: data.command,
  })
  return saveProjectChange(database, principal, data, payloadHash)
}

function hashMutation(payload: object) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

async function mutationReceipt(
  transaction: Executor,
  principal: McpPrincipal,
  requestId: string,
  payloadHash: string
) {
  const existing = (
    await transaction
      .select()
      .from(schema.mcpMutation)
      .where(
        and(
          eq(schema.mcpMutation.projectId, principal.projectId),
          eq(schema.mcpMutation.authorizationId, principal.authorizationId),
          eq(schema.mcpMutation.requestId, requestId)
        )
      )
  ).at(0)
  if (existing && existing.payloadHash !== payloadHash)
    throw new McpOperationError(
      "request_id_reused",
      "Use a new requestId for a different change."
    )
  return existing ? { revision: existing.revision, replayed: true } : null
}

async function saveProjectChange(
  database: Database,
  principal: McpPrincipal,
  data: z.infer<typeof mcpChangeSchema>,
  payloadHash: string
) {
  return withLease(
    database,
    principal,
    data.leaseId,
    true,
    async (transaction) => {
      const existing = await mutationReceipt(
        transaction,
        principal,
        data.requestId,
        payloadHash
      )
      if (existing) return existing
      const result = await changeDiagramTransaction(
        transaction,
        principal.userId,
        {
          projectId: principal.projectId,
          expectedRevision: data.expectedRevision,
          command: data.command,
        },
        "mcp"
      )
      if (!result.ok)
        throw new McpOperationError(
          result.reason,
          result.reason === "conflict"
            ? "The diagram changed. Read the latest diagram and retry with a new requestId."
            : "Edit access was revoked.",
          result.reason === "conflict" ? result.data.revision : undefined
        )
      await transaction.insert(schema.mcpMutation).values({
        projectId: principal.projectId,
        authorizationId: principal.authorizationId,
        requestId: data.requestId,
        payloadHash,
        revision: result.data.revision,
      })
      return { revision: result.data.revision, replayed: false }
    }
  )
}
export const arrangeRequestSchema = z
  .object({
    leaseId: z.uuid(),
    requestId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    direction: z.enum(["RIGHT", "LEFT", "DOWN", "UP"]).default("RIGHT"),
    nodeSpacing: z.number().int().min(40).max(400).default(80),
    layerSpacing: z.number().int().min(80).max(800).default(160),
  })
  .strict()

export async function arrangeProjectDiagram(
  database: Database,
  principal: McpPrincipal,
  input: unknown
) {
  const data = arrangeRequestSchema.parse(input)
  const payloadHash = hashMutation({
    operation: "arrange",
    expectedRevision: data.expectedRevision,
    direction: data.direction,
    nodeSpacing: data.nodeSpacing,
    layerSpacing: data.layerSpacing,
  })
  // Read and check the receipt before calculating. Exact retries must work even
  // after the first arrangement advanced the revision or other edits followed it.
  const prepared = await withLease(
    database,
    principal,
    data.leaseId,
    true,
    async (tx) => {
      const existing = await mutationReceipt(
        tx,
        principal,
        data.requestId,
        payloadHash
      )
      if (existing) return { done: existing, snapshot: null }
      const current = (await readEditor(
        tx,
        principal.userId,
        principal.projectId
      ))!
      if (current.revision !== data.expectedRevision)
        throw new McpOperationError(
          "conflict",
          "The diagram changed. Read it again and use a new requestId.",
          current.revision
        )
      if (!current.snapshot.entities.length) {
        await tx.insert(schema.mcpMutation).values({
          projectId: principal.projectId,
          authorizationId: principal.authorizationId,
          requestId: data.requestId,
          payloadHash,
          revision: current.revision,
        })
        return {
          done: { revision: current.revision, replayed: false },
          snapshot: null,
        }
      }
      return { done: null, snapshot: current.snapshot }
    }
  )
  if (prepared.done) return prepared.done
  let positions: Array<{ id: string; x: number; y: number }>
  try {
    positions = await arrangeServerDiagram(prepared.snapshot, data)
  } catch {
    throw new McpOperationError(
      "layout_failed",
      "Could not calculate a layout. Try a different direction or arrange smaller groups manually with move_entities."
    )
  }
  // Compute outside the database transaction, then atomically recheck lease,
  // access and revision before moving any nodes. Concurrent manual edits win.
  return saveProjectChange(
    database,
    principal,
    {
      leaseId: data.leaseId,
      requestId: data.requestId,
      expectedRevision: data.expectedRevision,
      command: {
        type: "batch",
        summary: "Arranged diagram",
        commands: [{ type: "move_entities", positions }],
      },
    },
    payloadHash
  )
}

export async function releaseProject(
  database: Database,
  principal: McpPrincipal,
  leaseId: string
) {
  return withLease(database, principal, leaseId, false, async (transaction) => {
    await transaction
      .delete(schema.projectMcpLease)
      .where(eq(schema.projectMcpLease.projectId, principal.projectId))
    return { released: true }
  })
}
