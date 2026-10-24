import "@tanstack/react-start/server-only"

import { and, asc, eq, inArray, notInArray, or, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import * as schema from "@/db/schema"
import {
  changeMemberSchema,
  invitePeopleSchema,
  removeMemberSchema,
  searchPeopleSchema,
} from "./project-model"
import type { ProjectSharing } from "./project-model"
import type { AccountUser } from "./types"

type Database = NodePgDatabase<typeof schema>
type Executor = Pick<Database, "select" | "insert" | "update">
const { project, workspace, projectMember, user } = schema
const person = {
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image,
}

async function ownedProject(
  executor: Executor,
  userId: string,
  projectId: string
) {
  const found = (
    await executor
      .select({ id: project.id })
      .from(project)
      .innerJoin(workspace, eq(project.workspaceId, workspace.id))
      .where(and(eq(project.id, projectId), eq(workspace.ownerUserId, userId)))
  ).at(0)
  return found ?? null
}

async function readSharing(
  executor: Executor,
  userId: string,
  projectId: string
): Promise<ProjectSharing | null> {
  if (!(await ownedProject(executor, userId, projectId))) return null
  const [owner] = await executor
    .select(person)
    .from(user)
    .where(eq(user.id, userId))
  const members = await executor
    .select({ ...person, role: projectMember.role })
    .from(projectMember)
    .innerJoin(user, eq(projectMember.userId, user.id))
    .where(eq(projectMember.projectId, projectId))
    .orderBy(asc(user.name), asc(user.id))
  return { owner, members }
}

export async function loadProjectSharing(
  database: Database,
  userId: string,
  projectId: string
) {
  return database.transaction(
    (transaction) => readSharing(transaction, userId, projectId),
    {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    }
  )
}

export async function searchProjectPeople(
  database: Database,
  userId: string,
  input: unknown
): Promise<Array<AccountUser>> {
  const { projectId, query } = searchPeopleSchema.parse(input)
  if (query.length < 2) return []
  return database.transaction(
    async (transaction) => {
      if (!(await ownedProject(transaction, userId, projectId))) return []
      const members = transaction
        .select({ id: projectMember.userId })
        .from(projectMember)
        .where(eq(projectMember.projectId, projectId))
      // Literal substring matching: percent and underscore are not SQL wildcards.
      return transaction
        .select(person)
        .from(user)
        .where(
          and(
            sql`${user.id} <> ${userId}`,
            notInArray(user.id, members),
            or(
              sql`strpos(lower(${user.email}), lower(${query})) > 0`,
              sql`strpos(lower(${user.name}), lower(${query})) > 0`
            )
          )
        )
        .orderBy(asc(user.name), asc(user.id))
        .limit(10)
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  )
}

export async function inviteProjectPeople(
  database: Database,
  userId: string,
  input: unknown
) {
  const { projectId, emails, role } = invitePeopleSchema.parse(input)
  return database.transaction(async (transaction) => {
    // Serialize sharing changes and check ownership inside the same transaction.
    const locked = (
      await transaction
        .select({ id: project.id })
        .from(project)
        .innerJoin(workspace, eq(project.workspaceId, workspace.id))
        .where(
          and(eq(project.id, projectId), eq(workspace.ownerUserId, userId))
        )
        .for("update", { of: project })
    ).at(0)
    if (!locked) return { ok: false as const, reason: "forbidden" as const }
    const normalized = [...new Set(emails)]
    const people = await transaction
      .select(person)
      .from(user)
      .where(inArray(sql`lower(${user.email})`, normalized))
    const unknown = normalized.filter(
      (email) => !people.some((p) => p.email.toLowerCase() === email)
    )
    if (unknown.length)
      return {
        ok: false as const,
        reason: "unknown_users" as const,
        emails: unknown,
      }
    const invitees = people.filter((p) => p.id !== userId)
    if (invitees.length)
      await transaction
        .insert(projectMember)
        .values(invitees.map((p) => ({ projectId, userId: p.id, role })))
        // Repeating an invitation never silently changes an existing permission.
        .onConflictDoNothing()
    return {
      ok: true as const,
      sharing: (await readSharing(transaction, userId, projectId))!,
    }
  })
}

export async function updateProjectMember(
  database: Database,
  userId: string,
  input: unknown
) {
  const data = changeMemberSchema.parse(input)
  const owned = database
    .select({ id: project.id })
    .from(project)
    .innerJoin(workspace, eq(project.workspaceId, workspace.id))
    .where(eq(workspace.ownerUserId, userId))
  const changed = await database
    .update(projectMember)
    .set({ role: data.role })
    .where(
      and(
        eq(projectMember.projectId, data.projectId),
        eq(projectMember.userId, data.userId),
        inArray(projectMember.projectId, owned),
        sql`${projectMember.userId} <> ${userId}`
      )
    )
    .returning({ id: projectMember.userId })
  return changed.length > 0
}

export async function removeProjectMember(
  database: Database,
  userId: string,
  input: unknown
) {
  const data = removeMemberSchema.parse(input)
  if (data.userId === userId) return false
  return database.transaction(async (transaction) => {
    const locked = (
      await transaction
        .select({ id: project.id })
        .from(project)
        .innerJoin(workspace, eq(project.workspaceId, workspace.id))
        .where(
          and(eq(project.id, data.projectId), eq(workspace.ownerUserId, userId))
        )
        .for("update", { of: project })
    ).at(0)
    if (!locked) return false
    const removed = await transaction
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.projectId, data.projectId),
          eq(projectMember.userId, data.userId)
        )
      )
      .returning({ id: projectMember.userId })
    if (!removed.length) return false
    // A revoked collaborator must not keep this project's single MCP slot occupied.
    await transaction
      .delete(schema.projectMcpLease)
      .where(
        and(
          eq(schema.projectMcpLease.projectId, data.projectId),
          eq(schema.projectMcpLease.userId, data.userId)
        )
      )
    return true
  })
}
