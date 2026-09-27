import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createContext } from '../src/core/index';
import { createMcpServer } from '../src/mcp/index';

let directory: string;
let context: ReturnType<typeof createContext>;
let server: ReturnType<typeof createMcpServer>;
let client: Client;
const launched: string[] = [];

beforeEach(async () => {
  const work = join(process.cwd(), 'work');
  mkdirSync(work, { recursive: true });
  directory = mkdtempSync(join(work, 'mcp-test-'));
  launched.length = 0;
  context = createContext({
    dataDir: directory,
    launcher: {
      async launch(item) {
        launched.push(item.name);
        if (item.name === 'Unavailable') throw new Error('File no longer exists.');
      },
    },
  });
  server = createMcpServer(context.service);
  client = new Client({ name: 'contextdock-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
  context.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('MCP protocol with the real shared service', () => {
  it('advertises all six tools and their argument schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'list_workspaces',
        'get_workspace',
        'open_workspace',
        'create_workspace',
        'add_workspace_item',
        'remove_workspace_item',
      ]),
    );
    expect(tools).toHaveLength(6);
    const add = tools.find((tool) => tool.name === 'add_workspace_item');
    expect(add?.inputSchema.required).toEqual(['workspace', 'type', 'name', 'target']);
    expect(add?.inputSchema.properties).toMatchObject({
      enabled: { type: 'boolean' },
      arguments: { type: 'array', items: { type: 'string' } },
      launchOrder: { type: 'integer', minimum: 0 },
    });
    expect(tools.find((tool) => tool.name === 'list_workspaces')?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(tools.find((tool) => tool.name === 'open_workspace')?.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: true,
    });
  });

  it('creates, lists, gets, adds, and removes through actual protocol requests', async () => {
    const created = await client.callTool({
      name: 'create_workspace',
      arguments: { name: 'ModelMux', description: 'Gateway development' },
    });
    expect(created.isError).toBe(false);
    expect(created.structuredContent).toMatchObject({ workspace: { name: 'ModelMux' } });
    const workspace = context.service.getWorkspace('ModelMux');
    const added = await client.callTool({
      name: 'add_workspace_item',
      arguments: {
        workspace: workspace.id,
        type: 'url',
        name: 'Redis',
        target: 'https://redis.io',
        enabled: true,
      },
    });
    expect(added.isError).toBe(false);
    expect(added.structuredContent).toMatchObject({
      item: { name: 'Redis', type: 'url', target: 'https://redis.io/' },
    });
    const item = context.service.getWorkspace(workspace.id).items[0];
    const listed = await client.callTool({ name: 'list_workspaces', arguments: {} });
    expect(listed.structuredContent).toMatchObject({
      workspaces: [{ id: workspace.id, items: [{ id: item.id }] }],
    });
    const fetched = await client.callTool({
      name: 'get_workspace',
      arguments: { workspace: 'MODELMUX' },
    });
    expect(fetched.structuredContent).toMatchObject({ workspace: { id: workspace.id } });
    const text = Array.isArray(fetched.content)
      ? fetched.content.find((block) => block.type === 'text')
      : undefined;
    expect(text).toBeDefined();
    if (text?.type === 'text') expect(JSON.parse(text.text)).toEqual(fetched.structuredContent);
    const removed = await client.callTool({
      name: 'remove_workspace_item',
      arguments: { workspace: 'ModelMux', itemId: item.id },
    });
    expect(removed.structuredContent).toEqual({ removed: item.id });
    expect(context.service.getWorkspace(workspace.id).items).toEqual([]);
  });

  it('reports service validation errors as MCP tool errors', async () => {
    context.service.createWorkspace({ name: 'Work' });
    for (const request of [
      { name: 'create_workspace', arguments: { name: 'work' } },
      { name: 'get_workspace', arguments: { workspace: 'Missing' } },
      {
        name: 'add_workspace_item',
        arguments: {
          workspace: 'Work',
          type: 'url',
          name: 'Unsafe URL',
          target: 'javascript:alert(1)',
        },
      },
      {
        name: 'add_workspace_item',
        arguments: { workspace: 'Work', type: 'file', name: 'Relative', target: './document.pdf' },
      },
    ]) {
      const response = await client.callTool(request);
      expect(response.isError).toBe(true);
      expect(response.structuredContent).toMatchObject({ error: expect.any(String) });
    }
    expect(context.service.getWorkspace('Work').items).toEqual([]);
  });

  it('rejects invalid protocol arguments before invoking the service', async () => {
    const workspace = context.service.createWorkspace({ name: 'Work' });
    const response = await client.callTool({
      name: 'add_workspace_item',
      arguments: {
        workspace: workspace.id,
        type: 'url',
        name: 'Example',
        target: 'https://example.com',
        enabled: 'yes',
      },
    });
    expect(response.isError).toBe(true);
    expect(context.service.getWorkspace(workspace.id).items).toEqual([]);
  });

  it('returns a full report when a launch fails and continues in order', async () => {
    const workspace = context.service.createWorkspace({ name: 'Work' });
    for (const name of ['First', 'Unavailable', 'Last', 'Disabled']) {
      context.service.addItem(workspace.id, {
        type: 'url',
        name,
        target: 'https://example.com',
        enabled: name !== 'Disabled',
      });
    }
    const response = await client.callTool({
      name: 'open_workspace',
      arguments: { workspace: workspace.id },
    });
    expect(response.isError).toBe(true);
    expect(launched).toEqual(['First', 'Unavailable', 'Last']);
    expect(response.structuredContent).toMatchObject({
      report: {
        skipped: 1,
        results: [
          { status: 'success' },
          { status: 'failed', error: 'File no longer exists.' },
          { status: 'success' },
        ],
      },
    });
    expect(context.service.getWorkspace(workspace.id).lastUsedAt).not.toBeNull();
  });

  it('preserves application arguments and prevents deleting an item from a different workspace', async () => {
    const first = context.service.createWorkspace({ name: 'First' });
    const second = context.service.createWorkspace({ name: 'Second' });
    const added = await client.callTool({
      name: 'add_workspace_item',
      arguments: {
        workspace: first.id,
        type: 'application',
        name: 'Editor',
        target: join(directory, 'Editor.exe'),
        arguments: ['--new-window', 'path with spaces', '$(literal)'],
      },
    });
    expect(added.isError).toBe(false);
    expect(added.structuredContent).toMatchObject({
      item: { arguments: ['--new-window', 'path with spaces', '$(literal)'] },
    });
    const item = context.service.getWorkspace(first.id).items[0];
    const response = await client.callTool({
      name: 'remove_workspace_item',
      arguments: { workspace: second.id, itemId: item.id },
    });
    expect(response.isError).toBe(true);
    expect(context.service.getWorkspace(first.id).items).toHaveLength(1);
  });
});
