# MCP

Each project exposes a remote MCP endpoint at
`<BETTER_AUTH_URL>/api/mcp/<PROJECT_UUID>`. Open **Connect MCP** in the editor to
prepare the resource and copy the actual URL and client configuration.

## Connect a client

For Codex CLI:

```sh
codex mcp add sculpting-project --url http://localhost:3000/api/mcp/PROJECT_UUID
codex mcp login sculpting-project --oauth-client-registration dcr
```

Authorize the named project in the browser. Restart an already-running Codex
session to load the new server. Use a distinct server name for each project.
The explicit DCR registration method matches the server's public-client flow.

For OpenCode v2, merge the following server into `opencode.json` (preserve existing
settings and replace the URL with the value from the dialog):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "sculpting-project": {
        "type": "remote",
        "url": "http://localhost:3000/api/mcp/PROJECT_UUID",
        "protocol": "2026-07-28"
      }
    }
  }
}
```

Then run:

```sh
opencode mcp auth sculpting-project
opencode mcp list
```

The URL must use the exact configured app origin; `localhost` and `127.0.0.1` are
different origins. Production uses HTTPS. A remote client must be able to reach
the app; its own `localhost` does not point to a developer's computer.

Codex CLI 0.164.0 was verified through OAuth login and native tool discovery;
OpenCode 2.1.4 was verified through OAuth login and connected status with the
2026-07-28 protocol pinned. Integration tests exercise tool calls through both
modern and legacy SDK clients, without model inference.

## Agent workflow

Ask the agent to open the project, inspect the diagram, and make the desired
changes. Server instructions and JSON schemas describe the tool contract:

| Tool               | Purpose                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `open_project`     | Acquire the project's MCP lease and return the current graph, revision and effective edit permission. |
| `get_diagram`      | Read the complete current graph.                                                                      |
| `apply_changes`    | Apply 1–100 ordered edits atomically, with one summary and history entry.                             |
| `list_history`     | Read revision metadata, with pages of up to 50 entries.                                               |
| `restore_revision` | Restore an earlier snapshot by appending a new revision.                                              |
| `release_project`  | Release the exact lease so another client can use the project.                                        |

All tools after `open_project` require its `leaseId`. Leases last ten idle minutes;
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

Consent authorizes one project and limits requested scopes to current access.
View members can read and inspect history; owner/Edit members can modify and
restore. The backend rechecks current grants and membership on every operation.
Removing a member revokes their project grants and lease. Changing their role
applies immediately to subsequent operations. A token issued with read scope
alone requires new consent to gain write scope after a role upgrade.

The connection dialog lists the current lease and authorized clients. Users can
revoke their own grants; project owners can revoke any grant for that project.
Revocation invalidates the project's grant key, removes its stored OAuth
credentials and releases its lease. Signing out of the browser does not revoke
MCP grants: use **Revoke access** to do that.

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
