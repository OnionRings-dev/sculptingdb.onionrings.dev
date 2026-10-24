# Application data model

The initial scope is entity/relationship modeling, one diagram per project,
external AI clients connected through MCP, and direct edits. This document
describes the schema. Authenticated project listing, read access checks, and
atomic creation/deletion of projects are implemented in
`src/lib/projects/project-store.server.ts`, exposed through authenticated server
functions. `src/lib/diagram/diagram-store.server.ts` implements manual diagram
edits, revision checks, snapshots and restoration. Project renaming and registered
user sharing are implemented in the project services, including
`src/lib/projects/sharing-store.server.ts`. Invitation delivery/acceptance for
unregistered users remains deferred. MCP connection handling lives in
`src/lib/mcp/`; see [MCP setup and behavior](mcp.md).

## Workspaces and sharing

- `workspace` belongs to one Better Auth user. The unique owner constraint allows
  at most one personal workspace per user. Creating the first project provisions
  it lazily, including for existing users. An upsert handles concurrent creation;
  the migration itself does not create workspaces.
- `project` belongs to a workspace. Its owner is the workspace owner, so there is
  no separate project owner column that can disagree with workspace ownership.
- `project_member` gives a registered user `view` or `edit` access to a specific
  project. The same user may have different roles on different projects.
  Sharing a project does not grant access to the rest of its workspace.
- `project_invitation` stores an email invitation even before its recipient has
  registered. Emails must be trimmed and lowercase. Store only the hash of a
  random invitation token; the original token belongs only in the invitation.
  There is one invitation record per project/email. Reinviting updates that
  record with a new hash, expiry, role, and a cleared `acceptedAt`; revocation
  deletes it. Acceptance must check expiry, single use, and ownership of the
  verified email, then create membership and set `acceptedAt` atomically.

The owner implicitly has full access and manages invitations, roles, and project
deletion. `edit` allows diagram changes and project renaming. Do not add
the owner as an invited member. These are service rules, not SQL authorization:
every future web/MCP operation must check the current user and current project
access on the server. Invitation role changes do not update existing membership
automatically.

The current web sharing flow creates `project_member` records directly for
registered accounts; it sends no email and does not use `project_invitation`.
Email addresses are trimmed and matched case-insensitively, batches are capped at
20, and any unknown address rejects the entire batch. Duplicate invitations are
idempotent and preserve existing roles; a separate owner-only operation changes
an individual member's role. User search requires project ownership, at least two
characters and returns at most ten matching accounts. Sharing and renaming do not
change diagram revisions or snapshots.
The owner can remove a membership through the same sharing service. The operation
locks the project, deletes only the selected project/user membership and any MCP
lease held by that user on that project in one transaction. It also revokes
their MCP authorizations, so re-inviting the account requires a new consent. It preserves the
user's account, other memberships and revision authorship. Subsequent reads,
writes and history requests check access again; the owner cannot be removed.

Application IDs are database-generated UUIDs; user references preserve Better
Auth's existing text IDs. Timestamps use PostgreSQL `timestamptz`. `updatedAt`
uses Drizzle's update callback, not a database trigger. Raw SQL must update it
explicitly, and child edits must also touch the diagram/project timestamps in
their transaction if those are used for recent-project sorting.

## Diagram contents

`diagram` uses `projectId` as its primary key, enforcing at most one diagram per
project. The project creation service creates both records in one transaction.
Its `revision` starts at zero for the initial empty state.

- `diagram_entity` contains a name, optional description, and canvas coordinates.
  Positions are stored separately from semantic properties and must be finite.
  Entity names need not be unique while sketching.
- `diagram_attribute` belongs to an entity. It contains its name, freeform data
  type, description, nullable/primary-key/unique flags, optional textual default,
  and display order. Attribute names are unique within the entity. Primary-key
  attributes must explicitly be non-nullable. Multiple attributes may participate
  in a composite primary key; `isUnique` describes individual attributes only.
  Defaults are model text and must never be executed by the application.
  Sort attributes by `sortOrder`, then `id` to break ties.
- `diagram_relationship` connects two entities with cardinality at each endpoint:
  `zero_or_one` (0..1), `one` (1), `zero_or_many` (0.._), or `one_or_many` (1.._).
  Self-relations, several relations between the same entities, and many-to-many
  relations are allowed. Composite foreign keys ensure both endpoints belong to
  the same project. These are conceptual entity relations; attribute-level foreign
  keys, compound unique constraints, and database-engine-specific types are deferred.

Deleting an entity cascades to its attributes and incident relationships.
Deleting a workspace cascades to its projects and all their contents, including
history and sharing. Deleting an owner therefore also deletes their workspace.
Deleting a collaborator removes their memberships/leases and sets their history
author and invitation author references to null, preserving other owners' projects.

## History

`diagram_revision` is identified by `(projectId, revision)`. It stores the acting
user (also for AI edits), origin (`manual`, `mcp`, or `restore`), a human-readable
summary, creation time, and a complete typed JSONB snapshot. Snapshot version 1
includes entity IDs, names, descriptions and positions, attributes, and relations.
It excludes project ownership, invitations, and access permissions. Restoring a
diagram must never restore old access rights.

