# CLI

The CLI uses the same workspace service and local SQLite database as the desktop app.
Node.js 24 or newer is required when running from source. Build once with `npm run build`.
Use `npm run cli -- <command>` from the repository, or run `npm link` to make `contextdock`
available in your terminal. The Windows desktop installer includes command wrappers and does not require Node.js;
the source CLI and MCP server do.

```powershell
contextdock create "ModelMux" --description "Gateway development"
contextdock add-folder "ModelMux" "C:\Projects\ModelMux"
contextdock add-file "ModelMux" "C:\Documents\design.pdf" --name "Design document"
contextdock add-url "ModelMux" "https://redis.io" --name "Redis documentation"
contextdock add-app "ModelMux" "C:\Applications\Editor\editor.exe" --arg "C:\Projects\ModelMux"
contextdock list
contextdock show "ModelMux"
contextdock open "ModelMux"
```

Paths above are illustrative. Choose paths that exist on your computer. CLI file,
folder, and application paths can be relative to your current terminal directory.
Quote names, paths, and arguments that contain spaces. Pass each application argument
separately; to pass a flag, use `--arg=--new-window`. ContextDock does not interpret
shell syntax, split strings on spaces, or execute a shell command.

Other commands:

```powershell
contextdock rename "ModelMux" "Gateway" --description "Gateway development"
contextdock duplicate "Gateway"
contextdock add-url "Gateway" "http://localhost:3000" --disabled --order 0
contextdock remove-item "Gateway" "<item-id-from-show>"
contextdock delete "Gateway (copy)"
contextdock --help
```

Workspace selectors accept an ID or case-insensitive name. `show` includes item IDs,
enabled state, launch order, and application arguments. `delete` and `remove-item`
apply immediately. The desktop app offers confirmation before deletion.

Use `--json` with any command for machine-readable results on stdout. Errors are
written to stderr; with `--json`, they are JSON objects with an `error` field. A
successful command exits with `0`; invalid commands, service errors, and a resume
with one or more failed items exit with `1`. Partial resume reports remain available
on stdout and include both successes and failures. A successful launch means Windows
accepted the launch request; it does not confirm the program or website finished loading.

Data defaults to `%LOCALAPPDATA%\ContextDock\contextdock.sqlite` on Windows. Use
`--data-dir <directory>` or `CONTEXTDOCK_DATA_DIR` to select another local directory.
Set the same environment variable for the desktop and MCP processes to share an
alternate database. Each operation opens and closes its database connection cleanly.
