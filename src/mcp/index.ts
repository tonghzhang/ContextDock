import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { WorkspaceService } from '../core/index';

function result(value: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError,
  };
}

async function attempt(
  operation: () => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    return result(await operation());
  } catch (error) {
    return result(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred.' },
      true,
    );
  }
}

const workspaceSelector = z.string().describe('A workspace ID or its case-insensitive name.');
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const localMutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Transport-independent MCP adapter. All persistence and launch rules live in the service. */
export function createMcpServer(service: WorkspaceService): McpServer {
  const server = new McpServer({ name: 'contextdock', version: '0.1.0' });

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description: 'List local ContextDock workspaces, including their items and last-used times.',
      inputSchema: z.object({}).strict(),
      annotations: readOnly,
    },
    () => attempt(() => ({ workspaces: service.listWorkspaces() })),
  );

  server.registerTool(
    'get_workspace',
    {
      title: 'Get workspace',
      description: 'Read a local workspace and its ordered items by ID or name.',
      inputSchema: z.object({ workspace: workspaceSelector }).strict(),
      annotations: readOnly,
    },
    ({ workspace }) => attempt(() => ({ workspace: service.getWorkspace(workspace) })),
  );

  server.registerTool(
    'open_workspace',
    {
      title: 'Resume workspace',
      description:
        "Launch every enabled item in order on this Windows computer, opening local applications, files, folders, and websites. Obtain the user's permission to resume the selected workspace before calling. Returns every item's launch result; one failure does not stop later items.",
      inputSchema: z.object({ workspace: workspaceSelector }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspace }) => {
      try {
        const report = await service.resumeWorkspace(workspace);
        return result(
          { report },
          report.results.some((item) => item.status === 'failed'),
        );
      } catch (error) {
        return result(
          { error: error instanceof Error ? error.message : 'The workspace could not be opened.' },
          true,
        );
      }
    },
  );

  server.registerTool(
    'create_workspace',
    {
      title: 'Create workspace',
      description:
        'Create a local workspace. Names must be unique, ignoring case and surrounding whitespace.',
      inputSchema: z.object({ name: z.string(), description: z.string().optional() }).strict(),
      annotations: localMutation,
    },
    ({ name, description }) =>
      attempt(() => ({ workspace: service.createWorkspace({ name, description }) })),
  );

  server.registerTool(
    'add_workspace_item',
    {
      title: 'Add workspace item',
      description:
        'Save an application, file, folder, or HTTP/HTTPS URL in a local workspace. Application targets must be .exe paths. File, folder, and application targets must be absolute paths. Saving does not launch the item. Arguments are separate strings, supported only for applications; shell commands are not accepted.',
      inputSchema: z
        .object({
          workspace: workspaceSelector,
          type: z.enum(['application', 'file', 'folder', 'url']),
          name: z.string(),
          target: z.string(),
          arguments: z
            .array(z.string())
            .optional()
            .describe(
              'Application arguments; each array element is passed as one argument without shell interpretation.',
            ),
          enabled: z
            .boolean()
            .optional()
            .describe('Whether Resume opens this item; defaults to true.'),
          launchOrder: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe('Zero-based insertion position; omitted items are appended.'),
        })
        .strict(),
      annotations: localMutation,
    },
    ({ workspace, ...item }) => attempt(() => ({ item: service.addItem(workspace, item) })),
  );

  server.registerTool(
    'remove_workspace_item',
    {
      title: 'Remove workspace item',
      description:
        'Remove an item from a local workspace by item ID. This deletes only the saved bookmark; the target file, folder, or application is untouched.',
      inputSchema: z.object({ workspace: workspaceSelector, itemId: z.string() }).strict(),
      annotations: { ...localMutation, destructiveHint: true },
    },
    ({ workspace, itemId }) =>
      attempt(() => {
        service.removeItem(workspace, itemId);
        return { removed: itemId };
      }),
  );

  return server;
}