Snapshots survive edits and entity deletions. The database checks the envelope
version and required arrays; runtime validation of their contents, IDs, and
references remains necessary. Drizzle's TypeScript type does not validate MCP
input. Change the snapshot format version and add compatibility handling when
the stored format changes.

The editing service uses the following write transaction:

1. Check current access, lock the diagram row, recheck Edit/owner access and
   compare its revision with the version the client read. Reject stale writes.
2. Validate the complete logical change and replace this project's normalized
   graph while preserving entity, attribute and relationship UUIDs.
3. Increment `diagram.revision`, append the resulting complete snapshot at that
   revision, and update timestamps within the same transaction.

A restore appends a new revision with `origin = restore` and
`restoredFromRevision` pointing to an earlier revision of the same diagram.
Revision zero is the initial state before the first edit. On that first edit,
the service captures the starting diagram at revision one and records the change
at revision two, in the same transaction. This also handles existing diagrams
whose counter is still zero. The original empty state can then be restored from
revision one. Committed revisions are never updated or deleted individually by
the service; the schema does not install append-only triggers. Each form save,
completed move, connection or selection deletion is one change. No-op edits,
zoom, pan and selection do not create history. Previewing a version is read-only.
Personal undo/redo shortcuts and finer history grouping remain deferred.

## One MCP connection per project

`project_mcp_lease` reserves one row per project, with the acting user, a unique
lease identifier, acquisition time, and expiry. This models one connected MCP
client per project; it does not restrict how many users can view the web app or
prevent concurrent manual edits. The same user may connect to different projects.

The MCP service acquires/replaces leases under diagram/project row locks. A lease
lasts ten minutes and renews on successful operations. A new client cannot take
an active lease; the holder calls `release_project`, the owner revokes its grant,
or the lease expires. Renewal and release require the exact lease ID and
project/user/client authorization, so a stale client cannot affect a successor.
Connecting a client or listing its tools does not acquire a lease.

`mcp_connection` records app-level user/OAuth-client consent, unique per user
and client, with a rotating key and revocation timestamp. App JWTs carry its
ID/key and the single `/api/mcp` audience. `mcp_authorization` records the
separate project/user/client grants toggled in the editor. A client is initially
connected with zero enabled projects; enabling another project reuses the same
app token. Project tools require `projectId` explicitly and check both levels
of authorization and current membership. The account never stores a global
active project.

Disabling a project grant rotates its key and removes that client's project
lease. Global client disconnect rotates its connection key, revokes all its
project grants, removes their leases, and deletes matching OAuth credentials in
one transaction. Project operations hold a shared connection-row lock during
their transaction, serializing against disconnect. Users manage their own
connections; project owners can disable collaborators' project grants but
cannot enable another user's client or disconnect it from other projects.
Membership removal revokes only that user's grants for the affected project.
Role changes apply on the next operation. A read-only token cannot gain write
scope through a later membership upgrade without new consent.

The old project endpoints and project-bound JWTs remain supported, without
converting them to account-level access. They use their original grant IDs/keys
and are listed separately for manual revocation. The schema intentionally does
not identify or merge installations by a client-supplied display name.

`mcp_mutation` records a request UUID, normalized payload hash and result revision
for each project/authorization. Exact mutation retries return the original
revision; reusing the UUID with different arguments fails. The mutation, snapshot
and receipt commit together. Receipts are retained until the project or grant
is deleted; a new lease does not erase them.

Better Auth's JWT and OAuth Provider plugins use `jwks`, `oauth_client`,
`oauth_resource`, `oauth_client_resource`, `oauth_refresh_token`,
`oauth_access_token`, `oauth_consent` and `oauth_client_assertion`. The application
prepares the shared resource when its connection dialog or OAuth discovery is
opened. Legacy project-resource records remain valid for existing connections. OAuth resource
catalog records are independent of project rows; deleting a project revokes
access through the project/grant checks, but does not purge its catalog record.

## Migrations and verification

`0001_application_model.sql` is additive: it adds three enums and ten application
tables without altering Better Auth's tables or copying user data.
`0002_foamy_shaman.sql` adds OAuth storage, project grants and mutation receipts
and extends leases with an authorization reference.
`0003_zippy_cable.sql` adds account-level MCP connections without changing or
merging existing project grants. Generate future migrations from `src/db/schema.ts` using `bun run db:generate` and apply
them with `bun run db:migrate`.

`tests/app-schema.integration.test.ts` exercises the actual migrations and
database constraints against `TEST_DATABASE_URL`, which must name a disposable
database ending in `_test`. Each test rolls back its own fixtures. Run it with
`bun test tests/app-schema.integration.test.ts`; it is skipped without that
explicit test database. The authentication suite still truncates auth tables
with `CASCADE`, so the shared test database must never contain data to keep.

Drizzle reference: [indexes and constraints](https://orm.drizzle.team/docs/indexes-constraints).
