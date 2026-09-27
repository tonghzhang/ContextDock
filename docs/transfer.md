# Workspace import and export

Transfer is manual: export one workspace, carry the package to another computer,
import it, locate missing resources, and Resume.

## Local file

1. Open a workspace and choose **Export**.
2. Leave all file checkboxes clear for configuration only, or select ordinary files
   to include. Applications and folders remain local references.
3. Choose **Save file…** to create a single `.contextdock` ZIP.
4. On the destination computer, choose **Import → Choose .contextdock file…**.
5. Review all items. Use **Locate…** for missing applications, files, or folders,
   or import them disabled and locate them later from the workspace detail.
6. Choose **Import**, then **Resume workspace** when ready.

Imported attachments are copied to `attachments/<import-id>/` beneath ContextDock's
data folder. They remain usable after deleting the original package or source file.
Removing or replacing bookmarks does not delete old managed files. They are retained
like other referenced files, so a bookmark operation cannot destroy a file in use.

Missing or inaccessible paths are marked unresolved and disabled. Resume skips them.
Locating an item in the preview preserves its original enabled setting; locating a
saved unresolved item enables it. Application arguments are preserved verbatim,
including any paths inside them: edit those arguments manually if another PC uses
different directories.

## Existing workspaces

Duplicate detection uses the workspace UUID, not its name:

- **Replace workspace** replaces the saved description and item list in one SQLite transaction.
- **Import as copy** creates a fresh workspace UUID and item UUIDs.
- **Cancel** discards the preview and leaves the database unchanged.

When a different workspace already uses the imported name, a numeric `(import N)`
suffix is added. Imports never merge local and remote edits.

## GitHub private repository

Create or choose a private repository. In **Settings → GitHub connection**, enter:

- **Owner**: the account or organization that owns it.
- **Repository**: the repository name, without a URL.
- **Branch**: defaults to `main`.
- **Set token…**: opens a native Windows password dialog.

Create a [fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
for that repository with **Contents: Read and write**. Organization approval may be
required by the repository owner. Use **Test connection** to verify access.
An empty repository can receive its first file; that upload creates the configured branch.

The token is entered outside the Electron renderer, encrypted with Electron
`safeStorage` on Windows, and used only by the main process. Connection status
returned to the renderer contains only owner, repository, branch, and a boolean
indicating whether a token exists. Credentials are not part of a workspace package.
Set the token independently on each computer; encrypted credentials are not portable.

- In **Export**, choose **Export to GitHub**.
- In **Import**, choose **Import from GitHub**, then select a workspace.
- Review the same preview and use the same import actions as for a local package.

The repository stores one file per workspace:

```text
contextdock/workspaces/<workspace-id>.contextdock
```

Exporting that UUID again overwrites its remote package with a normal single-file
GitHub Contents API update. GitHub listing reads package manifests to display
workspace names, so large collections or attachments take longer to list.
No Git installation is required by the app. GitHub is optional; offline local
import/export and existing workspaces continue to work without it.

## Package format, version 1

```text
ModelMux.contextdock
├── manifest.json
└── files/
    └── 1-gateway.pdf
```

```json
{
  "format": "contextdock-workspace",
  "version": 1,
  "workspace": {
    "id": "bf803f73-32c0-49d9-8e1d-08e2079a00b0",
    "name": "ModelMux",
    "description": "Gateway development",
    "items": [
      {
        "id": "item-pdf",
        "type": "file",
        "name": "Gateway PDF",
        "arguments": [],
        "enabled": true,
        "launchOrder": 0,
        "location": {
          "kind": "attachment",
          "path": "files/1-gateway.pdf"
        }
      }
    ]
  }
}
```

The exchange format version is independent of the app version. Other locations are
`{ "kind": "url", "url": "https://example.com/" }` and
`{ "kind": "local", "path": "C:\\Documents\\report.pdf" }`.
Only File items may use attachment locations.

The current limits are 25 MiB per archive, 50 MiB expanded, 1,000 items, and a 2 MiB
manifest. Archives must contain `manifest.json` and flat `files/` entries with safe
filenames. Unsupported versions, invalid URLs/types/arguments, missing attachments,
duplicate item identifiers or launch orders, and unsafe archive paths are rejected
before workspace records are written. Unavailable local paths are allowed and disabled.

## Implementation and verification

`src/transfer/` contains the shared manifest parser, archive handling, transfer
service, local provider, and GitHub provider. The Electron main process connects
native dialogs and encrypted credentials to that service through a narrow IPC API.
React renders choices and previews; it does not implement import or GitHub logic.

The desktop provides the transfer controls. Imported records immediately work in
the existing CLI and MCP interfaces because all three use the same Workspace Service
and SQLite database.

```powershell
npm run verify
npm run test:e2e:transfer
npm run test:e2e:token
```

Unit tests use isolated databases and a mocked GitHub HTTP transport, including
permission/network failures. The Windows desktop test exercises native-picker
integration with deterministic choices, real ZIP export/import, relocation,
an actual executable launch, safeStorage, and all three interface languages.
The native-token smoke test opens an isolated password dialog, enters a fake token,
and verifies window visibility, password masking, and the main-process return value.
It requires an interactive Windows desktop and does not access GitHub.

There is no background synchronization, folder upload, path inference, merge,
version history, or automatic application migration.
