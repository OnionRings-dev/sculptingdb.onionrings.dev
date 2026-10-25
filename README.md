# Sculpting DB

TanStack Start, React, shadcn/ui, Drizzle and PostgreSQL. Authentication uses this
app's Better Auth instance with OnionRings as its OIDC provider.

## Local setup

Requirements: Bun and Docker Compose.

```sh
bun install
bun run setup:env
bun run db:start
bun run db:migrate
```

`setup:env` creates an ignored `.env` with independent random database and app
secrets and does not overwrite an existing file. It never prints the secrets.
Add the registered `ONIONRINGS_CLIENT_ID` and `ONIONRINGS_CLIENT_SECRET` directly
to `.env`, then run:

```sh
bun run dev
```

The app runs at **http://localhost:3000**. Required server environment variables
are validated when the server entry is loaded. Missing credentials stop startup;
there is no authentication bypass or fallback user. See [.env.example](.env.example).

Docker runs PostgreSQL 18, exposes it only on `127.0.0.1:5432`, and persists data in
the `postgres_data` volume. `bun run db:stop` stops the database without deleting
data. If the port changes, update both `POSTGRES_PORT` and `DATABASE_URL`.
For a manually configured `.env`, URL-encode the database password in `DATABASE_URL`.

## OnionRings client registration

An administrator must register the development client at
https://auth.onionrings.dev/admin/ with these exact values:

| Field                            | Development value                                      |
| -------------------------------- | ------------------------------------------------------ |
| Name                             | Sculpting DB — Development                             |
| Application type                 | Web                                                    |
| Authentication                   | Confidential (`client_secret_basic`)                   |
| Callback                         | `http://localhost:3000/api/auth/callback/onionrings`   |
| Allowed authentication providers | Google, GitHub, or both, selected by the administrator |
| Browser origins                  | Empty                                                  |
| Post-logout callbacks            | Empty                                                  |
| Back-channel logout URL          | Empty                                                  |
| Require the session ID           | Disabled                                               |

Save the one-time client secret only in the app's server environment. The callback
is exact: `127.0.0.1`, a different port, or a trailing slash needs its own registered
callback. The destination after successful login is `/`.

Production needs a separate client registration and credentials. Set
`BETTER_AUTH_URL` to the production HTTPS origin, register
`<PRODUCTION_ORIGIN>/api/auth/callback/onionrings`, and use a new application secret
and production PostgreSQL connection. The production origin has not been selected
in this repository. Never use `VITE_*` variables for these values.

## Access and session behavior

- Anonymous visitors to `/` see a minimal landing page with an example schema
  and buttons that start OnionRings sign-in directly. Project data is loaded
  only for authenticated visitors.
  Other anonymous page requests, including unknown paths, redirect to `/`.
  Sign-in failures return to the landing with a recoverable message. `/login`
  is a compatibility redirect to `/`, preserving query parameters for old links
  and in-flight callbacks. MCP sign-in uses the landing and preserves its signed
  authorization request, including during a retry.
- All users authorized by OnionRings can create a local user at first login.
  There is no invitation or role restriction yet. The provider's allowed-provider
  and consent policies still apply.
- Better Auth handles the OAuth callback, code exchange, state, PKCE S256, nonce,
  signature, issuer and audience verification. The app additionally pins discovered
  metadata to `https://auth.onionrings.dev/api/auth`, including discovery retries.
- The `onionrings` provider ID is permanently bound to that issuer. Better Auth
  identifies its external accounts by the provider's `sub`, never by email.
  Changing the issuer requires an explicit identity/data migration. Account linking,
  including implicit linking by matching email, is disabled.
- `email_verified` is preserved. An unverified email does not independently prevent
  access: authorization comes from the IDP. Better Auth currently requires an email
  to create a local user; a missing email produces a recoverable login error.
  Missing names and images are allowed.
- Users, accounts, sessions and OAuth transactions live in PostgreSQL. Provider
  tokens are encrypted at rest; they are not placed in browser storage or cookies.
  The unused `/get-access-token` and `/refresh-token` auth endpoints are disabled.
  Only `openid profile email` is requested, without offline access.
- Session cookies are HttpOnly and SameSite=Lax, with Secure enabled for HTTPS
  and production. Cookie session caching is disabled, so backend authorization
  reads the session from the database. Responses use `Cache-Control: private, no-store`.
