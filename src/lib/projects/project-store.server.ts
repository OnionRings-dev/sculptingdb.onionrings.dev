import "@tanstack/react-start/server-only"

import { and, desc, eq, inArray, ne, or } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type { ProjectSummary } from "./types"
import * as schema from "@/db/schema"
import { renameProjectSchema } from "./project-model"

type Database = NodePgDatabase<typeof schema>
const isProjectId = (value: string) =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
const {
  project,
  workspace,
  projectMember,
  user,
  diagramEntity,
  diagramRelationship,
} = schema

function projectAccess(database: Database, userId: string) {
  const sharedProjects = database
    .select({ projectId: projectMember.projectId })
    .from(projectMember)
    .where(eq(projectMember.userId, userId))
  return or(
    eq(workspace.ownerUserId, userId),
    inArray(project.id, sharedProjects)
  )
}

export async function listAccessibleProjects(
  database: Database,
  userId: string
): Promise<Array<ProjectSummary>> {
  const projects = await database
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
      owner: { id: user.id, name: user.name, image: user.image },
    })
    .from(project)
    .innerJoin(workspace, eq(project.workspaceId, workspace.id))
    .innerJoin(user, eq(workspace.ownerUserId, user.id))
    .where(projectAccess(database, userId))
    .orderBy(desc(project.updatedAt), desc(project.id))

  if (!projects.length) return []
  const projectIds = projects.map(({ id }) => id)
  const [members, entities, relationships] = await Promise.all([
    database
      .select({
        projectId: projectMember.projectId,
        person: { id: user.id, name: user.name, image: user.image },
      })
      .from(projectMember)
      .innerJoin(user, eq(projectMember.userId, user.id))
      .where(
        and(inArray(projectMember.projectId, projectIds), ne(user.id, userId))
      )
      .orderBy(user.name, user.id),
    database
      .select({
        projectId: diagramEntity.projectId,
        id: diagramEntity.id,
        name: diagramEntity.name,
        positionX: diagramEntity.positionX,
        positionY: diagramEntity.positionY,
      })
      .from(diagramEntity)
      .where(inArray(diagramEntity.projectId, projectIds))
      .orderBy(diagramEntity.id),
    database
      .select({
        projectId: diagramRelationship.projectId,
        id: diagramRelationship.id,
        sourceEntityId: diagramRelationship.sourceEntityId,
        targetEntityId: diagramRelationship.targetEntityId,
      })
      .from(diagramRelationship)
      .where(inArray(diagramRelationship.projectId, projectIds))
      .orderBy(diagramRelationship.id),
  ])

  const summaries = new Map<string, ProjectSummary>(
    projects.map(({ owner, ...record }) => [
      record.id,
      {
        ...record,
        canDelete: owner.id === userId,
        collaborators: owner.id === userId ? [] : [owner],
        preview: { entities: [], relationships: [] },
      },
    ])
  )
  for (const { projectId, person } of members) {
    const collaborators = summaries.get(projectId)!.collaborators
    if (!collaborators.some(({ id }) => id === person.id))
      collaborators.push(person)
  }
  for (const { projectId, ...entity } of entities)
    summaries.get(projectId)!.preview.entities.push(entity)
  for (const { projectId, ...relationship } of relationships)
    summaries.get(projectId)!.preview.relationships.push(relationship)
  return [...summaries.values()]
}

export async function createUntitledProject(
  database: Database,
  userId: string
) {
  return database.transaction(async (transaction) => {
    // Upsert handles two first-project requests arriving simultaneously.
    const [personalWorkspace] = await transaction
      .insert(workspace)
      .values({ ownerUserId: userId, name: "Personal workspace" })
      .onConflictDoUpdate({
        target: workspace.ownerUserId,
        set: { ownerUserId: userId },
      })
      .returning({ id: workspace.id })
    const [created] = await transaction
      .insert(project)
      .values({ workspaceId: personalWorkspace.id, name: "Untitled" })
      .returning({ id: project.id })
    await transaction.insert(schema.diagram).values({ projectId: created.id })
    return created
  })
}

export async function findAccessibleProject(
  database: Database,
  userId: string,
  projectId: string
) {
  if (!isProjectId(projectId)) return null
  const results = await database
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
    })
    .from(project)
    .innerJoin(workspace, eq(project.workspaceId, workspace.id))
    .where(and(eq(project.id, projectId), projectAccess(database, userId)))
    .limit(1)
  // Treat private and nonexistent projects alike.
  return results.at(0) ?? null
}

export async function deleteOwnedProject(
  database: Database,
  userId: string,
  projectId: string
) {
  if (!isProjectId(projectId)) return false
  const ownedWorkspaces = database
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerUserId, userId))
  // Ownership and deletion are checked in one statement; Edit is not ownership.
  const deleted = await database
    .delete(project)
    .where(
      and(
        eq(project.id, projectId),
        inArray(project.workspaceId, ownedWorkspaces)
      )
    )
    .returning({ id: project.id })
  return deleted.length > 0
}

export async function renameAccessibleProject(
  database: Database,
  userId: string,
  input: unknown
) {
  const { projectId, name } = renameProjectSchema.parse(input)
  const owned = database
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.ownerUserId, userId))
  const editable = database
    .select({ id: projectMember.projectId })
    .from(projectMember)
    .where(
      and(eq(projectMember.userId, userId), eq(projectMember.role, "edit"))
    )
  const renamed = await database
    .update(project)
    .set({ name })
    .where(
      and(
        eq(project.id, projectId),
        or(inArray(project.workspaceId, owned), inArray(project.id, editable))
      )
    )
    .returning({
      id: project.id,
      name: project.name,
      description: project.description,
    })
  return renamed.at(0) ?? null
}
