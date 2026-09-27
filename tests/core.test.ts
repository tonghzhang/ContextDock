import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContext, resolveDataDirectory, WorkspaceError } from '../src/core';
import { openDatabase, transaction } from '../src/core/database';
import type { ItemInput, Launcher, WorkspaceInput } from '../src/shared/types';

const testRoot = resolve('work', 'core-tests');
mkdirSync(testRoot, { recursive: true });
const directories: string[] = [];
const contexts: ReturnType<typeof createContext>[] = [];
function tempDirectory() {
  const directory = mkdtempSync(join(testRoot, 'case-'));
  directories.push(directory);
  return directory;
}
function setup(launcher: Launcher = { launch: vi.fn(async () => {}) }) {
  const dataDir = tempDirectory();
  const context = createContext({ dataDir, launcher });
  contexts.push(context);
  return { ...context, dataDir };
}
const url = (name: string, extras: Partial<ItemInput> = {}): ItemInput => ({
  type: 'url',
  name,
  target: `https://example.com/${name}`,
  ...extras,
});
afterEach(() => {
  contexts.splice(0).forEach((context) => context.close());
  directories.splice(0).forEach((directory) => {
    if (!resolve(directory).startsWith(`${testRoot}${sep}`))
      throw new Error('Unsafe test cleanup path.');
    rmSync(directory, { recursive: true, force: true });
  });
  vi.unstubAllEnvs();
});

