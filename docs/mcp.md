# MCP

The app exposes one remote MCP endpoint at `<BETTER_AUTH_URL>/api/mcp`.
Open **MCP clients** in a project and choose **Connect** to copy its setup.

## Connect a client

For Codex CLI, add the server once:

```sh
codex mcp add sculpting-db --url http://localhost:3000/api/mcp --oauth-client-registration dcr
```

`mcp add` detects OAuth and starts authorization. Do not immediately run a second
login: that can register another client and open a second consent page. If the
client still requires authentication, use `codex mcp login sculpting-db` as a
separate recovery action. Restart an already-running session to load a new server.

For OpenCode v2, merge this server into `opencode.json`, preserving other settings:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "sculpting-db": {
        "type": "remote",
        "url": "http://localhost:3000/api/mcp",
        "protocol": "2026-07-28"
      }
    }
  }
}
```

Then run `opencode mcp auth sculpting-db` and check `opencode mcp list`.
Authorize the app in the browser. Return to the project's **MCP clients** panel
and switch on access for the client. A newly connected client sees no projects
until enabled. Use the same client connection across projects; enable each one
explicitly. A new project never inherits access automatically.

Clients with the same display name remain separate, distinguished by a short
connection ID. Their authorizations must not be merged merely because both are
called Codex. Existing project-specific connections are shown under **Project
connections** with a revoke action. They keep working on their original endpoint
until revoked. Reconfigure each client once with `/api/mcp` and then revoke old
project authorizations. Remove the old server entries from Codex/OpenCode
configuration too, so startup does not try to reconnect them. Revoking an app
authorization does not delete the external client configuration.

The URL must use the exact configured app origin; `localhost` and `127.0.0.1` are
different origins. Production uses HTTPS. A remote client must be able to reach
the app; its own `localhost` does not point to a developer's computer.

The original project endpoints were verified with Codex CLI 0.164.0 and OpenCode
2.1.4. The shared endpoint is covered by OAuth and tool-call integration tests
using both modern and legacy SDK clients, plus browser verification of consent,
project switches, diagram updates and disconnect, without model inference.

## Agent workflow

Ask the agent to list available projects, choose one, inspect the diagram and
make the desired changes. Server instructions and JSON schemas describe the tool contract:

| Tool               | Purpose                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `list_projects`    | List projects explicitly enabled for this client and still accessible to its user.                    |
| `open_project`     | Acquire the project's MCP lease and return the current graph, revision and effective edit permission. |
| `get_diagram`      | Read the complete current graph.                                                                      |
| `apply_changes`    | Apply 1–100 ordered edits atomically, with one summary and history entry.                             |
| `list_history`     | Read revision metadata, with pages of up to 50 entries.                                               |
| `restore_revision` | Restore an earlier snapshot by appending a new revision.                                              |
| `release_project`  | Release the exact lease so another client can use the project.                                        |

Every project tool requires an explicit `projectId`; there is no global active
project. `list_projects` needs no lease. All tools after `open_project` also
require its `leaseId`. Leases last ten idle minutes;
successful calls renew them. Another client, including a different client used
by the same user, cannot acquire an active lease. The web editor remains usable.
Closing a client does not reliably notify a stateless server: ask the agent to
release the project, revoke the grant in the dialog, or wait for expiry.

Entity, attribute and relationship IDs are UUIDs. Entity upserts replace the
entity's entire attribute list. Batches are ordered: create entities before their
relationships. Deleting an entity removes its attributes and incident relations.
The first edit captures the baseline at revision 1 and the edited graph at
revision 2; subsequent logical changes increment once. No-op edits create no
history entry. Restores have origin `restore`; other agent edits have origin `mcp`.

Mutations require `expectedRevision` and a UUID `requestId`. If a response is lost,
retry with the same request ID and arguments. The server returns the original
revision instead of duplicating the change. A changed payload requires a new ID.
On `conflict`, read the graph, reconsider the change and submit a new request ID.
An invalid batch rolls back completely. A `lease_expired` response requires
`open_project` again; `project_busy` means another client holds the lease.

## Authorization and updates

The app is both the protected resource and an OAuth authorization server through
Better Auth OAuth Provider. The existing OnionRings login authenticates the user;
MCP clients never receive OnionRings credentials or the app's session cookie.
Dynamic registration supports public native clients, authorization code with PKCE
S256, and refresh tokens. Discovery endpoints publish authorization-server and
project-resource metadata. JWT access tokens expire after 15 minutes; refresh
tokens expire after 30 days.

App consent creates a unique `mcp_connection` for the user and OAuth client.
Tokens have the shared endpoint as their audience and contain the connection's
ID and rotating key. Separate `mcp_authorization` records enable individual
projects. Requests check current connection/client status; project tools also
check current project grants and membership inside their transactions. No graph
or project metadata is exposed until its grant is enabled.

View members can read and inspect history; owner/Edit members can modify and
restore. Role changes take effect on the next operation. App-level write scope
never overrides a project's View permission. A read-only token remains read-only
even after a membership upgrade until reauthorized with write scope. Removing a
member revokes their grants for that project; their app connection and other
project grants remain valid. Re-inviting does not restore previous MCP access.

The panel lists the user's app clients, including those with this project off.
Owners additionally see collaborators' clients with active grants for this
project. Users enable their own clients; an owner may disable a collaborator's
project grant but cannot opt that person's client in or disconnect it globally.
Switching off revokes just the project grant, rotates its key and deletes its
lease, without invalidating the app token or other projects. Switching back on
requires a new lease. **Disconnect** is owner-of-the-client only: it rotates the
app connection key, revokes all that client's project grants, releases leases,
and removes OAuth access/refresh/consent credentials in one transaction.

Legacy project-bound tokens remain restricted to their original audience and
project grant. A legacy token is rejected by the shared endpoint, and an app
token is rejected by a legacy endpoint. Browser logout does not disconnect MCP
clients; use the panel's disconnect action.

The browser receives authenticated SSE hints backed by one database poll per
second per open editor. It refetches the graph/history only when their version or
permissions change. Refresh is deferred during a drag, save or open entity/
relationship form and preserves history previews. Streams recheck membership,
close on revocation, and reconnect periodically. This is suitable for the initial
version; many simultaneous editors would benefit from shared notifications.

## Operation and scope

Apply the committed migrations with `bun run db:migrate`. Existing app environment
variables are sufficient; use a stable `BETTER_AUTH_SECRET` because stored JWT
signing keys depend on it. Reverse proxies must preserve the configured public
origin and allow SSE streaming. Do not cache OAuth, MCP or project event responses.

The server uses SDK 2.4 with the 2026-07-28 stateless protocol and stateless legacy
initialization support for clients that still use `initialize`. The tool catalog
is identical across roles; execution enforces each user's permissions. Tool
errors expose structured codes without database details. Model descriptions are
untrusted data. Proof-bound DPoP tokens are rejected by the resource handler;
these clients use bearer tokens.

MCP Apps/widgets, embedded chat, automatic layout, multi-client editing and
history/receipt retention policies are outside this first version. The browser
editor is the interactive visualization; conversation stays in Codex/OpenCode.

References: [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
[TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/),
[Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider),
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[OpenCode MCP](https://opencode.ai/v2/docs/mcp).
