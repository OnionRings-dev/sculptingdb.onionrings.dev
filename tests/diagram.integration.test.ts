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
import { createUntitledProject } from "../src/lib/projects/project-store.server"
import {
  changeDiagram,
  loadDiagram,
  loadRevision,
} from "../src/lib/diagram/diagram-store.server"
import type {
  Attribute,
  DiagramCommand,
  Entity,
} from "../src/lib/diagram/model"

const databaseURL = process.env.TEST_DATABASE_URL
const makeEntity = (name = "Customer"): Entity => ({
  id: randomUUID(),
  name,
  description: null,
  positionX: 0,
  positionY: 0,
})
const makeAttribute = (entity: Entity): Attribute => ({
  id: randomUUID(),
  entityId: entity.id,
  name: "id",
  dataType: "uuid",
  description: null,
  isNullable: false,
  isPrimaryKey: true,
  isUnique: false,
  defaultValue: "gen_random_uuid()",
  sortOrder: 0,
})

describe.skipIf(!databaseURL)(
  "diagram editing and history with PostgreSQL",
  () => {
    const pool = new Pool({ connectionString: databaseURL })
    const db = drizzle(pool, { schema })
    const ownerId = randomUUID()
    const memberId = randomUUID()
    const strangerId = randomUUID()
    const userIds = [ownerId, memberId, strangerId]
    let projectId: string
    let revision: number

    async function edit(command: DiagramCommand) {
      const result = await changeDiagram(db, ownerId, {
        projectId,
        expectedRevision: revision,
        command,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("Unexpected edit rejection")
      revision = result.data.revision
      return result.data
    }

    beforeAll(async () => {
      if (!new URL(databaseURL!).pathname.endsWith("_test"))
        throw new Error(
          "TEST_DATABASE_URL must point to a disposable database ending in _test"
        )
      await migrate(db, { migrationsFolder: "./drizzle" })
    })
    beforeEach(async () => {
      await db.insert(schema.user).values(
        userIds.map((id) => ({
          id,
          name: "Diagram test user",
          email: `${id}@example.test`,
        }))
      )
      projectId = (await createUntitledProject(db, ownerId)).id
      revision = 0
    })
    afterEach(async () => {
      if (databaseURL && new URL(databaseURL).pathname.endsWith("_test"))
        await db.delete(schema.user).where(inArray(schema.user.id, userIds))
    })
    afterAll(async () => {
      await pool.end()
    })

    test("the first entity saves its fields and captures the restorable initial state", async () => {
      const entity = makeEntity()
      const attribute = makeAttribute(entity)
      const data = await edit({
        type: "upsert_entity",
        entity,
        attributes: [attribute],
      })
      expect(data.snapshot.entities).toEqual([entity])
      expect(data.snapshot.attributes).toEqual([attribute])
      expect(data.revision).toBe(2)
      expect(data.history.map(({ revision: version }) => version)).toEqual([
        2, 1,
      ])
      expect(data.history[0]).toMatchObject({
        origin: "manual",
        actorName: "Diagram test user",
        summary: "Added “Customer”",
      })
      expect((await loadRevision(db, ownerId, projectId, 1))?.entities).toEqual(
        []
      )
      expect((await loadDiagram(db, ownerId, projectId))?.snapshot).toEqual(
        data.snapshot
      )
    })

    test("editing an entity preserves identifiers, groups its attributes and skips no-op saves", async () => {
      const entity = makeEntity()
      const attribute = makeAttribute(entity)
      await edit({ type: "upsert_entity", entity, attributes: [attribute] })
      const renamed = { ...entity, name: "Account" }
      const data = await edit({
        type: "upsert_entity",
        entity: renamed,
        attributes: [attribute],
      })
      expect(data.snapshot.entities).toEqual([renamed])
      expect(data.revision).toBe(3)
      const noChange = await edit({
        type: "upsert_entity",
        entity: renamed,
        attributes: [attribute],
      })
      expect(noChange.revision).toBe(3)
      expect(noChange.history).toHaveLength(3)
      const moved = await edit({
        type: "move_entities",
        positions: [{ id: entity.id, x: 220, y: 80 }],
      })
      expect(moved.snapshot.entities[0]).toMatchObject({
        id: entity.id,
        positionX: 220,
        positionY: 80,
      })
      expect(moved.revision).toBe(4)
    })

    test("entity deletion cascades within a single change and restore appends the complete earlier graph", async () => {
      const customer = makeEntity()
      const order = makeEntity("Order")
      const attribute = makeAttribute(customer)
      await edit({
        type: "upsert_entity",
        entity: customer,
        attributes: [attribute],
      })
      await edit({ type: "upsert_entity", entity: order, attributes: [] })
      const relationship = {
        id: randomUUID(),
        sourceEntityId: customer.id,
        targetEntityId: order.id,
        sourceCardinality: "one" as const,
        targetCardinality: "zero_or_many" as const,
        label: "places",
        description: null,
      }
      const linked = await edit({ type: "upsert_relationship", relationship })
      const removed = await edit({
        type: "delete_selection",
        entityIds: [customer.id],
        relationshipIds: [],
      })
      expect(removed.snapshot.entities).toEqual([order])
      expect(removed.snapshot.attributes).toEqual([])
      expect(removed.snapshot.relationships).toEqual([])
      expect(removed.revision).toBe(linked.revision + 1)
      const restored = await edit({
        type: "restore",
        revision: linked.revision,
      })
      expect(restored.snapshot).toEqual(linked.snapshot)
      expect(restored.history).toHaveLength(removed.history.length + 1)
      const [stored] = await db
        .select()
        .from(schema.diagramRevision)
        .where(eq(schema.diagramRevision.revision, restored.revision))
      expect(stored).toMatchObject({
        origin: "restore",
        restoredFromRevision: linked.revision,
        actorUserId: ownerId,
      })
      const empty = await edit({ type: "restore", revision: 1 })
      expect(empty.snapshot.entities).toHaveLength(0)
      expect(empty.history).toHaveLength(restored.history.length + 1)
    })

    test("concurrent clients cannot overwrite a revision they have not read", async () => {
      const commands = [makeEntity("First"), makeEntity("Second")].map(
        (entity) => ({
          projectId,
          expectedRevision: 0,
          command: { type: "upsert_entity" as const, entity, attributes: [] },
        })
      )
      const results = await Promise.all(
        commands.map((command) => changeDiagram(db, ownerId, command))
      )
      expect(results.filter(({ ok }) => ok)).toHaveLength(1)
      const conflict = results.find((result) => !result.ok)
      expect(conflict).toMatchObject({
        ok: false,
        reason: "conflict",
        data: { revision: 2 },
      })
      const current = await loadDiagram(db, ownerId, projectId)
      expect(current?.snapshot.entities).toHaveLength(1)
      expect(current?.history).toHaveLength(2)
    })

    test("View may read history but cannot edit or restore; Edit is checked again on each operation", async () => {
      await edit({
        type: "upsert_entity",
        entity: makeEntity(),
        attributes: [],
      })
      await db
        .insert(schema.projectMember)
        .values({ projectId, userId: memberId, role: "view" })
      expect((await loadDiagram(db, memberId, projectId))?.canEdit).toBe(false)
      expect(await loadRevision(db, memberId, projectId, 1)).not.toBeNull()
      expect(
        await changeDiagram(db, memberId, {
          projectId,
          expectedRevision: revision,
          command: { type: "restore", revision: 1 },
        })
      ).toEqual({ ok: false, reason: "forbidden" })
      await db
        .update(schema.projectMember)
        .set({ role: "edit" })
        .where(eq(schema.projectMember.projectId, projectId))
      const result = await changeDiagram(db, memberId, {
        projectId,
        expectedRevision: revision,
        command: {
          type: "upsert_entity",
          entity: makeEntity("Order"),
          attributes: [],
        },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("Edit access should work")
      await db
        .delete(schema.projectMember)
        .where(eq(schema.projectMember.projectId, projectId))
      expect(
        await changeDiagram(db, memberId, {
          projectId,
          expectedRevision: result.data.revision,
          command: { type: "restore", revision: 1 },
        })
      ).toEqual({ ok: false, reason: "forbidden" })
      expect(await loadDiagram(db, strangerId, projectId)).toBeNull()
      expect(await loadRevision(db, strangerId, projectId, 1)).toBeNull()
      expect(await loadDiagram(db, ownerId, "invalid")).toBeNull()
    })

    test("invalid references, duplicate attributes and non-finite positions are rejected without history changes", async () => {
      const entity = makeEntity()
      const attribute = makeAttribute(entity)
      const before = await edit({
        type: "upsert_entity",
        entity,
        attributes: [attribute],
      })
      await expect(
        changeDiagram(db, ownerId, {
          projectId,
          expectedRevision: revision,
          command: {
            type: "upsert_entity",
            entity,
            attributes: [attribute, { ...attribute, id: randomUUID() }],
          },
        })
      ).rejects.toThrow()
      await expect(
        changeDiagram(db, ownerId, {
          projectId,
          expectedRevision: revision,
          command: {
            type: "move_entities",
            positions: [{ id: entity.id, x: Number.NaN, y: 0 }],
          },
        })
      ).rejects.toThrow()
      await expect(
        changeDiagram(db, ownerId, {
          projectId,
          expectedRevision: revision,
          command: {
            type: "upsert_relationship",
            relationship: {
              id: randomUUID(),
              sourceEntityId: entity.id,
              targetEntityId: randomUUID(),
              sourceCardinality: "one",
              targetCardinality: "one",
              label: null,
              description: null,
            },
          },
        })
      ).rejects.toThrow()
      expect(await loadDiagram(db, ownerId, projectId)).toEqual(before)
    })

    test("a UUID collision with another project rolls back graph and history together", async () => {
      const otherProjectId = (await createUntitledProject(db, strangerId)).id
      const collision = makeEntity("Private entity")
      await db
        .insert(schema.diagramEntity)
        .values({ ...collision, projectId: otherProjectId })
      const before = await loadDiagram(db, ownerId, projectId)
      await expect(
        changeDiagram(db, ownerId, {
          projectId,
          expectedRevision: 0,
          command: { type: "upsert_entity", entity: collision, attributes: [] },
        })
      ).rejects.toThrow()
      expect(await loadDiagram(db, ownerId, projectId)).toEqual(before)
      expect(
        (await loadDiagram(db, strangerId, otherProjectId))?.snapshot.entities
      ).toEqual([collision])
    })
  }
)
