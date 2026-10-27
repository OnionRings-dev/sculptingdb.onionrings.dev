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

## Self-hosting on Dokploy

Use a **Docker Compose** service (not Docker Stack), connect this Git repository,
and set **Compose Path** to `./compose.yaml`.

1. In **Environment**, set the following server variables. Generate independent
   random values for the database password and app secret (for example, run
   `openssl rand -hex 32` separately for each). Keep them stable across deployments.

   ```dotenv
   POSTGRES_PASSWORD=<random-database-password>
   BETTER_AUTH_URL=https://sculpting.example.com
   BETTER_AUTH_SECRET=<independent-random-secret-at-least-32-characters>
   ONIONRINGS_CLIENT_ID=<production-client-id>
   ONIONRINGS_CLIENT_SECRET=<production-client-secret>
   ```

   `ONIONRINGS_ISSUER` defaults to `https://auth.onionrings.dev/api/auth`.
   `DATABASE_URL`, host ports and build-time secrets are not needed: Compose
   generates its internal connection URL from `POSTGRES_PASSWORD`, including
   URL encoding. Register the production OnionRings client with callback
   `https://sculpting.example.com/api/auth/callback/onionrings` and exact post-logout
   callback `https://sculpting.example.com/`.

2. Enable **Isolated Deployments** so the app, migration job, database and Dokploy's
   Traefik can communicate on the deployment's network. No external network name
   or manual Traefik labels are needed. Use **Preview Compose** to check the
   generated networks and routing before deployment.
3. In **Domains**, add your hostname for service **app**, container port **3000**,
   path `/`, and enable **HTTPS** with a Let's Encrypt certificate. The domain's
   HTTPS origin must exactly match `BETTER_AUTH_URL`. Point its DNS to your server.
4. Deploy. Compose waits for PostgreSQL to be healthy, runs the one-shot `migrate`
   service, then starts the app. Failed migrations prevent app startup. Check the
   `app`, `migrate` and `postgres` logs from Dokploy if deployment fails.

The main Compose file publishes **no host ports**, avoiding conflicts with
Dokploy's own port 3000 and other databases. Traefik reaches `app:3000` internally;
PostgreSQL stays on the deployment network. Keep Isolated Deployments enabled:
without it, manually ensure all three services retain a shared network when
Dokploy adds its proxy network.

