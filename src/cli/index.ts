import { basename, resolve, win32 } from 'node:path';
import { parseArgs } from 'node:util';
import { createContext } from '../core/index';
import type { ItemType, LaunchReport, Workspace } from '../shared/types';

export const CLI_HELP = `ContextDock — Save your workspace. Resume it in one click.

Usage: contextdock <command> [arguments] [options]

Commands:
  list                              List workspaces
  show <workspace>                  Show a workspace and its items
  open <workspace>                  Resume all enabled items in order
  create <name>                     Create a workspace
  rename <workspace> <new-name>     Rename a workspace
  delete <workspace>                Delete a workspace
  duplicate <workspace>             Copy a workspace and its items
  add-url <workspace> <url>         Add an HTTP or HTTPS URL
  add-file <workspace> <path>       Add a file
  add-folder <workspace> <path>     Add a folder
  add-app <workspace> <exe>         Add an application
  remove-item <workspace> <item-id> Remove an item

Options:
  --json                           Print JSON to stdout
  --data-dir <directory>           Override the shared local data directory
  --description <text>             Description for create or rename
  --name <text>                    Display name for an added item
  --arg <value>                    Application argument; repeat for each argument
  --disabled                      Add an item disabled
  --order <number>                 Insert an item at this zero-based position
  -h, --help                       Show this help

Workspace arguments accept an ID or a case-insensitive name. Quote names and
paths containing spaces. Use --arg=value when an application argument starts
with a hyphen. Desktop, CLI, and MCP share the same local SQLite database.`;

export interface CliDependencies {
  createContext?: typeof createContext;
  out?: (message: string) => void;
  err?: (message: string) => void;
}

function expectCount(command: string, args: string[], count: number): void {
  if (args.length !== count) {
    throw new Error(
      `Command "${command}" expects ${count} argument${count === 1 ? '' : 's'}. Run contextdock --help.`,
    );
  }
}

function workspaceText(workspace: Workspace): string {
  const lines = [workspace.name, `ID: ${workspace.id}`];
  if (workspace.description) lines.push(workspace.description);
  lines.push(`Last used: ${workspace.lastUsedAt ?? 'Never'}`);
  for (const item of workspace.items) {
    lines.push(
      `${item.launchOrder + 1}. [${item.enabled ? 'on' : 'off'}] ${item.name} (${item.type})`,
      `   ${item.target}`,
      `   ID: ${item.id}`,
    );
    if (item.arguments.length) lines.push(`   Arguments: ${JSON.stringify(item.arguments)}`);
  }
  if (!workspace.items.length) lines.push('No items yet.');
  return lines.join('\n');
}

function reportText(report: LaunchReport): string {
  const succeeded = report.results.filter((result) => result.status === 'success').length;
  const failed = report.results.length - succeeded;
  const lines = [
    `${report.workspaceName}: ${succeeded} opened, ${failed} failed, ${report.skipped} disabled.`,
  ];
  for (const result of report.results) {
    lines.push(
      `${result.status === 'success' ? 'OK' : 'FAILED'}  ${result.name}${result.error ? ` — ${result.error}` : ''}`,
    );
  }
  if (!report.results.length) lines.push('No enabled items to open.');
  return lines.join('\n');
}

function defaultItemName(type: ItemType, target: string): string {
  if (type === 'url') {
    try {
      return new URL(target).hostname;
    } catch {
      return target;
    }
  }
  return win32.basename(target) || basename(target) || target;
}

