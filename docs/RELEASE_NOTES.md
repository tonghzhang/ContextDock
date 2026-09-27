# ContextDock v0.1.0

The first release of ContextDock: save the applications, files, folders, and
websites needed for a project, then resume that workspace in one click.

## Included

- Workspace creation, renaming, descriptions, duplication, deletion, search, and last-used times.
- Native Windows file, folder, and application pickers; editable item arguments, enabled state, and launch order.
- Ordered Resume with independent item error handling and a complete launch report.
- Local SQLite persistence with schema migrations and one shared service for desktop, CLI, and MCP.
- Global shortcut, in-app Ctrl+K search with Enter to Resume, and tray access.
- CLI commands for workspace management and launch, with JSON output and meaningful exit codes.
- Six local MCP tools for workspace listing, reading, creation, launching, item addition, and removal.
- Windows x64 installer and portable desktop builds; the installer includes CLI/MCP wrappers and their runtime.
- Unit and integration tests, strict TypeScript checks, ESLint, Prettier, and Windows CI configuration.

## Download

- `ContextDock-Setup-0.1.0-x64.exe` — installer for Windows 10/11 x64.
- `ContextDock-Portable-0.1.0-x64.exe` — desktop app without installation.

The builds are unsigned. Windows may show an unknown-publisher or SmartScreen
warning. Download only from this repository's release page. The portable app uses
the same per-user local database as the installed app.

## Scope

Resume opens saved resources using Windows defaults and reports whether launch
requests were accepted. It does not restore window layouts, browser sessions,
document pages, or editor positions. No cloud backend, account, AI analysis, or
activity monitoring is included.

See the [README](https://github.com/tonghzhang/ContextDock#readme) for installation, development, CLI, and MCP setup.
