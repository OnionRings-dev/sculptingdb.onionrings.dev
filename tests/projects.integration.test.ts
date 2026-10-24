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
  renameAccessibleProject,
} from "../src/lib/projects/project-store.server"
import {
  inviteProjectPeople,
  loadProjectSharing,
  searchProjectPeople,
  updateProjectMember,
  removeProjectMember,
} from "../src/lib/projects/sharing-store.server"
import {
  changeDiagram,
  loadDiagram,
  loadRevision,
} from "../src/lib/diagram/diagram-store.server"

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
          isOwner: true,
          owner: { id: ownerId, name: "Owner", image: null },
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

    test("summaries identify the owner for shared projects without exposing private projects or emails", async () => {
      const shared = await createUntitledProject(db, ownerId)
      const privateProject = await createUntitledProject(db, ownerId)
      const ownerImage = "https://example.test/owner.png"
      await db
        .update(schema.user)
        .set({ image: ownerImage })
        .where(eq(schema.user.id, ownerId))
      await db
        .update(schema.project)
        .set({ name: "Shop", description: "Orders and customers" })
        .where(eq(schema.project.id, shared.id))
      await db.insert(schema.projectMember).values([
        { projectId: shared.id, userId: collaboratorId, role: "view" },
        { projectId: shared.id, userId: strangerId, role: "edit" },
      ])
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
        isOwner: false,
        owner: { id: ownerId, name: "Owner", image: ownerImage },
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
      expect(ownerSummary.isOwner).toBe(true)
      expect(ownerSummary.owner).toEqual(summary.owner)
      expect(ownerSummary.canDelete).toBe(true)
      const [editorSummary] = await listAccessibleProjects(db, strangerId)
      expect(editorSummary.isOwner).toBe(false)
      expect(editorSummary.owner).toEqual(summary.owner)
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

    test("rename allows owner and Edit while preserving the diagram and denying View and strangers", async () => {
      const created = await createUntitledProject(db, ownerId)
      const before = await loadDiagram(db, ownerId, created.id)
      expect(
        await renameAccessibleProject(db, ownerId, {
          projectId: created.id,
          name: "  Shop  ",
        })
      ).toMatchObject({ name: "Shop" })
      await db
        .insert(schema.projectMember)
        .values({ projectId: created.id, userId: collaboratorId, role: "view" })
      for (const id of [collaboratorId, strangerId])
        expect(
          await renameAccessibleProject(db, id, {
            projectId: created.id,
            name: "Forbidden",
          })
        ).toBeNull()
      await db
        .update(schema.projectMember)
        .set({ role: "edit" })
        .where(eq(schema.projectMember.projectId, created.id))
      expect(
        await renameAccessibleProject(db, collaboratorId, {
          projectId: created.id,
          name: "Orders",
        })
      ).toMatchObject({ name: "Orders" })
      const after = await loadDiagram(db, ownerId, created.id)
      expect(after?.snapshot).toEqual(before?.snapshot)
      expect(after?.revision).toBe(before?.revision)
      expect(after?.history).toEqual(before?.history)
      expect((await listAccessibleProjects(db, ownerId))[0].name).toBe("Orders")
      expect(after?.canManageSharing).toBe(true)
      expect(
        (await loadDiagram(db, collaboratorId, created.id))?.canManageSharing
      ).toBe(false)
      await db
        .delete(schema.projectMember)
        .where(eq(schema.projectMember.projectId, created.id))
      expect(
        await renameAccessibleProject(db, collaboratorId, {
          projectId: created.id,
          name: "Revoked",
        })
      ).toBeNull()
      await expect(
        renameAccessibleProject(db, ownerId, {
          projectId: created.id,
          name: "   ",
        })
      ).rejects.toThrow()
      await expect(
        renameAccessibleProject(db, ownerId, {
          projectId: created.id,
          name: "x".repeat(121),
        })
      ).rejects.toThrow()
    })

    test("batch invitations normalize emails, give immediate access, and preserve existing permissions on retries", async () => {
      const created = await createUntitledProject(db, ownerId)
      const emails = [collaboratorId, strangerId, collaboratorId, ownerId].map(
        (id) => ` ${id.toUpperCase()}@EXAMPLE.TEST `
      )
      const input = { projectId: created.id, emails, role: "view" }
      const invited = await inviteProjectPeople(db, ownerId, input)
      expect(invited.ok).toBe(true)
      expect(
        (await loadProjectSharing(db, ownerId, created.id))?.members
      ).toHaveLength(2)
      for (const id of [collaboratorId, strangerId]) {
        expect(await findAccessibleProject(db, id, created.id)).not.toBeNull()
        expect((await loadDiagram(db, id, created.id))?.canEdit).toBe(false)
      }
      await inviteProjectPeople(db, ownerId, { ...input, role: "edit" })
      expect(
        (await loadProjectSharing(db, ownerId, created.id))?.members.every(
          (member) => member.role === "view"
        )
      ).toBe(true)
      expect(
        await updateProjectMember(db, ownerId, {
          projectId: created.id,
          userId: collaboratorId,
          role: "edit",
        })
      ).toBe(true)
      expect((await loadDiagram(db, collaboratorId, created.id))?.canEdit).toBe(
        true
      )
      expect((await loadDiagram(db, strangerId, created.id))?.canEdit).toBe(
        false
      )
      expect((await listAccessibleProjects(db, ownerId))[0].isOwner).toBe(true)
    })

    test("sharing and user discovery are owner-only even for an editor", async () => {
      const created = await createUntitledProject(db, ownerId)
      await db
        .insert(schema.projectMember)
        .values({ projectId: created.id, userId: collaboratorId, role: "edit" })
      for (const id of [collaboratorId, strangerId]) {
        expect(await loadProjectSharing(db, id, created.id)).toBeNull()
        expect(
          await searchProjectPeople(db, id, {
            projectId: created.id,
            query: "example.test",
          })
        ).toEqual([])
        expect(
          await inviteProjectPeople(db, id, {
            projectId: created.id,
            emails: [`${strangerId}@example.test`],
            role: "edit",
          })
        ).toEqual({ ok: false, reason: "forbidden" })
        expect(
          await updateProjectMember(db, id, {
            projectId: created.id,
            userId: collaboratorId,
            role: "view",
          })
        ).toBe(false)
      }
      expect(
        await updateProjectMember(db, ownerId, {
          projectId: created.id,
          userId: ownerId,
          role: "view",
        })
      ).toBe(false)
      expect((await loadDiagram(db, collaboratorId, created.id))?.canEdit).toBe(
        true
      )
      expect(await findAccessibleProject(db, strangerId, created.id)).toBeNull()
    })

    test("removing a collaborator revokes reads and writes only for that project while preserving graph and history", async () => {
      const shared = await createUntitledProject(db, ownerId)
      const kept = await createUntitledProject(db, ownerId)
      for (const projectId of [shared.id, kept.id]) {
        await inviteProjectPeople(db, ownerId, {
          projectId,
          emails: [`${collaboratorId}@example.test`],
          role: "edit",
        })
        await db.insert(schema.projectMcpLease).values({
          projectId,
          userId: collaboratorId,
          expiresAt: new Date(Date.now() + 60_000),
        })
      }
      const command = {
        type: "upsert_entity" as const,
        entity: {
          id: randomUUID(),
          name: "Customer",
          description: null,
          positionX: 0,
          positionY: 0,
        },
        attributes: [],
      }
      const edited = await changeDiagram(db, collaboratorId, {
        projectId: shared.id,
        expectedRevision: 0,
        command,
      })
      expect(edited.ok).toBe(true)
      const before = await loadDiagram(db, ownerId, shared.id)
      expect(
        await removeProjectMember(db, ownerId, {
          projectId: shared.id,
          userId: collaboratorId,
        })
      ).toBe(true)
      expect(await loadDiagram(db, collaboratorId, shared.id)).toBeNull()
      expect(
        await loadRevision(db, collaboratorId, shared.id, before!.revision)
      ).toBeNull()
      expect(
        await changeDiagram(db, collaboratorId, {
          projectId: shared.id,
          expectedRevision: before!.revision,
          command,
        })
      ).toEqual({ ok: false, reason: "forbidden" })
      expect(
        await renameAccessibleProject(db, collaboratorId, {
          projectId: shared.id,
          name: "Blocked",
        })
      ).toBeNull()
      expect(await loadDiagram(db, ownerId, shared.id)).toEqual(before)
      expect(
        (await loadProjectSharing(db, ownerId, shared.id))?.members
      ).toEqual([])
      expect(
        (await listAccessibleProjects(db, collaboratorId)).map((p) => p.id)
      ).toEqual([kept.id])
      expect(
        (
          await searchProjectPeople(db, ownerId, {
            projectId: shared.id,
            query: collaboratorId,
          })
        ).map((p) => p.id)
      ).toEqual([collaboratorId])
      expect(
        await db
          .select()
          .from(schema.projectMcpLease)
          .where(eq(schema.projectMcpLease.projectId, shared.id))
      ).toHaveLength(0)
      expect(
        await db
          .select()
          .from(schema.projectMcpLease)
          .where(eq(schema.projectMcpLease.projectId, kept.id))
      ).toHaveLength(1)
      expect(
        await db
          .select()
          .from(schema.user)
          .where(eq(schema.user.id, collaboratorId))
      ).toHaveLength(1)
      expect(
        await removeProjectMember(db, ownerId, {
          projectId: shared.id,
          userId: collaboratorId,
        })
      ).toBe(false)
      await inviteProjectPeople(db, ownerId, {
        projectId: shared.id,
        emails: [`${collaboratorId}@example.test`],
        role: "view",
      })
      expect((await loadDiagram(db, collaboratorId, shared.id))?.canEdit).toBe(
        false
      )
    })

    test("only the owner can remove a member, the owner cannot be removed, and another user's MCP lease is preserved", async () => {
      const created = await createUntitledProject(db, ownerId)
      await inviteProjectPeople(db, ownerId, {
        projectId: created.id,
        emails: [
          `${collaboratorId}@example.test`,
          `${strangerId}@example.test`,
        ],
        role: "edit",
      })
      await db.insert(schema.projectMcpLease).values({
        projectId: created.id,
        userId: ownerId,
        expiresAt: new Date(Date.now() + 60_000),
      })
      for (const role of ["view", "edit"] as const) {
        await updateProjectMember(db, ownerId, {
          projectId: created.id,
          userId: collaboratorId,
          role,
        })
        expect(
          await removeProjectMember(db, collaboratorId, {
            projectId: created.id,
            userId: strangerId,
          })
        ).toBe(false)
        expect(
          await removeProjectMember(db, collaboratorId, {
            projectId: created.id,
            userId: ownerId,
          })
        ).toBe(false)
      }
      const privateProject = await createUntitledProject(db, strangerId)
      expect(
        await removeProjectMember(db, ownerId, {
          projectId: privateProject.id,
          userId: collaboratorId,
        })
      ).toBe(false)
      expect(
        await removeProjectMember(db, ownerId, {
          projectId: created.id,
          userId: ownerId,
        })
      ).toBe(false)
      expect(
        (await loadProjectSharing(db, ownerId, created.id))?.members
      ).toHaveLength(2)
      expect(
        await removeProjectMember(db, ownerId, {
          projectId: created.id,
          userId: collaboratorId,
        })
      ).toBe(true)
      expect(
        (
          await db
            .select()
            .from(schema.projectMcpLease)
            .where(eq(schema.projectMcpLease.projectId, created.id))
        )[0].userId
      ).toBe(ownerId)
      expect(
        (await loadDiagram(db, ownerId, created.id))?.canManageSharing
      ).toBe(true)
      await expect(
        removeProjectMember(db, ownerId, {
          projectId: "invalid",
          userId: strangerId,
        })
      ).rejects.toThrow()
    })

    test("search matches names and emails literally and excludes owner and existing members", async () => {
      const created = await createUntitledProject(db, ownerId)
      await db
        .insert(schema.projectMember)
        .values({ projectId: created.id, userId: collaboratorId, role: "view" })
      expect(
        (
          await searchProjectPeople(db, ownerId, {
            projectId: created.id,
            query: strangerId.toUpperCase(),
          })
        ).map((person) => person.id)
      ).toEqual([strangerId])
      expect(
        await searchProjectPeople(db, ownerId, {
          projectId: created.id,
          query: collaboratorId,
        })
      ).toEqual([])
      expect(
        await searchProjectPeople(db, ownerId, {
          projectId: created.id,
          query: ownerId,
        })
      ).toEqual([])
      expect(
        await searchProjectPeople(db, ownerId, {
          projectId: created.id,
          query: "m",
        })
      ).toEqual([])
      expect(
        await searchProjectPeople(db, ownerId, {
          projectId: created.id,
          query: "%_",
        })
      ).toEqual([])
      expect(
        await searchProjectPeople(db, ownerId, {
          projectId: randomUUID(),
          query: strangerId,
        })
      ).toEqual([])
    })

    test("invalid and unknown invitees cannot partially share a project", async () => {
      const created = await createUntitledProject(db, ownerId)
      expect(
        await inviteProjectPeople(db, ownerId, {
          projectId: created.id,
          emails: [`${collaboratorId}@example.test`, "unknown@example.test"],
          role: "edit",
        })
      ).toEqual({
        ok: false,
        reason: "unknown_users",
        emails: ["unknown@example.test"],
      })
      for (const emails of [
        [],
        ["not-an-email"],
        Array(21).fill(`${collaboratorId}@example.test`),
      ]) {
        await expect(
          inviteProjectPeople(db, ownerId, {
            projectId: created.id,
            emails,
            role: "edit",
          })
        ).rejects.toThrow()
      }
      expect(
        (await loadProjectSharing(db, ownerId, created.id))?.members
      ).toEqual([])
      expect(
        await findAccessibleProject(db, collaboratorId, created.id)
      ).toBeNull()
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
