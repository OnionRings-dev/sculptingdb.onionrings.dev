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
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type { PoolClient } from "pg"
import type { DiagramSnapshot } from "../src/db/schema"
import * as schema from "../src/db/schema"

const databaseURL = process.env.TEST_DATABASE_URL
const emptySnapshot: DiagramSnapshot = {
  schemaVersion: 1,
  entities: [],
  attributes: [],
  relationships: [],
}

describe.skipIf(!databaseURL)("application schema with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseURL })
  let client: PoolClient | undefined
  let db: NodePgDatabase<typeof schema>
  const ids = {
    owner: randomUUID(),
    otherOwner: randomUUID(),
    guest: randomUUID(),
    workspace: randomUUID(),
    otherWorkspace: randomUUID(),
    project: randomUUID(),
    otherProject: randomUUID(),
    customer: randomUUID(),
    order: randomUUID(),
    otherEntity: randomUUID(),
  }

  // A failed PostgreSQL statement aborts its transaction. Savepoints let a test
  // verify several rejections and still exercise the remaining valid records.
  async function rejectsConstraint(
    operation: () => PromiseLike<unknown>,
    constraint: string,
    code = "23514"
  ) {
    await client!.query("SAVEPOINT expected_violation")
    try {
      await expect(Promise.resolve(operation())).rejects.toMatchObject({
        cause: { code, constraint },
      })
    } finally {
      await client!.query("ROLLBACK TO SAVEPOINT expected_violation")
      await client!.query("RELEASE SAVEPOINT expected_violation")
    }
  }

  const relationship = () => ({
    projectId: ids.project,
    sourceEntityId: ids.customer,
    targetEntityId: ids.order,
    sourceCardinality: "one" as const,
    targetCardinality: "zero_or_many" as const,
  })
  const revision = (number: number) => ({
    projectId: ids.project,
    revision: number,
    actorUserId: ids.guest,
    origin: "manual" as const,
    summary: "Update diagram",
    snapshot: emptySnapshot,
  })

  beforeAll(async () => {
    if (!new URL(databaseURL!).pathname.endsWith("_test"))
      throw new Error(
        "TEST_DATABASE_URL must point to a disposable database ending in _test"
      )
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" })
  })

  beforeEach(async () => {
    client = await pool.connect()
    await client.query("BEGIN")
    db = drizzle(client, { schema })
    await db.insert(schema.user).values(
      [ids.owner, ids.otherOwner, ids.guest].map((id) => ({
        id,
        name: "Schema test user",
        email: `${id}@example.test`,
      }))
    )
    await db.insert(schema.workspace).values([
      { id: ids.workspace, ownerUserId: ids.owner, name: "Personal workspace" },
      {
        id: ids.otherWorkspace,
        ownerUserId: ids.otherOwner,
        name: "Other workspace",
      },
    ])
    await db.insert(schema.project).values([
      { id: ids.project, workspaceId: ids.workspace, name: "Shop" },
      {
        id: ids.otherProject,
        workspaceId: ids.otherWorkspace,
        name: "Other project",
      },
    ])
    await db
      .insert(schema.diagram)
      .values([{ projectId: ids.project }, { projectId: ids.otherProject }])
    await db.insert(schema.diagramEntity).values([
      { id: ids.customer, projectId: ids.project, name: "Customer" },
      { id: ids.order, projectId: ids.project, name: "Order" },
      {
        id: ids.otherEntity,
        projectId: ids.otherProject,
        name: "Other entity",
      },
    ])
  })

  afterEach(async () => {
    if (client) {
      await client.query("ROLLBACK")
      client.release()
      client = undefined
    }
  })

  afterAll(async () => {
    await pool.end()
  })

  test("one personal workspace and diagram, with project-specific sharing", async () => {
    await rejectsConstraint(
      () =>
        db.insert(schema.workspace).values({
          ownerUserId: ids.owner,
          name: "Duplicate workspace",
        }),
      "workspace_owner_user_unique",
      "23505"
    )
    await rejectsConstraint(
      () => db.insert(schema.diagram).values({ projectId: ids.project }),
      "diagram_pkey",
      "23505"
    )
    await db.insert(schema.projectMember).values([
      { projectId: ids.project, userId: ids.guest, role: "view" },
      { projectId: ids.otherProject, userId: ids.guest, role: "edit" },
    ])
    await rejectsConstraint(
      () =>
        db.insert(schema.projectMember).values({
          projectId: ids.project,
          userId: ids.guest,
          role: "edit",
        }),
      "project_member_project_id_user_id_pk",
      "23505"
    )
    const memberships = await db
      .select()
      .from(schema.projectMember)
      .where(eq(schema.projectMember.userId, ids.guest))
    expect(memberships.map(({ role }) => role).sort()).toEqual(["edit", "view"])
  })

  test("invites unregistered emails once per project and requires normalized addresses", async () => {
    const invitation = {
      projectId: ids.project,
      email: "future-member@example.test",
      role: "edit" as const,
      invitedByUserId: ids.owner,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    }
    await db.insert(schema.projectInvitation).values(invitation)
    await rejectsConstraint(
      () =>
        db.insert(schema.projectInvitation).values({
          ...invitation,
          tokenHash: randomUUID(),
        }),
      "project_invitation_project_email_unique",
      "23505"
    )
    await rejectsConstraint(
      () =>
        db.insert(schema.projectInvitation).values({
          ...invitation,
          email: " MixedCase@example.test ",
          tokenHash: randomUUID(),
        }),
      "project_invitation_email_normalized"
    )
    await db.insert(schema.projectInvitation).values({
      ...invitation,
      projectId: ids.otherProject,
      tokenHash: randomUUID(),
    })
  })

  test("attributes preserve types and defaults and reject nullable primary keys", async () => {
    const attribute = {
      entityId: ids.customer,
      name: "id",
      dataType: "uuid",
      isPrimaryKey: true,
      isNullable: false,
      defaultValue: "gen_random_uuid()",
    }
    const [stored] = await db
      .insert(schema.diagramAttribute)
      .values(attribute)
      .returning()
    expect(stored).toMatchObject({ ...attribute, sortOrder: 0 })
    await rejectsConstraint(
      () =>
        db.insert(schema.diagramAttribute).values({
          ...attribute,
          name: "nullable_key",
          isNullable: true,
        }),
      "diagram_attribute_primary_key_not_nullable"
    )
    await rejectsConstraint(
      () =>
        db.insert(schema.diagramAttribute).values({
          ...attribute,
          name: "negative_order",
          sortOrder: -1,
        }),
      "diagram_attribute_sort_order_nonnegative"
    )
    await db
      .insert(schema.diagramAttribute)
      .values({ ...attribute, entityId: ids.order })
  })

  test("relationships cannot cross projects, but support self-relations and many-to-many", async () => {
    await rejectsConstraint(
      () =>
        db.insert(schema.diagramRelationship).values({
          ...relationship(),
          sourceEntityId: ids.otherEntity,
        }),
      "diagram_relationship_source_fk",
      "23503"
    )
    await rejectsConstraint(
      () =>
        db.insert(schema.diagramRelationship).values({
          ...relationship(),
          targetEntityId: ids.otherEntity,
        }),
      "diagram_relationship_target_fk",
      "23503"
    )
    await db.insert(schema.diagramRelationship).values([
      { ...relationship(), targetEntityId: ids.customer, label: "refers" },
      { ...relationship(), sourceCardinality: "one_or_many", label: "buys" },
    ])
  })

  test("deleting an entity removes its fields and edges without touching the other project", async () => {
    await db.insert(schema.diagramAttribute).values({
      entityId: ids.customer,
      name: "email",
      dataType: "string",
    })
    const [edge] = await db
      .insert(schema.diagramRelationship)
      .values(relationship())
      .returning()
    await db
      .delete(schema.diagramEntity)
      .where(eq(schema.diagramEntity.id, ids.customer))
    expect(
      await db
        .select()
        .from(schema.diagramAttribute)
        .where(eq(schema.diagramAttribute.entityId, ids.customer))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.diagramRelationship)
        .where(eq(schema.diagramRelationship.id, edge.id))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.diagramEntity)
        .where(eq(schema.diagramEntity.projectId, ids.otherProject))
    ).toHaveLength(1)
  })

  test("snapshots survive entity deletion and restores append a revision in the same project", async () => {
    const [entity] = await db
      .select()
      .from(schema.diagramEntity)
      .where(eq(schema.diagramEntity.id, ids.customer))
    const { projectId: _projectId, ...snapshotEntity } = entity
    const snapshot: DiagramSnapshot = {
      ...emptySnapshot,
      entities: [snapshotEntity],
    }
    await db.insert(schema.diagramRevision).values([
      { ...revision(1), snapshot },
      { ...revision(2), origin: "mcp", summary: "Remove customer" },
      { ...revision(3), origin: "restore", restoredFromRevision: 1, snapshot },
    ])
    await db
      .delete(schema.diagramEntity)
      .where(eq(schema.diagramEntity.id, ids.customer))
    const revisions = await db
      .select()
      .from(schema.diagramRevision)
      .where(eq(schema.diagramRevision.projectId, ids.project))
      .orderBy(schema.diagramRevision.revision)
    expect(revisions).toHaveLength(3)
    expect(revisions[0].snapshot).toEqual(snapshot)
    expect(revisions[2].snapshot).toEqual(snapshot)
    await rejectsConstraint(
      () =>
        db.insert(schema.diagramRevision).values({
          ...revision(4),
          projectId: ids.otherProject,
          origin: "restore",
          restoredFromRevision: 1,
        }),
      "diagram_revision_restored_from_fk",
      "23503"
    )
    await rejectsConstraint(
      () =>
        db.insert(schema.diagramRevision).values({
          ...revision(4),
          origin: "restore",
          restoredFromRevision: 4,
        }),
      "diagram_revision_restore_precedes_revision"
    )
    await rejectsConstraint(
      () =>
        db
          .insert(schema.diagramRevision)
          .values({ ...revision(4), origin: "restore" }),
      "diagram_revision_restore_origin"
    )
  })

  test("malformed JSON snapshots are rejected even when bypassing TypeScript", async () => {
    for (const snapshot of [
      sql`'null'::jsonb`,
      sql`'{"schemaVersion":1}'::jsonb`,
    ]) {
      await rejectsConstraint(
        () =>
          db
            .insert(schema.diagramRevision)
            .values({ ...revision(1), snapshot }),
        "diagram_revision_snapshot_shape"
      )
    }
  })

  test("deleting a collaborator account preserves history and releases their MCP lease", async () => {
    await db.insert(schema.projectMember).values({
      projectId: ids.project,
      userId: ids.guest,
      role: "edit",
    })
    await db.insert(schema.diagramRevision).values(revision(1))
    await db.insert(schema.projectMcpLease).values({
      projectId: ids.project,
      userId: ids.guest,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.delete(schema.user).where(eq(schema.user.id, ids.guest))
    const [stored] = await db
      .select()
      .from(schema.diagramRevision)
      .where(eq(schema.diagramRevision.projectId, ids.project))
    expect(stored.actorUserId).toBeNull()
    expect(stored.snapshot).toEqual(emptySnapshot)
    expect(
      await db
        .select()
        .from(schema.projectMcpLease)
        .where(eq(schema.projectMcpLease.projectId, ids.project))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.projectMember)
        .where(eq(schema.projectMember.userId, ids.guest))
    ).toHaveLength(0)
  })

  test("only one MCP lease occupies a project, with a valid expiry", async () => {
    const lease = {
      projectId: ids.project,
      userId: ids.owner,
      expiresAt: new Date(Date.now() + 60_000),
    }
    await db.insert(schema.projectMcpLease).values(lease)
    await rejectsConstraint(
      () =>
        db
          .insert(schema.projectMcpLease)
          .values({ ...lease, userId: ids.guest }),
      "project_mcp_lease_pkey",
      "23505"
    )
    await rejectsConstraint(
      () =>
        db.insert(schema.projectMcpLease).values({
          ...lease,
          projectId: ids.otherProject,
          expiresAt: new Date(0),
        }),
      "project_mcp_lease_expiry_after_acquisition"
    )
    await db
      .insert(schema.projectMcpLease)
      .values({ ...lease, projectId: ids.otherProject })
  })

  test("deleting a workspace cascades through its projects, including restored history", async () => {
    await db
      .insert(schema.diagramRevision)
      .values([
        revision(1),
        { ...revision(2), origin: "restore", restoredFromRevision: 1 },
      ])
    await db
      .insert(schema.diagramAttribute)
      .values({ entityId: ids.customer, name: "email", dataType: "string" })
    await db.insert(schema.diagramRelationship).values(relationship())
    await db
      .insert(schema.projectMember)
      .values({ projectId: ids.project, userId: ids.guest, role: "view" })
    await db.insert(schema.projectInvitation).values({
      projectId: ids.project,
      email: "pending@example.test",
      role: "view",
      invitedByUserId: ids.owner,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db.insert(schema.projectMcpLease).values({
      projectId: ids.project,
      userId: ids.owner,
      expiresAt: new Date(Date.now() + 60_000),
    })
    await db
      .delete(schema.workspace)
      .where(eq(schema.workspace.id, ids.workspace))
    for (const table of [
      schema.diagram,
      schema.diagramEntity,
      schema.diagramRelationship,
      schema.diagramRevision,
      schema.projectMember,
      schema.projectInvitation,
      schema.projectMcpLease,
    ]) {
      expect(
        await db.select().from(table).where(eq(table.projectId, ids.project))
      ).toHaveLength(0)
    }
    expect(
      await db
        .select()
        .from(schema.diagramAttribute)
        .where(eq(schema.diagramAttribute.entityId, ids.customer))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.project)
        .where(eq(schema.project.id, ids.project))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.project)
        .where(eq(schema.project.id, ids.otherProject))
    ).toHaveLength(1)
  })
})
