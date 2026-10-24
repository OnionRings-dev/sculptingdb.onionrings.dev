import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"
import * as schema from "../src/db/schema"
import {
  createUntitledProject,
  deleteOwnedProject,
  findAccessibleProject,
  listAccessibleProjects,
} from "../src/lib/projects/project-store.server"

const databaseURL = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseURL)(
  "project access and creation with PostgreSQL",
  () => {
    const pool = new Pool({ connectionString: databaseURL })
    const db = drizzle(pool, { schema })
    const ownerId = randomUUID()
    const collaboratorId = randomUUID()
    const strangerId = randomUUID()
    const userIds = [ownerId, collaboratorId, strangerId]

    beforeAll(async () => {
      if (!new URL(databaseURL!).pathname.endsWith("_test")) {
        throw new Error(
          "TEST_DATABASE_URL must point to a disposable database ending in _test"
        )
      }
      await migrate(db, { migrationsFolder: "./drizzle" })
    })

    beforeEach(async () => {
      await db.insert(schema.user).values(
        userIds.map((id) => ({
          id,
          name: id === ownerId ? "Owner" : "Member",
          email: `${id}@example.test`,
        }))
      )
    })

    afterEach(async () => {
      if (databaseURL && new URL(databaseURL).pathname.endsWith("_test")) {
        await db.delete(schema.user).where(inArray(schema.user.id, userIds))
      }
    })

    afterAll(async () => {
      await pool.end()
    })

    test("a new user has an empty list and creation persists a project with its empty diagram", async () => {
      expect(await listAccessibleProjects(db, ownerId)).toEqual([])
      const created = await createUntitledProject(db, ownerId)
      expect(await findAccessibleProject(db, ownerId, created.id)).toEqual({
        id: created.id,
        name: "Untitled",
        description: null,
      })
      const [diagram] = await db
        .select()
        .from(schema.diagram)
        .where(eq(schema.diagram.projectId, created.id))
      expect(diagram.revision).toBe(0)
      const projects = await listAccessibleProjects(db, ownerId)
      expect(projects).toEqual([
        {
          id: created.id,
          name: "Untitled",
          description: null,
          canDelete: true,
          collaborators: [],
          preview: { entities: [], relationships: [] },
        },
      ])
    })

    test("concurrent first projects use the same personal workspace and keep separate diagrams", async () => {
      const projects = await Promise.all([
        createUntitledProject(db, ownerId),
        createUntitledProject(db, ownerId),
      ])
      expect(projects[0].id).not.toBe(projects[1].id)
      expect(
        await db
          .select()
          .from(schema.workspace)
          .where(eq(schema.workspace.ownerUserId, ownerId))
      ).toHaveLength(1)
      expect(
        await db
          .select()
          .from(schema.diagram)
          .where(
            inArray(
              schema.diagram.projectId,
              projects.map(({ id }) => id)
            )
          )
      ).toHaveLength(2)
    })

    test("both View and Edit grant only the invited project and revocation takes effect immediately", async () => {
      const shared = await createUntitledProject(db, ownerId)
      const privateProject = await createUntitledProject(db, ownerId)
      for (const role of ["view", "edit"] as const) {
        await db
          .insert(schema.projectMember)
          .values({ projectId: shared.id, userId: collaboratorId, role })
          .onConflictDoUpdate({
            target: [
              schema.projectMember.projectId,
              schema.projectMember.userId,
            ],
            set: { role },
          })
        expect(
          (await listAccessibleProjects(db, collaboratorId)).map(({ id }) => id)
        ).toEqual([shared.id])
        expect(
          await findAccessibleProject(db, collaboratorId, shared.id)
        ).not.toBeNull()
        expect(
          await findAccessibleProject(db, collaboratorId, privateProject.id)
        ).toBeNull()
      }
      expect(await listAccessibleProjects(db, strangerId)).toEqual([])
      expect(await findAccessibleProject(db, strangerId, shared.id)).toBeNull()
      await db
        .delete(schema.projectMember)
        .where(eq(schema.projectMember.projectId, shared.id))
      expect(
        await findAccessibleProject(db, collaboratorId, shared.id)
      ).toBeNull()
      expect(await listAccessibleProjects(db, collaboratorId)).toEqual([])
    })

    test("summaries include actual collaborators and diagram content without exposing private projects or emails", async () => {
      const shared = await createUntitledProject(db, ownerId)
      const privateProject = await createUntitledProject(db, ownerId)
      await db
        .update(schema.project)
        .set({ name: "Shop", description: "Orders and customers" })
        .where(eq(schema.project.id, shared.id))
      await db
        .insert(schema.projectMember)
        .values({ projectId: shared.id, userId: collaboratorId, role: "view" })
      const [customer, order] = await db
        .insert(schema.diagramEntity)
        .values([
          {
            projectId: shared.id,
            name: "Customer",
            positionX: 0,
            positionY: 0,
          },
          {
            projectId: shared.id,
            name: "Order",
            positionX: 220,
            positionY: 100,
          },
        ])
        .returning()
      const [edge] = await db
        .insert(schema.diagramRelationship)
        .values({
          projectId: shared.id,
          sourceEntityId: customer.id,
          targetEntityId: order.id,
          sourceCardinality: "one",
          targetCardinality: "zero_or_many",
        })
        .returning()
      await db
        .insert(schema.diagramEntity)
        .values({ projectId: privateProject.id, name: "Private entity" })
      const [summary] = await listAccessibleProjects(db, collaboratorId)
      expect(summary).toMatchObject({
        id: shared.id,
        name: "Shop",
        description: "Orders and customers",
        canDelete: false,
        collaborators: [{ id: ownerId, name: "Owner", image: null }],
      })
      expect(summary.preview.entities.map(({ name }) => name).sort()).toEqual([
        "Customer",
        "Order",
      ])
      expect(summary.preview.relationships).toEqual([
        { id: edge.id, sourceEntityId: customer.id, targetEntityId: order.id },
      ])
      expect(JSON.stringify(summary)).not.toContain("@example.test")
      const ownerSummary = (await listAccessibleProjects(db, ownerId)).find(
        ({ id }) => id === shared.id
      )!
      expect(ownerSummary.collaborators.map(({ id }) => id)).toEqual([
        collaboratorId,
      ])
      expect(ownerSummary.canDelete).toBe(true)
    })

    test("only the owner can delete a project, cascading its contents and preserving other projects", async () => {
      const deleted = await createUntitledProject(db, ownerId)
      const kept = await createUntitledProject(db, ownerId)
      for (const role of ["view", "edit"] as const) {
        await db
          .insert(schema.projectMember)
          .values({ projectId: deleted.id, userId: collaboratorId, role })
          .onConflictDoUpdate({
            target: [
              schema.projectMember.projectId,
              schema.projectMember.userId,
            ],
            set: { role },
          })
        expect(await deleteOwnedProject(db, collaboratorId, deleted.id)).toBe(
          false
        )
      }
      expect(await deleteOwnedProject(db, strangerId, deleted.id)).toBe(false)
      expect(
        await findAccessibleProject(db, ownerId, deleted.id)
      ).not.toBeNull()
      await db
        .insert(schema.diagramEntity)
        .values({ projectId: deleted.id, name: "Customer" })
      expect(await deleteOwnedProject(db, ownerId, deleted.id)).toBe(true)
      expect(await findAccessibleProject(db, ownerId, deleted.id)).toBeNull()
      expect(
        await db
          .select()
          .from(schema.diagram)
          .where(eq(schema.diagram.projectId, deleted.id))
      ).toHaveLength(0)
      expect(
        await db
          .select()
          .from(schema.diagramEntity)
          .where(eq(schema.diagramEntity.projectId, deleted.id))
      ).toHaveLength(0)
      expect(
        await db
          .select()
          .from(schema.projectMember)
          .where(eq(schema.projectMember.projectId, deleted.id))
      ).toHaveLength(0)
      expect(await findAccessibleProject(db, ownerId, kept.id)).not.toBeNull()
      expect(await deleteOwnedProject(db, ownerId, deleted.id)).toBe(false)
      expect(await deleteOwnedProject(db, ownerId, "invalid")).toBe(false)
    })

    test("invalid, unknown, and private project IDs have the same missing result", async () => {
      const created = await createUntitledProject(db, ownerId)
      expect(await findAccessibleProject(db, strangerId, created.id)).toBeNull()
      expect(await findAccessibleProject(db, ownerId, randomUUID())).toBeNull()
      expect(await findAccessibleProject(db, ownerId, "not-a-uuid")).toBeNull()
      expect(await findAccessibleProject(db, ownerId, "' OR 1=1 --")).toBeNull()
    })
  }
)