- The root route checks the server session on navigation and returns only user
  data to the router. App APIs under `/api/*` return **401** to anonymous callers;
  `/api/auth/*` stays public so Better Auth can handle login and callbacks.
  `/api/mcp` and legacy `/api/mcp/<project UUID>` authenticate bearer tokens and returns an
  OAuth discovery challenge without requiring a browser session; the signed
  consent redirect is public but its destination requires login.
  New server functions that expose app data or mutate it must call
  `requireUser(getRequestHeaders())` from `src/lib/auth/auth.server.ts` before doing
  their work. Router guards do not authorize server functions.
- **Log out** deletes the local app session and returns to the landing at `/`.
  It leaves the OnionRings SSO session active. Provider logout, back-channel logout, token
  refresh and cross-application logout are not implemented.

## Schema and migrations

The initial migration creates Better Auth's four core tables and their indexes,
including a unique `(provider_id, account_id)` external account key. It does not
drop existing tables. Apply committed migrations with `bun run db:migrate`.
After editing `src/db/schema.ts`, generate and review a new migration with
`bun run db:generate`. Back up production data before running production migrations.

The application schema adds personal workspaces, projects, per-project sharing
and email invitations, one entity/relationship diagram per project, revision
snapshots, and an expiring MCP connection lease per project. See
[the data model](docs/data-model.md) for constraints, lifecycle rules, and the
application behavior still to implement. Existing users are not automatically
given workspaces by this migration.

## Project flow

For authenticated users, the home page lists their projects and projects shared
with them, sorted by last update. Search filters names and descriptions locally. Cards show
diagram thumbnails and the owner's avatar only for projects shared with the
current user. **New** creates an untitled project and empty diagram in one
transaction, then opens `/projects/$projectId`.
The personal workspace is created on first project creation if necessary.

Project pages open a full-page React Flow entity/relationship editor. Both `view`
and `edit` members can open a shared project; private
and missing projects produce the same not-found page. Every project server
function authenticates the caller and reads access from the database. The account
menu contains appearance preferences and local logout. Dark mode is the initial
theme; users can choose light, dark, or their system preference.

Owned project cards have an options menu with a confirmed delete action. Deletion
checks ownership in the database and cascades to the project's contents; View/Edit
members cannot delete a shared project. Cards remain still on hover.

Click the project title to rename it inline (Enter or blur saves, Escape cancels).
Owners and Edit members can rename; View members see a read-only title. Renaming
does not create a diagram revision.

The owner can use **Invite people** next to the account menu to share with up to
20 registered email addresses at once. Autocomplete searches names and emails
after two characters, excluding the owner and existing members. Direct entry
and pasting multiple emails are supported. Choose View/Edit for the batch, then
adjust each collaborator's permission in the same dialog. Sharing grants access
immediately; no email is sent. Unknown emails reject the entire batch. Repeating
an invitation preserves existing permissions. These operations check ownership
on the server; Edit does not grant permission to manage sharing.
Each collaborator's permission menu also includes **Remove access**, with a
confirmation. Removal revokes access to that project and releases any MCP lease
held there by that collaborator, preserving the account, graph and history.

## Diagram editor

The canvas fills the project page. Navigation, account, editing and zoom controls
float over it. History opens on the left and reduces the canvas width instead of
covering it; it remains a separate column on small screens too.

- Add an entity with **Entity**, or select/double-click a node to edit it. Entity
  forms include descriptions and ordered attributes with freeform types, primary
  key, nullable, unique and textual default values. Attribute rows have a drag
  handle for reordering; keyboard users can focus it, press Space, move with the
  arrow keys and press Space again to drop, or Escape to cancel. **Save** commits
  the new order with the entity in one revision; **Cancel** discards the draft.
- Drag from an entity's right handle to another entity's left handle to connect
  them, or use **Add relationship**. Double-click a relationship or select it and
  choose **Edit selection** to change its endpoints, label and cardinalities.
- Move nodes by dragging or using arrow keys while selected. Delete selected
  nodes/relationships with the toolbar or Delete/Backspace. Deleting an entity
  removes its attributes and incident relationships.
- **Arrange diagram**, beside the zoom controls, uses ELK's layered layout to
  spread out entities using their measured sizes and primary-key connection
  points, then fits the result into view. It changes only positions, saves one
  history entry and can be restored through history. Repeating an unchanged
  layout does not add a revision. The layout engine loads on demand in a Web
  Worker; existing relationship routing remains, so crossings can still occur.
- Each completed form save, drag, keyboard move, connection, or deletion saves
  atomically with a full history snapshot. No-op saves, selection, zoom and pan
  do not create revisions. The first edit also captures the initial state, so an
  empty diagram can be restored.
- Selecting a history entry previews it without changing the current diagram.
  **Current** returns to the latest state; **Restore** appends a new revision
  without removing subsequent history. View members can inspect history, while
  owner/Edit access is required for changes and restores.