The production image uses a [Nitro Bun server](https://nitro.build/deploy/runtimes/bun)
and the pinned Alpine Bun runtime. Both app and migration images share the same
runtime layers. Build tools, source dependencies and environment files stay out
of the final images; only compiled output and, for the migration job, SQL
migrations are copied. The containers run as an unprivileged user. The builder
uses Debian for build-tool compatibility; the production output has no native
Node addons, so it can run on Alpine without copying Debian dependencies.

Compose sets `TRUST_PROXY=true` for HTTPS termination by Traefik. The proxy must
preserve `Host`, overwrite `X-Forwarded-Proto` with `https`, and support streaming
responses for diagram updates and MCP. Forwarded host headers never replace the
original host, and browser Origin checks still apply. Only expose the app through
a proxy you control. Production authentication requires HTTPS.

See Dokploy's documentation for [Compose environment variables](https://docs.dokploy.com/docs/core/docker-compose),
[domain routing](https://docs.dokploy.com/docs/core/docker-compose/domains) and
[Isolated Deployments](https://docs.dokploy.com/docs/core/docker-compose/utilities).

### Local Docker deployment

For a deployment outside Dokploy with a reverse proxy running on the host,
create `.env` without installing Bun on the host:

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app oven/bun:1.4.4-alpine bun scripts/setup-env.ts
```

The script generates independent database and app secrets and preserves an
existing `.env`. Set the HTTPS `BETTER_AUTH_URL` and production OnionRings
credentials, then add the local port overlay:

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build --wait
```

The overlay binds the app to `127.0.0.1:3000` and PostgreSQL to `127.0.0.1:5432`.
`APP_HOST`, `APP_PORT` and `POSTGRES_PORT` customize those bindings. Point your
HTTPS proxy at the app's host port. `bun run db:start` uses this overlay to start
only PostgreSQL for development; `bun run db:stop` stops it without deleting data.

### Persistence and updates

PostgreSQL data persists in the `postgres_data` named volume, including across
Dokploy redeployments. Do not change `POSTGRES_PASSWORD` without also changing the
existing database user's password. `docker compose down` preserves data;
`docker compose down -v` **deletes the database**.

Back up the database before an upgrade. From the deployment's Compose directory
and project context (or using the equivalent service console in Dokploy):

```sh
docker compose exec -T postgres pg_dump -U sculpting -d sculpting_db > backup.sql
```

Redeploy from Dokploy to rebuild and apply pending migrations. The migration job
runs again on each `up`; already applied migrations are skipped. For local Docker
deployments, repeat the `up -d --build --wait` command with both Compose files.
Inspect failures with `docker compose logs migrate`. A plain SQL backup can be
restored into a fresh database with
`docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U sculpting -d sculpting_db < backup.sql`.

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
| Post-logout callbacks            | `http://localhost:3000/`                               |
| Back-channel logout URL          | Empty                                                  |
| Require the session ID           | Disabled                                               |

Save the one-time client secret only in the app's server environment. The callback
is exact: `127.0.0.1`, a different port, or a trailing slash needs its own registered
callback. The destination after successful login is `/`.

Production needs a separate client registration and credentials. Set
`BETTER_AUTH_URL` to the production HTTPS origin, register
`<PRODUCTION_ORIGIN>/api/auth/callback/onionrings` and `<PRODUCTION_ORIGIN>/`
(including the final slash), and use a new application secret
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
- **Sign out** prepares the discovered end-session URL using this local session's
  own verified ID token, deletes the local session with Better Auth's CSRF and
  cookie protections, and navigates the browser to OnionRings. The exact registered
  return URL is the existing anonymous landing `/`. Callback parameters cannot
  override the endpoint, return URL or state. There is no logout success route or
  extra application confirmation. Missing/mismatched hints retain the provider's
  confirmation protections. An actual failure keeps a retry action available.
- Verified callback credentials are captured in supported account/session database
  hooks and encrypted in `session.onion_credentials` with `BETTER_AUTH_SECRET`.
  This private field is neither writable by clients nor returned in session APIs.
  The shared account's ID token is cleared rather than used as a device's hint.
  Sign-out cancels the browser's pending login transactions; a callback finishing
  late cannot restore usable credentials. No refresh flow or offline access is used.
- Every server session check, including public `/api/auth/get-session` and protected
  Better Auth endpoints, validates this session's access token against the trusted
  discovered UserInfo endpoint and compares `sub` to the verified sign-in subject.
  HTTP 401/403, token expiry, subject mismatch or a missing credential binding
  deletes only the corresponding local session. Browser navigation returns to `/`;
  protected application APIs return 401. Timeouts, network errors and provider
  failures deny access with 503 while preserving credentials for retry. Discovery
  metadata is cached for five minutes; successful UserInfo results are never cached.
  Open tabs recheck on focus/visibility/pageshow. Browser diagram streams recheck
  while streaming and stop on invalid sessions or provider failure.
- Central/account/admin logout therefore takes effect at the next protected check
  here, including after a tab regains focus. Other applications must perform the
  same checks; there is no instant push logout guarantee. Other devices remain
  signed in. Independent MCP OAuth grants, Google/GitHub sessions and offline
  grants are unchanged. No back-channel receiver is required or added.

### v0.1.3 logout rollout

Apply `0004_clumsy_mattie_franklin.sql` with `bun run db:migrate` before deploying
this code. It adds one nullable private session column without changing users,
accounts, permissions or other sessions. Existing sessions have no binding and
must sign in again; never backfill them from the shared account's latest tokens.
Keep `BETTER_AUTH_SECRET` stable: it encrypts the new per-session bindings as well
as existing OAuth tokens. No new environment variable or library upgrade is needed.

Register **exactly** `http://localhost:3000/` in the development client's
**Post-logout callbacks**, alongside its existing sign-in callback
`http://localhost:3000/api/auth/callback/onionrings`. This means HTTP, host
`localhost`, port `3000`, path `/`, no query, and the trailing slash. Production
uses `new URL("/", BETTER_AUTH_URL).href`; for the documented deployment example,
that is exactly `https://sculpting.example.com/`, with sign-in callback
`https://sculpting.example.com/api/auth/callback/onionrings`. Replace that example
host with the actual production `BETTER_AUTH_URL` origin; no production origin
is configured in this checkout. Register each additional environment separately.
Leave browser origins and back-channel settings as currently configured.

The provider must deploy its v0.1.3 revocation behavior. Verify two applications
on the same SSO session: sign out in A, return directly to A's landing, then have B
check UserInfo, reject its next protected request and clear its local session.
Repeat with central account/admin logout, another device, concurrent same-account
logins, expired tokens and provider outages. The simulated PostgreSQL suite covers
these session cases, but real application-B registration, provider/admin access,
and a second signed-in device are needed to prove the live cross-application flow.

Live verification on 2026-10-27 succeeded for hosted discovery, local sign-in,
protected access, absence of provider credentials from the public session API,
and one Sign out returning directly to `http://localhost:3000/` without an extra
confirmation. The local session was null, a protected API returned 401, and the
central account page was anonymous afterward. No registration changes were made.
The current provider account is denied administration access. Live application-B,
central/admin-initiated revocation, a separate device, concurrent same-account
hints, focus revalidation and injected provider-outage checks remain to run;
further browser inspection also encountered repeated automation timeouts.

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
menu contains appearance preferences and Sign out. Dark mode is the initial
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

Agents can use `get_diagram_view` for a PNG overview with coordinates, estimated
card bounds and overlap detection, and `arrange_diagram` to organize nodes using
the canvas layout engine. Layout direction and spacing are configurable; a save
creates one history entry and respects revision conflicts. `move_entities` in
`apply_changes` supports deliberate placement of individual nodes or groups.
Views and automatic layout run on the server without an open browser; image
geometry is estimated rather than a screenshot of the current viewport.

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
consent denial, invalid/expired transactions, encrypted session bindings, provider
logout hints under concurrent logins, peer/admin revocation, device isolation,
outage denial, callback cancellation, and issuer pinning after
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
