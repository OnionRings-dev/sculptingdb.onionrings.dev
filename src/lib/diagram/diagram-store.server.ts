import "@tanstack/react-start/server-only"

import { and, desc, eq, inArray, or } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type { DiagramSnapshot } from "@/db/schema"
import {
  applyCommand,
  canonicalSnapshot,
  mutationSchema,
  snapshotSchema,
} from "./model"
import type {
  DiagramEditorData,
  DiagramMutation,
  MutationResult,
} from "./model"
import * as schema from "@/db/schema"

type Database = NodePgDatabase<typeof schema>
type Executor = Pick<Database, "select" | "insert" | "delete" | "update">
const {
  project,
  workspace,
  projectMember,
  diagram,
  diagramEntity,
  diagramAttribute,
  diagramRelationship,
  diagramRevision,
  user,
} = schema

async function access(executor: Executor, userId: string, projectId: string) {
  const rows = await executor
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
      ownerId: workspace.ownerUserId,
      role: projectMember.role,
      revision: diagram.revision,
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
    .limit(1)
  return rows.at(0) ?? null
}

async function readSnapshot(
  executor: Executor,
  projectId: string
): Promise<DiagramSnapshot> {
  const entities = await executor
    .select()
    .from(diagramEntity)
    .where(eq(diagramEntity.projectId, projectId))
  const attributes = entities.length
    ? await executor
        .select()
        .from(diagramAttribute)
        .where(
          inArray(
            diagramAttribute.entityId,
            entities.map(({ id }) => id)
          )
        )
    : []
  const relationships = await executor
    .select()
    .from(diagramRelationship)
    .where(eq(diagramRelationship.projectId, projectId))
  return canonicalSnapshot({
    schemaVersion: 1,
    entities: entities.map(({ projectId: _projectId, ...entity }) => entity),
    attributes,
    relationships: relationships.map(
      ({ projectId: _projectId, ...relationship }) => relationship
    ),
  })
}

async function readEditor(
  executor: Executor,
  userId: string,
  projectId: string
): Promise<DiagramEditorData | null> {
  const found = await access(executor, userId, projectId)
  if (!found) return null
  const snapshot = await readSnapshot(executor, projectId)
  const history = await executor
    .select({
      revision: diagramRevision.revision,
      summary: diagramRevision.summary,
      origin: diagramRevision.origin,
      actorName: user.name,
      createdAt: diagramRevision.createdAt,
    })
    .from(diagramRevision)
    .leftJoin(user, eq(diagramRevision.actorUserId, user.id))
    .where(eq(diagramRevision.projectId, projectId))
    .orderBy(desc(diagramRevision.revision))
  return {
    project: { id: found.id, name: found.name, description: found.description },
    canEdit: found.ownerId === userId || found.role === "edit",
    revision: found.revision,
    snapshot,
    history: history.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
  }
}

export async function loadDiagram(
  database: Database,
  userId: string,
  projectId: string
) {
  if (
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      projectId
    )
  )
    return null
  return database.transaction(
    (transaction) => readEditor(transaction, userId, projectId),
    { isolationLevel: "repeatable read", accessMode: "read only" }
  )
}

export async function loadRevision(
  database: Database,
  userId: string,
  projectId: string,
  revision: number
) {
  return database.transaction(
    async (transaction) => {
      if (!(await access(transaction, userId, projectId))) return null
      const rows = await transaction
        .select({ snapshot: diagramRevision.snapshot })
        .from(diagramRevision)
        .where(
          and(
            eq(diagramRevision.projectId, projectId),
            eq(diagramRevision.revision, revision)
          )
        )
        .limit(1)
      const found = rows.at(0)
      return found ? snapshotSchema.parse(found.snapshot) : null
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  )
}

async function replaceSnapshot(
  executor: Executor,
  projectId: string,
  snapshot: DiagramSnapshot
) {
  // The diagram row lock serializes all edits. Replace only this project's rows;
  // stable UUIDs are preserved across edits and restores.
  await executor
    .delete(diagramEntity)
    .where(eq(diagramEntity.projectId, projectId))
  if (snapshot.entities.length)
    await executor
      .insert(diagramEntity)
      .values(snapshot.entities.map((entity) => ({ ...entity, projectId })))
  if (snapshot.attributes.length)
    await executor.insert(diagramAttribute).values(snapshot.attributes)
  if (snapshot.relationships.length)
    await executor.insert(diagramRelationship).values(
      snapshot.relationships.map((relationship) => ({
        ...relationship,
        projectId,
      }))
    )
}

export async function changeDiagram(
  database: Database,
  userId: string,
  input: DiagramMutation
): Promise<MutationResult> {
  const { projectId, expectedRevision, command } = mutationSchema.parse(input)
  return database.transaction(async (transaction): Promise<MutationResult> => {
    if (!(await access(transaction, userId, projectId)))
      return { ok: false, reason: "forbidden" }
    await transaction
      .select({ id: diagram.projectId })
      .from(diagram)
      .where(eq(diagram.projectId, projectId))
      .for("update")
    const current = await readEditor(transaction, userId, projectId)
    if (!current?.canEdit) return { ok: false, reason: "forbidden" }
    if (current.revision !== expectedRevision)
      return { ok: false, reason: "conflict", data: current }

    let next: { snapshot: DiagramSnapshot; summary: string }
    if (command.type === "restore") {
      const rows = await transaction
        .select({ snapshot: diagramRevision.snapshot })
        .from(diagramRevision)
        .where(
          and(
            eq(diagramRevision.projectId, projectId),
            eq(diagramRevision.revision, command.revision)
          )
        )
        .limit(1)
      const target = rows.at(0)
      if (!target) throw new Error("Revision not found")
      next = {
        snapshot: canonicalSnapshot(snapshotSchema.parse(target.snapshot)),
        summary: `Restored version ${command.revision}`,
      }
    } else {
      next = applyCommand(current.snapshot, command)
      if (JSON.stringify(next.snapshot) === JSON.stringify(current.snapshot))
        return { ok: true, data: current }
    }

    let revision = current.revision
    // Capture the pre-edit state on the first edit, including legacy diagrams.
    // This makes the original empty state restorable without a revision-zero FK.
    if (revision === 0) {
      revision = 1
      await transaction.insert(diagramRevision).values({
        projectId,
        revision,
        actorUserId: userId,
        origin: "manual",
        summary: "Initial state",
        snapshot: current.snapshot,
      })
    }
    revision++
    await replaceSnapshot(transaction, projectId, next.snapshot)
    await transaction.insert(diagramRevision).values({
      projectId,
      revision,
      actorUserId: userId,
      origin: command.type === "restore" ? "restore" : "manual",
      restoredFromRevision:
        command.type === "restore" ? command.revision : null,
      summary: next.summary,
      snapshot: next.snapshot,
    })
    await transaction
      .update(diagram)
      .set({ revision })
      .where(eq(diagram.projectId, projectId))
    await transaction
      .update(project)
      .set({ updatedAt: new Date() })
      .where(eq(project.id, projectId))
    const data = await readEditor(transaction, userId, projectId)
    if (!data) throw new Error("Project no longer available")
    return { ok: true, data }
  })
}