The server locks the diagram row and checks the client's expected revision.
Stale writes return the latest graph rather than overwriting it. A client allows
one save at a time, displays failures, and reverts an unsuccessful local move.
The open canvas receives authorized server-sent events and fetches changes from
other browser sessions or MCP automatically. Refresh waits while dragging, saving
or editing an entity/relationship form, and preserves history previews.

Diagram commands and validation live in `src/lib/diagram/model.ts`; persistence,
authorization, snapshots and restore live in `diagram-store.server.ts`. React Flow
state is converted at the UI boundary. MCP tools call the same transactional
service operations without depending on canvas internals. This initial implementation
replaces the project's normalized graph within the transaction and bounds it to
500 entities, 10,000 attributes and 5,000 relationships. Larger graphs and snapshot
retention can be optimized later.

## MCP

Use **MCP clients** beside the account menu inside a project. Its list shows the
clients connected to your account, with one switch per client to enable this
project. New connections start with no project access. **Connect** reveals the
single server URL and client setup instructions. **Disconnect** revokes a client
on all your projects, with confirmation. Project owners can disable a
collaborator's existing project grant, but cannot connect or enable their client
on their behalf.

The shared endpoint is `/api/mcp`, configured once as `sculpting-db`. Tools include
`list_projects`; all project tools require an explicit `projectId`. MCP
**2026-07-28** and stateless legacy initialization are supported. OAuth clients
register dynamically, use PKCE, and authorize the app through the existing
login. Each operation checks the client's project grant and current View/Edit
membership. One MCP lease per project expires after ten idle minutes; manual
edits remain available and revision checks protect concurrent work.

Old `/api/mcp/<projectId>` connections remain restricted to their original project
and are listed separately under **Project connections**, where they can be
revoked after moving to the shared endpoint. Existing authorizations are not
merged by client name: two clients named Codex can be separate installations.

Codex starts OAuth from `mcp add`, so the setup instructions do not automatically
run a second `mcp login`. That command is only a fallback if authorization is
still required.

Apply all migrations with `bun run db:migrate`, including
`0003_zippy_cable.sql` for account-level client connections. No additional
identity-provider registration or secrets are required. See
[MCP setup and behavior](docs/mcp.md) for configuration and tool contracts.

## Checks

```sh
bun run typecheck
bun run lint
bun run check
bun run build
bun test
```

Environment validation tests always run. PostgreSQL integration tests need an
explicitly configured **disposable** database whose name ends in `_test`. The
suites apply migrations; the OAuth suite truncates auth tables with `CASCADE`
before and after it runs. They never fall back to `DATABASE_URL`.

```sh
docker compose exec -T postgres createdb -U sculpting sculpting_db_test
```

Set `TEST_DATABASE_URL` in `.env` to the same local connection with the database
name changed to `sculpting_db_test`, then run `bun test`. Without it the integration
suite is skipped. The provider is simulated: no real OnionRings credentials or
identities are used. Coverage includes code exchange with Basic authentication,
PKCE, first login, stable subjects, disabled email linking, nonce/signature rejection,
consent denial, invalid/expired transactions, local logout, and issuer pinning after
a discovery outage.

Application schema tests also run against `TEST_DATABASE_URL`. They apply the
migrations and roll back their fixtures after each test. They cover project
isolation, sharing and invitation constraints, entity deletion, revision snapshots
and restore references, cascade behavior, and exclusive MCP lease records.

Project service tests cover concurrent workspace provisioning, project/diagram
creation, read access and revocation, and isolation of collaborator/preview data.
They remove only their own fixture users and cascading application records.

Diagram integration tests cover round-trip persistence, initial-state snapshots,
no-op saves, grouped deletion, restore, conflicting concurrent writes, current
permissions, invalid inputs, and transaction rollback on cross-project UUID
collisions.

The MCP integration suite additionally checks both protocol paths, PKCE, code
replay, refresh, project-bound tokens, atomic batches, mutation retries, manual
conflicts, exclusive leases, permission changes, revocation and live events.

Live identity-provider verification still requires registered credentials: sign in with OnionRings,
complete consent, return to the app, confirm access to `/`, and log out. Also deny
consent and confirm recovery on the landing. Passing the simulated tests and compilation
does not prove that the real client registration and selected IDP providers work.

## References

- [Better Auth Generic OAuth](https://better-auth.com/docs/plugins/generic-oauth)
- [Better Auth installation](https://better-auth.com/docs/installation)
- [TanStack Start integration](https://better-auth.com/docs/integrations/tanstack)
- [shadcn/ui](https://ui.shadcn.com/docs)
