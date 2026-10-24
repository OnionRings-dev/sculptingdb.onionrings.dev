# Application data model

The initial scope is entity/relationship modeling, one diagram per project,
external AI clients connected through MCP, and direct edits. This document
describes the schema. Authenticated project listing, read access checks, and
atomic creation/deletion of projects are implemented in
`src/lib/projects/project-store.server.ts`, exposed through authenticated server
functions. `src/lib/diagram/diagram-store.server.ts` implements manual diagram
edits, revision checks, snapshots and restoration. Invitations and MCP connection
handling still need application services.

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
deletion. `edit` is for diagram changes, not project administration. Do not add
the owner as an invited member. These are service rules, not SQL authorization:
every future web/MCP operation must check the current user and current project
access on the server. Invitation role changes do not update existing membership
automatically.

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
  `zero_or_one` (0..1), `one` (1), `zero_or_many` (0..*), or `one_or_many` (1..*).
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

The future MCP service must acquire or replace an expired lease atomically,
renew it while connected, and release it on disconnect. Renewal/release must
match `leaseId`, so a stale client cannot affect a successor. Expiry alone does
not delete a row. Check current project access and the matching, unexpired lease
on each MCP operation; a lease is not an authorization grant. Authentication,
credentials, transport, heartbeat interval, and takeover behavior are deferred.
Membership removal or permission changes must also revoke the affected lease
in the service; deleting a membership alone does not cascade to its user's lease.

## Migrations and verification

`0001_application_model.sql` is additive: it adds three enums and ten application
tables without altering Better Auth's tables or copying user data. Generate
future migrations from `src/db/schema.ts` using `bun run db:generate` and apply
them with `bun run db:migrate`.

`tests/app-schema.integration.test.ts` exercises the actual migrations and
database constraints against `TEST_DATABASE_URL`, which must name a disposable
database ending in `_test`. Each test rolls back its own fixtures. Run it with
`bun test tests/app-schema.integration.test.ts`; it is skipped without that
explicit test database. The authentication suite still truncates auth tables
with `CASCADE`, so the shared test database must never contain data to keep.

Drizzle reference: [indexes and constraints](https://orm.drizzle.team/docs/indexes-constraints).
