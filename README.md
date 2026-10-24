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

- Anonymous page requests, including unknown paths, redirect to `/login`.
  The login page shows one centered **Login** button, plus a recoverable message
  if sign-in fails. Authenticated users visiting `/login` return to `/`.
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
  New server functions that expose app data or mutate it must call
  `requireUser(getRequestHeaders())` from `src/lib/auth/auth.server.ts` before doing
  their work. Router guards do not authorize server functions.
- **Log out** deletes the local app session and returns to `/login`. It leaves
  the OnionRings SSO session active. Provider logout, back-channel logout, token
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

The home page lists the current user's projects and projects shared with them,
sorted by last update. Search filters names and descriptions locally. Cards show
diagram thumbnails and other collaborators' avatars. **New** creates an untitled
project and empty diagram in one transaction, then opens `/projects/$projectId`.
The personal workspace is created on first project creation if necessary.

Project pages currently show only their name and description, with navigation
back to the list. Both `view` and `edit` members can open a shared project; private
and missing projects produce the same not-found page. Every project server
function authenticates the caller and reads access from the database. The account
menu contains appearance preferences and local logout. Dark mode is the initial
theme; users can choose light, dark, or their system preference.

Owned project cards have an options menu with a confirmed delete action. Deletion
checks ownership in the database and cascades to the project's contents; View/Edit
members cannot delete a shared project. Cards remain still on hover.

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

Live verification still requires registered credentials: sign in with OnionRings,
complete consent, return to the app, confirm access to `/`, and log out. Also deny
consent and confirm recovery on `/login`. Passing the simulated tests and compilation
does not prove that the real client registration and selected IDP providers work.

## References

- [Better Auth Generic OAuth](https://better-auth.com/docs/plugins/generic-oauth)
- [Better Auth installation](https://better-auth.com/docs/installation)
- [TanStack Start integration](https://better-auth.com/docs/integrations/tanstack)
- [shadcn/ui](https://ui.shadcn.com/docs)
