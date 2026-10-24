import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_subject_idx").on(
      table.providerId,
      table.accountId
    ),
  ]
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const projectRole = pgEnum("project_role", ["view", "edit"])
export const relationshipCardinality = pgEnum("relationship_cardinality", [
  "zero_or_one",
  "one",
  "zero_or_many",
  "one_or_many",
])
export const diagramChangeOrigin = pgEnum("diagram_change_origin", [
  "manual",
  "mcp",
  "restore",
])

// Better Auth owns the text user IDs; application records use database UUIDs.
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()

export const workspace = pgTable(
  "workspace",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("workspace_owner_user_unique").on(table.ownerUserId),
    check("workspace_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ]
)

export const project = pgTable(
  "project",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("project_workspace_id_idx").on(table.workspaceId),
    check("project_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ]
)

// Ownership comes from the workspace, independently of invited members' roles.
export const projectMember = pgTable(
  "project_member",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_member_user_id_idx").on(table.userId),
  ]
)

// Invitations can precede registration. Reinviting replaces this record's token.
export const projectInvitation = pgTable(
  "project_invitation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: projectRole("role").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("project_invitation_project_email_unique").on(
      table.projectId,
      table.email
    ),
    unique("project_invitation_token_hash_unique").on(table.tokenHash),
    index("project_invitation_email_idx").on(table.email),
    index("project_invitation_invited_by_idx").on(table.invitedByUserId),
    check(
      "project_invitation_email_normalized",
      sql`${table.email} = lower(btrim(${table.email})) AND ${table.email} <> ''`
    ),
    check(
      "project_invitation_token_hash_not_blank",
      sql`btrim(${table.tokenHash}) <> ''`
    ),
    check(
      "project_invitation_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`
    ),
  ]
)

// The project ID is also the diagram ID: at most one diagram per project.
export const diagram = pgTable(
  "diagram",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => project.id, { onDelete: "cascade" }),
    revision: integer("revision").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("diagram_revision_nonnegative", sql`${table.revision} >= 0`),
  ]
)

export const diagramEntity = pgTable(
  "diagram_entity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => diagram.projectId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    positionX: doublePrecision("position_x").default(0).notNull(),
    positionY: doublePrecision("position_y").default(0).notNull(),
  },
  (table) => [
    // Composite relationship FKs prevent edges crossing project boundaries.
    unique("diagram_entity_project_id_unique").on(table.projectId, table.id),
    check("diagram_entity_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check(
      "diagram_entity_position_finite",
      sql`${table.positionX} > '-Infinity'::float8 AND ${table.positionX} < 'Infinity'::float8 AND ${table.positionY} > '-Infinity'::float8 AND ${table.positionY} < 'Infinity'::float8`
    ),
  ]
)

export const diagramAttribute = pgTable(
  "diagram_attribute",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => diagramEntity.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dataType: text("data_type").notNull(),
    description: text("description"),
    isNullable: boolean("is_nullable").default(true).notNull(),
    isPrimaryKey: boolean("is_primary_key").default(false).notNull(),
    isUnique: boolean("is_unique").default(false).notNull(),
    defaultValue: text("default_value"),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    unique("diagram_attribute_entity_name_unique").on(
      table.entityId,
      table.name
    ),
    check("diagram_attribute_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check(
      "diagram_attribute_data_type_not_blank",
      sql`btrim(${table.dataType}) <> ''`
    ),
    check(
      "diagram_attribute_sort_order_nonnegative",
      sql`${table.sortOrder} >= 0`
    ),
    check(
      "diagram_attribute_primary_key_not_nullable",
      sql`NOT ${table.isPrimaryKey} OR NOT ${table.isNullable}`
    ),
  ]
)

export const diagramRelationship = pgTable(
  "diagram_relationship",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    sourceEntityId: uuid("source_entity_id").notNull(),
    targetEntityId: uuid("target_entity_id").notNull(),
    label: text("label"),
    description: text("description"),
    sourceCardinality: relationshipCardinality("source_cardinality").notNull(),
    targetCardinality: relationshipCardinality("target_cardinality").notNull(),
  },
  (table) => [
    foreignKey({
      name: "diagram_relationship_source_fk",
      columns: [table.projectId, table.sourceEntityId],
      foreignColumns: [diagramEntity.projectId, diagramEntity.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "diagram_relationship_target_fk",
      columns: [table.projectId, table.targetEntityId],
      foreignColumns: [diagramEntity.projectId, diagramEntity.id],
    }).onDelete("cascade"),
    index("diagram_relationship_source_idx").on(
      table.projectId,
      table.sourceEntityId
    ),
    index("diagram_relationship_target_idx").on(
      table.projectId,
      table.targetEntityId
    ),
  ]
)

// Snapshots omit ownership and sharing: restoring a diagram must not restore ACLs.
export type DiagramSnapshot = {
  schemaVersion: 1
  entities: Array<Omit<typeof diagramEntity.$inferSelect, "projectId">>
  attributes: Array<typeof diagramAttribute.$inferSelect>
  relationships: Array<
    Omit<typeof diagramRelationship.$inferSelect, "projectId">
  >
}

export const diagramRevision = pgTable(
  "diagram_revision",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => diagram.projectId, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    origin: diagramChangeOrigin("origin").notNull(),
    summary: text("summary").notNull(),
    snapshot: jsonb("snapshot").$type<DiagramSnapshot>().notNull(),
    restoredFromRevision: integer("restored_from_revision"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.revision] }),
    index("diagram_revision_actor_user_id_idx").on(table.actorUserId),
    foreignKey({
      name: "diagram_revision_restored_from_fk",
      columns: [table.projectId, table.restoredFromRevision],
      foreignColumns: [table.projectId, table.revision],
    }),
    check("diagram_revision_positive", sql`${table.revision} > 0`),
    check(
      "diagram_revision_summary_not_blank",
      sql`btrim(${table.summary}) <> ''`
    ),
    check(
      "diagram_revision_snapshot_shape",
      sql`(jsonb_typeof(${table.snapshot}) = 'object' AND ${table.snapshot} @> '{"schemaVersion": 1}'::jsonb AND jsonb_typeof(${table.snapshot}->'entities') = 'array' AND jsonb_typeof(${table.snapshot}->'attributes') = 'array' AND jsonb_typeof(${table.snapshot}->'relationships') = 'array') IS TRUE`
    ),
    check(
      "diagram_revision_restore_origin",
      sql`(${table.origin} = 'restore') = (${table.restoredFromRevision} IS NOT NULL)`
    ),
    check(
      "diagram_revision_restore_precedes_revision",
      sql`${table.restoredFromRevision} > 0 AND ${table.restoredFromRevision} < ${table.revision}`
    ),
  ]
)

// A renewable lease, not MCP authentication. Acquire/replace it atomically.
export const projectMcpLease = pgTable(
  "project_mcp_lease",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    leaseId: uuid("lease_id").defaultRandom().notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("project_mcp_lease_id_unique").on(table.leaseId),
    index("project_mcp_lease_user_id_idx").on(table.userId),
    check(
      "project_mcp_lease_expiry_after_acquisition",
      sql`${table.expiresAt} > ${table.acquiredAt}`
    ),
  ]
)
