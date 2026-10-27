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
    // Server-only encrypted OIDC credentials, bound to this individual session.
    onionCredentials: text("onion_credentials"),
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
    authorizationId: uuid("authorization_id"),
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

export const mcpAuthorization = pgTable(
  "mcp_authorization",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    key: uuid("key").defaultRandom().notNull().unique(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("mcp_authorization_principal_unique").on(
      table.projectId,
      table.userId,
      table.clientId
    ),
  ]
)

export const mcpMutation = pgTable(
  "mcp_mutation",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    authorizationId: uuid("authorization_id")
      .notNull()
      .references(() => mcpAuthorization.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    revision: integer("revision").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.authorizationId, table.requestId],
    }),
  ]
)

// Better Auth OAuth Provider 1.7.12 and JWT plugin storage.
// Field names follow the installed plugin schemas.

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  alg: text("alg"),
  crv: text("crv"),
})

export const oauthClient = pgTable("oauth_client", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  clientDiscoveryId: text("client_discovery_id"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skip_consent"),
  enableEndSession: boolean("enable_end_session"),
  subjectType: text("subject_type"),
  scopes: text("scopes").array(),
  clientCredentialsScopes: text("client_credentials_scopes")
    .array()
    .default([]),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("software_id"),
  softwareVersion: text("software_version"),
  softwareStatement: text("software_statement"),
  redirectUris: text("redirect_uris").array().notNull(),
  postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
  backchannelLogoutUri: text("backchannel_logout_uri"),
  backchannelLogoutSessionRequired: boolean(
    "backchannel_logout_session_required"
  ),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
  applicationType: text("application_type"),
  jwks: text("jwks"),
  jwksUri: text("jwks_uri"),
  grantTypes: text("grant_types").array(),
  responseTypes: text("response_types").array(),
  requirePKCE: boolean("require_p_k_c_e"),
  dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
  referenceId: text("reference_id"),
  metadata: jsonb("metadata"),
})

export const oauthResource = pgTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean(
    "dpop_bound_access_tokens_required"
  ).default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
})

export const oauthClientResource = pgTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }),
  },
  (table) => [
    unique("oauth_client_resource_0_unique").on(
      table.clientId,
      table.resourceId
    ),
  ]
)

export const oauthRefreshToken = pgTable("oauth_refresh_token", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => session.id, {
    onDelete: "set null",
  }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  revoked: timestamp("revoked", { withTimezone: true }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  rotationReplayResponse: text("rotation_replay_response"),
  rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", {
    withTimezone: true,
  }),
  authTime: timestamp("auth_time", { withTimezone: true }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
})

export const oauthAccessToken = pgTable("oauth_access_token", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => session.id, {
    onDelete: "set null",
  }),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  authorizationCodeId: text("authorization_code_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  refreshId: text("refresh_id").references(() => oauthRefreshToken.id, {
    onDelete: "cascade",
  }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  revoked: timestamp("revoked", { withTimezone: true }),
  confirmation: jsonb("confirmation"),
  scopes: text("scopes").array().notNull(),
})

export const oauthConsent = pgTable("oauth_consent", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClient.clientId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  referenceId: text("reference_id"),
  resources: text("resources").array(),
  requestedUserInfoClaims: text("requested_user_info_claims").array(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
})

// Account-level MCP consent. Project access remains an explicit, separate grant.
export const mcpConnection = pgTable(
  "mcp_connection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    key: uuid("key").defaultRandom().notNull().unique(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("mcp_connection_principal_unique").on(table.userId, table.clientId),
  ]
)