describe('SQLite persistence and migration', () => {
  it('creates a versioned database and persists workspaces and item settings after reopening', () => {
    const first = setup();
    const workspace = first.service.createWorkspace({
      name: 'ModelMux',
      description: 'Gateway development',
    });
    first.service.addItem(workspace.id, {
      type: 'application',
      name: 'Editor',
      target: 'D:\\Apps\\editor.exe',
      arguments: ['D:\\Projects\\hello world'],
      enabled: false,
    });
    const original = first.service.getWorkspace(workspace.id);
    first.close();
    const second = createContext({ dataDir: first.dataDir });
    contexts.push(second);
    expect(second.service.getWorkspace(' modelmux ')).toEqual(original);
    const database = new DatabaseSync(join(first.dataDir, 'contextdock.sqlite'));
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    expect(database.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    database.close();
  });

  it('enforces foreign keys and cascades deletion', () => {
    const { service, dataDir } = setup();
    const workspace = service.createWorkspace({ name: 'Delete me' });
    service.addItem(workspace.id, url('docs'));
    service.deleteWorkspace(workspace.id);
    const database = openDatabase(dataDir);
    expect(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    expect(database.prepare('SELECT count(*) AS count FROM workspace_items').get()?.count).toBe(0);
    database.close();
    expect(() => service.getWorkspace(workspace.id)).toThrow('Workspace not found');
  });

  it('refuses a newer schema without downgrading or removing existing data', () => {
    const dataDir = tempDirectory();
    const database = openDatabase(dataDir);
    database.exec(
      "CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('keep'); PRAGMA user_version = 99;",
    );
    database.close();
    expect(() => createContext({ dataDir })).toThrow('newer ContextDock version');
    const inspection = new DatabaseSync(join(dataDir, 'contextdock.sqlite'));
    expect(inspection.prepare('PRAGMA user_version').get()?.user_version).toBe(99);
    expect(inspection.prepare('SELECT value FROM future_data').get()?.value).toBe('keep');
    inspection.close();
  });

  it('rolls back failed transactions and keeps the connection usable', () => {
    const database = openDatabase(tempDirectory());
    database.exec('CREATE TABLE checks (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    expect(() =>
      transaction(database, () => {
        database.prepare('INSERT INTO checks VALUES (?, ?)').run(1, 'partial');
        database.prepare('INSERT INTO checks VALUES (?, ?)').run(1, 'duplicate');
      }),
    ).toThrow();
    expect(database.prepare('SELECT count(*) AS count FROM checks').get()?.count).toBe(0);
    transaction(database, () =>
      database.prepare('INSERT INTO checks VALUES (?, ?)').run(2, 'complete'),
    );
    expect(database.prepare('SELECT value FROM checks').get()?.value).toBe('complete');
    database.close();
  });

  it('uses an explicit override or the common environment directory for every entry point', () => {
    const directory = tempDirectory();
    vi.stubEnv('CONTEXTDOCK_DATA_DIR', directory);
    expect(resolveDataDirectory()).toBe(directory);
    const explicit = tempDirectory();
    expect(resolveDataDirectory(explicit)).toBe(explicit);
    expect(() => resolveDataDirectory('relative')).toThrow('absolute path');
  });
});

describe('WorkspaceService management', () => {
  it('creates, updates, finds and lists workspaces with normalized case-insensitive unique names', () => {
    const { service } = setup();
    const workspace = service.createWorkspace({ name: '  ModelMux   Project  ' });
    expect(workspace.name).toBe('ModelMux Project');
    expect(workspace.lastUsedAt).toBeNull();
    expect(() => service.createWorkspace({ name: 'ＭＯＤＥＬＭＵＸ project' })).toThrow(
      'already exists',
    );
    const other = service.createWorkspace({ name: 'Other' });
    expect(() => service.updateWorkspace(other.id, { name: 'modelmux project' })).toThrow(
      'already exists',
    );
    expect(
      service.updateWorkspace(workspace.id, { name: 'MODELMUX PROJECT', description: 'Updated' })
        .description,
    ).toBe('Updated');
    expect(service.getWorkspace('modelmux project').id).toBe(workspace.id);
    expect(service.listWorkspaces()).toHaveLength(2);
  });

  it('keeps an existing description when only the workspace name changes', () => {
    const { service } = setup();
    const workspace = service.createWorkspace({
      name: 'Old name',
      description: 'Keep these notes',
    });
    expect(service.updateWorkspace(workspace.id, { name: 'New name' }).description).toBe(
      'Keep these notes',
    );
    expect(
      service.updateWorkspace(workspace.id, { name: 'New name', description: '' }).description,
    ).toBe('');
  });
  it('duplicates the description and all items with fresh identifiers and independent state', () => {
    const { service } = setup();
    const workspace = service.createWorkspace({
      name: 'Original',
      description: 'Useful workspace',
    });
    const first = service.addItem(workspace.id, url('one', { enabled: false }));
    service.addItem(workspace.id, url('two'));
    const copy = service.duplicateWorkspace(workspace.id);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.description).toBe('Useful workspace');
    expect(copy.lastUsedAt).toBeNull();
    expect(copy.items.map((item) => item.name)).toEqual(['one', 'two']);
    expect(copy.items[0].enabled).toBe(false);
    expect(copy.items[0].id).not.toBe(first.id);
    expect(copy.items.every((item) => item.workspaceId === copy.id)).toBe(true);
    expect(service.duplicateWorkspace(workspace.id).name).toBe('Original (copy 2)');
    service.removeItem(copy.id, copy.items[0].id);
    expect(service.getWorkspace(workspace.id).items).toHaveLength(2);
  });

  it('adds, edits, reorders and removes items while preserving a contiguous launch order', () => {
    const { service } = setup();
    const workspace = service.createWorkspace({ name: 'Ordering' });
    const first = service.addItem(workspace.id, url('first'));
    const second = service.addItem(workspace.id, url('second'));
    const third = service.addItem(workspace.id, url('third', { launchOrder: 1 }));
    expect(service.getWorkspace(workspace.id).items.map((item) => item.id)).toEqual([
      first.id,
      third.id,
      second.id,
    ]);
    service.updateItem(
      workspace.id,
      second.id,
      url('second-edited', { launchOrder: 0, enabled: false }),
    );
    expect(service.getWorkspace(workspace.id).items[0]).toMatchObject({
      name: 'second-edited',
      enabled: false,
      launchOrder: 0,
    });
    const reordered = service.reorderItems(workspace.id, [third.id, first.id, second.id]);
    expect(reordered.items.map((item) => item.launchOrder)).toEqual([0, 1, 2]);
    service.removeItem(workspace.id, first.id);
    expect(service.getWorkspace(workspace.id).items.map((item) => item.launchOrder)).toEqual([
      0, 1,
    ]);
  });

  it('rejects partial, duplicate and foreign item orders without changing saved state', () => {
    const { service } = setup();
    const workspace = service.createWorkspace({ name: 'Main' });
    const first = service.addItem(workspace.id, url('first'));
    const second = service.addItem(workspace.id, url('second'));
    for (const order of [[first.id], [first.id, first.id], [first.id, 'foreign']]) {
      expect(() => service.reorderItems(workspace.id, order)).toThrow('exactly once');
    }
    expect(service.getWorkspace(workspace.id).items.map((item) => item.id)).toEqual([
      first.id,
      second.id,
    ]);
    const other = service.createWorkspace({ name: 'Other' });
    expect(() => service.removeItem(other.id, first.id)).toThrow('not found');
    expect(() => service.updateItem(other.id, first.id, url('bad'))).toThrow('not found');
  });

  it('preserves optional settings when editing and clears arguments when changing application type', () => {
    const { service } = setup();
    const workspace = service.createWorkspace({ name: 'Editor' });
    const item = service.addItem(workspace.id, {
      type: 'application',
      name: 'Editor',
      target: 'D:\\Apps\\editor.exe',
      arguments: ['--new-window'],
      enabled: false,
    });
    const updated = service.updateItem(workspace.id, item.id, {
      type: 'application',
      name: 'New name',
      target: item.target,
    });
    expect(updated.arguments).toEqual(['--new-window']);
    expect(updated.enabled).toBe(false);
    expect(service.updateItem(workspace.id, item.id, url('site')).arguments).toEqual([]);
  });

  it.each([
    null,
    [],
    {},
    { name: '' },
    { name: 123 },
    { name: 'valid', description: false },
    { name: 'valid', description: null },
  ])('rejects malformed workspace payload %j', (input) => {
    const { service } = setup();
    expect(() => service.createWorkspace(input as WorkspaceInput)).toThrow(WorkspaceError);
  });

  it.each([
    null,
    {},
    { type: 'invalid' },
    url('bad', { target: 'javascript:alert(1)' }),
    url('bad', { target: 'file:///C:/Windows' }),
    url('bad', { target: 'https://user:password@example.com' }),
    url('bad', { enabled: 'yes' as unknown as boolean }),
    url('bad', { enabled: null as unknown as boolean }),
    url('bad', { launchOrder: -1 }),
    url('bad', { launchOrder: 1.5 }),
    url('bad', { launchOrder: null as unknown as number }),
    url('bad', { arguments: ['unexpected'] }),
    url('bad', { arguments: null as unknown as string[] }),
    { type: 'file', name: 'relative', target: 'relative.txt' },
    { type: 'application', name: 'script', target: 'D:\\Apps\\script.cmd' },
  ])('rejects malformed item payload %j', (input) => {
    const { service } = setup();
    const workspace = service.createWorkspace({ name: 'Validation' });
    expect(() => service.addItem(workspace.id, input as ItemInput)).toThrow(WorkspaceError);
    expect(service.getWorkspace(workspace.id).items).toEqual([]);
  });
});

describe('WorkspaceService resume', () => {
  it('launches enabled items sequentially, continues after failures and records last use', async () => {
    const opened: string[] = [];
    let inFlight = false;
    const { service } = setup({
      launch: async (item) => {
        expect(inFlight).toBe(false);
        inFlight = true;
        await Promise.resolve();
        opened.push(item.name);
        inFlight = false;
        if (item.name === 'broken') throw new Error('Missing application');
      },
    });
    const workspace = service.createWorkspace({ name: 'Resume' });
    service.addItem(workspace.id, url('first'));
    service.addItem(workspace.id, url('disabled', { enabled: false }));
    service.addItem(workspace.id, url('broken'));
    service.addItem(workspace.id, url('last'));
    const report = await service.resumeWorkspace(workspace.id);
    expect(opened).toEqual(['first', 'broken', 'last']);
    expect(report.results.map((result) => result.status)).toEqual(['success', 'failed', 'success']);
    expect(report.results[1].error).toBe('Missing application');
    expect(report.skipped).toBe(1);
    expect(service.getWorkspace(workspace.id).lastUsedAt).toBe(report.startedAt);
    expect(report.finishedAt >= report.startedAt).toBe(true);
  });

  it('prevents duplicate simultaneous resumes and releases the guard after finishing', async () => {
    let release: (() => void) | undefined;
    const { service } = setup({
      launch: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const workspace = service.createWorkspace({ name: 'Busy' });
    service.addItem(workspace.id, url('site'));
    const first = service.resumeWorkspace(workspace.id);
    await expect(service.resumeWorkspace(workspace.id)).rejects.toThrow('already opening');
    expect(() => service.deleteWorkspace(workspace.id)).toThrow('finish opening');
    release?.();
    await first;
    const second = service.resumeWorkspace(workspace.id);
    release?.();
    await expect(second).resolves.toMatchObject({ workspaceId: workspace.id });
  });

  it('handles an empty workspace without launching anything', async () => {
    const launch = vi.fn(async () => {});
    const { service } = setup({ launch });
    const workspace = service.createWorkspace({ name: 'Empty' });
    await expect(service.resumeWorkspace(workspace.id)).resolves.toMatchObject({
      results: [],
      skipped: 0,
    });
    expect(launch).not.toHaveBeenCalled();
  });
});
