# ContextDock interface direction

The interface is a small Windows workspace launcher for people returning to a project. Its single job is to make search → Resume fast, with a clear editor one step away.

## Tokens

- Ink `#101319`: application frame and navigation
- Slate `#171c25`: workspace library
- Canvas `#1d2430`: selected surfaces and dialogs
- Chalk `#eef2f8`: primary text
- Mist `#9ca8bb`: supporting text
- Dock blue `#83acff`: active workspace, focus, and Resume

Display and body use Windows-native Segoe UI Variable / Segoe UI. Restrained monospace captions use Cascadia Code / Consolas for paths, keyboard keys, and launch order. Titles have slightly tighter tracking; body copy stays open and practical.

## Layout

A narrow navigation rail anchors the app. A searchable workspace library keeps every Resume within reach. The larger detail panel edits the selected workspace without leaving the library.

```text
Navigation | Search workspaces       | Workspace name      Resume
           | Project A          Play | Description
Workspaces | Project B          Play | 01 Application  [enabled]
           | Project C          Play | 02 URL          [enabled]
           |                         | 03 Folder       [enabled]
Settings   | Search keyboard hints   | + Add item
```

The signature is the ordered launch queue: real launch numbers, compact resource glyphs, and an unobtrusive continuous rule make the order readable. This is a working list, so numbers carry actual meaning. No dashboard counters, gradients, stock illustrations, fake workspaces, remote fonts, or decorative charts.

At narrower sizes the navigation rail becomes icon-only and the library contracts. Focus rings are visible, buttons retain readable labels, dialogs use native modal focus behavior, and motion respects reduced-motion preferences. Errors explain the failed action and remain dismissible. The empty state gives one direct next step.

## Review

An early card-grid idea was discarded: it would hide the resource order and require navigation between editing and launching. The split view is better suited to repeatedly returning to one workspace. The blue accent is reserved for selection and action; status colors appear only in launch results or errors.
