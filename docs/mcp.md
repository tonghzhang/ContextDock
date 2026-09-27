# Local MCP server

ContextDock exposes a local **stdio** MCP server. It does not listen on a network
port or require a cloud service. It calls the same workspace service and SQLite
database as the desktop and CLI.

Build the project with `npm install` and `npm run build`. Use Node.js 24 or newer
for the source build. Add an entry like this to your MCP client's configuration,
replacing the illustrative path with the absolute path to your local checkout:

```json
{
  "mcpServers": {
    "contextdock": {
      "command": "node",
      "args": ["C:/Projects/ContextDock/dist/mcp.cjs"]
    }
  }
}
```

Client configuration file locations vary. Use the client's local stdio server
configuration interface. Start the server directly for diagnostics with
`npm run mcp`; it waits for MCP messages on stdin and writes only protocol messages
to stdout. Diagnostics go to stderr. Do not use `npm` as the command in an MCP
configuration, because npm can print extra text to stdout.

By default, data is stored at `%LOCALAPPDATA%\ContextDock\contextdock.sqlite`.
To select another local directory, add `"--data-dir", "C:/ContextDockData"` to the
argument array, or set `CONTEXTDOCK_DATA_DIR` in the MCP process environment. Use
the same directory in the desktop and CLI if you want all three to share data.

## Tools

| Tool                    | Arguments                                                                             | Result                    |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| `list_workspaces`       | none                                                                                  | `{ "workspaces": [...] }` |
| `get_workspace`         | `workspace`                                                                           | `{ "workspace": {...} }`  |
| `open_workspace`        | `workspace`                                                                           | `{ "report": {...} }`     |
| `create_workspace`      | `name`, optional `description`                                                        | `{ "workspace": {...} }`  |
| `add_workspace_item`    | `workspace`, `type`, `name`, `target`; optional `arguments`, `enabled`, `launchOrder` | `{ "item": {...} }`       |
| `remove_workspace_item` | `workspace`, `itemId`                                                                 | `{ "removed": "..." }`    |

`workspace` accepts an ID or case-insensitive name. `type` is `application`, `file`,
`folder`, or `url`. `arguments` is a string array, supported only for applications.
`launchOrder` is a zero-based insertion position; omitting it appends the item.
File, folder, and application paths must be absolute. Applications must be `.exe`
files. URLs must use HTTP or HTTPS. These rules are enforced by the shared service.

Example tool arguments:

```json
{
  "workspace": "ModelMux",
  "type": "url",
  "name": "Redis documentation",
  "target": "https://redis.io",
  "enabled": true
}
```

All tools return JSON in both text content and `structuredContent`. Service errors
return `isError: true` and an `error` message. A partially failed Resume also returns
`isError: true` but retains the full `report`, including successful, failed, and
skipped items. Success means Windows accepted the launch request, not that the
application or website finished loading.

## Local access

Configure this server only in MCP clients you trust. A connected client can modify
saved workspaces and call `open_workspace` to run saved local applications with
their arguments. Ask the user before resuming a workspace. Tool annotations mark
read-only tools and identify actions with local or external side effects; annotations
are descriptive, not an access-control boundary. No tokens belong in the database
or configuration examples. Removing a bookmark never deletes its target file.

The MCP adapter is isolated in `src/mcp`; transport setup and protocol schemas do
not appear in the core workspace service. Its tests exercise the real MCP client
and server over the SDK's in-memory transport with an isolated local SQLite database.