/** Execute one command against the same service used by the desktop and MCP. */
export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const out =
    dependencies.out ??
    ((message: string) => {
      process.stdout.write(`${message}\n`);
    });
  const err =
    dependencies.err ??
    ((message: string) => {
      process.stderr.write(`${message}\n`);
    });
  let context: ReturnType<typeof createContext> | undefined;
  let json = argv.includes('--json');
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean', default: false },
        'data-dir': { type: 'string' },
        description: { type: 'string' },
        name: { type: 'string' },
        arg: { type: 'string', multiple: true },
        disabled: { type: 'boolean' },
        order: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    json = values.json ?? false;
    if (values.help || positionals.length === 0 || positionals[0] === 'help') {
      out(CLI_HELP);
      return 0;
    }
    const [command, ...args] = positionals;
    const counts: Record<string, number> = {
      list: 0,
      show: 1,
      open: 1,
      create: 1,
      rename: 2,
      delete: 1,
      duplicate: 1,
      'add-url': 2,
      'add-file': 2,
      'add-folder': 2,
      'add-app': 2,
      'remove-item': 2,
    };
    if (!(command in counts))
      throw new Error(`Unknown command "${command}". Run contextdock --help.`);
    expectCount(command, args, counts[command]);
    const itemCommand = command.startsWith('add-');
    if (
      !itemCommand &&
      (values.name !== undefined || values.disabled !== undefined || values.order !== undefined)
    )
      throw new Error('--name, --disabled, and --order are available only for add commands.');
    if (values.arg !== undefined && command !== 'add-app')
      throw new Error('--arg is available only for add-app.');
    if (values.description !== undefined && command !== 'create' && command !== 'rename')
      throw new Error('--description is available only for create or rename.');
    const order = values.order === undefined ? undefined : Number(values.order);
    if (values.order !== undefined && (!/^\d+$/.test(values.order) || !Number.isSafeInteger(order)))
      throw new Error('--order must be a non-negative integer.');
    context = (dependencies.createContext ?? createContext)({ dataDir: values['data-dir'] });
    const { service } = context;
    let result: unknown;
    let human = '';
    let code = 0;
    switch (command) {
      case 'list': {
        const workspaces = service.listWorkspaces();
        result = workspaces;
        human = workspaces.length
          ? workspaces
              .map(
                (workspace) =>
                  `${workspace.name}\t${workspace.items.length} item(s)\tUsed: ${workspace.lastUsedAt ?? 'Never'}`,
              )
              .join('\n')
          : 'No workspaces yet. Create one with contextdock create "My workspace".';
        break;
      }
      case 'show': {
        const workspace = service.getWorkspace(args[0]);
        result = workspace;
        human = workspaceText(workspace);
        break;
      }
      case 'open': {
        const report = await service.resumeWorkspace(args[0]);
        result = report;
        human = reportText(report);
        code = report.results.some((entry) => entry.status === 'failed') ? 1 : 0;
        break;
      }
      case 'create': {
        const workspace = service.createWorkspace({
          name: args[0],
          description: values.description,
        });
        result = workspace;
        human = `Created "${workspace.name}" (${workspace.id}).`;
        break;
      }
      case 'rename': {
        const current = service.getWorkspace(args[0]);
        const workspace = service.updateWorkspace(current.id, {
          name: args[1],
          description: values.description ?? current.description,
        });
        result = workspace;
        human = `Renamed workspace to "${workspace.name}".`;
        break;
      }
      case 'delete': {
        const workspace = service.getWorkspace(args[0]);
        service.deleteWorkspace(workspace.id);
        result = { deleted: workspace.id, name: workspace.name };
        human = `Deleted "${workspace.name}".`;
        break;
      }
      case 'duplicate': {
        const workspace = service.duplicateWorkspace(args[0]);
        result = workspace;
        human = `Created copy "${workspace.name}" (${workspace.id}).`;
        break;
      }
      case 'remove-item':
        service.removeItem(args[0], args[1]);
        result = { removed: args[1] };
        human = 'Removed item.';
        break;
      default: {
        const itemTypes: Record<string, ItemType> = {
          'add-url': 'url',
          'add-file': 'file',
          'add-folder': 'folder',
          'add-app': 'application',
        };
        const type = itemTypes[command];
        const target = type === 'url' ? args[1] : resolve(args[1]);
        const item = service.addItem(args[0], {
          type,
          name: values.name ?? defaultItemName(type, target),
          target,
          arguments: values.arg,
          enabled: !values.disabled,
          launchOrder: order,
        });
        result = item;
        human = `Added "${item.name}" (${item.id}).`;
      }
    }
    out(json ? JSON.stringify(result, null, 2) : human);
    return code;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
    err(json ? JSON.stringify({ error: message }) : `Error: ${message}`);
    return 1;
  } finally {
    context?.close();
  }
}
