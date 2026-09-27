import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../src/core/index';
import { runCli } from '../src/cli/index';
import type { Workspace, WorkspaceItem } from '../src/shared/types';

let directory: string;
const launched: string[] = [];

beforeEach(() => {
  const work = join(process.cwd(), 'work');
  mkdirSync(work, { recursive: true });
  directory = mkdtempSync(join(work, 'cli-test-'));
  launched.length = 0;
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

async function command(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    createContext: (options) =>
      createContext({
        ...options,
        dataDir: directory,
        launcher: {
          async launch(item) {
            launched.push(item.name);
            if (item.name === 'Fails') throw new Error('Application could not be opened.');
          },
        },
      }),
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

async function createWorkspace() {
  const result = await command(['create', 'My work', '--description', 'Focus', '--json']);
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Workspace;
}

describe('CLI with the real shared workspace service', () => {
  it('shows help without opening a database', async () => {
    let created = false;
    const messages: string[] = [];
    expect(
      await runCli(['--help'], {
        createContext: () => {
          created = true;
          throw new Error('Do not open a database for help');
        },
        out: (text) => messages.push(text),
      }),
    ).toBe(0);
    expect(created).toBe(false);
    expect(messages[0]).toContain('add-app');
  });

  it('persists creation, case-insensitive lookup, rename, copy, and deletion', async () => {
    const workspace = await createWorkspace();
    const show = await command(['show', 'MY WORK', '--json']);
    expect(JSON.parse(show.stdout)).toMatchObject({
      id: workspace.id,
      name: 'My work',
      description: 'Focus',
    });
    expect((await command(['rename', workspace.id, 'Renamed'])).code).toBe(0);
    const copy = JSON.parse(
      (await command(['duplicate', 'Renamed', '--json'])).stdout,
    ) as Workspace;
    expect(copy.id).not.toBe(workspace.id);
    expect(JSON.parse((await command(['list', '--json'])).stdout)).toHaveLength(2);
    expect((await command(['delete', copy.id])).code).toBe(0);
    expect(JSON.parse((await command(['list', '--json'])).stdout)).toHaveLength(1);
    expect((await command(['show', 'Renamed'])).stdout).toContain('Focus');
  });

  it('adds, shows, and removes items through the shared service', async () => {
    await createWorkspace();
    const result = await command([
      'add-url',
      'My work',
      'https://redis.io',
      '--name',
      'Redis',
      '--json',
    ]);
    expect(result.code).toBe(0);
    const item = JSON.parse(result.stdout) as WorkspaceItem;
    expect(item).toMatchObject({ type: 'url', name: 'Redis', target: 'https://redis.io/' });
    expect((await command(['show', 'My work'])).stdout).toContain(item.id);
    expect((await command(['remove-item', 'My work', item.id])).code).toBe(0);
    const workspace = JSON.parse(
      (await command(['show', 'My work', '--json'])).stdout,
    ) as Workspace;
    expect(workspace.items).toEqual([]);
  });

  it('preserves repeated application arguments without shell parsing', async () => {
    await createWorkspace();
    const target = join(directory, 'Editor App.exe');
    const result = await command([
      'add-app',
      'My work',
      target,
      '--arg=--new-window',
      '--arg',
      'a path with spaces',
      '--arg',
      '$(not-a-shell)',
      '--json',
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      type: 'application',
      target,
      arguments: ['--new-window', 'a path with spaces', '$(not-a-shell)'],
    });
  });

  it('returns a complete partial-failure launch report and failure exit code', async () => {
    await createWorkspace();
    await command(['add-url', 'My work', 'https://example.com', '--name', 'First']);
    await command(['add-url', 'My work', 'https://example.com/failed', '--name', 'Fails']);
    await command(['add-url', 'My work', 'https://example.com/last', '--name', 'Last']);
    await command([
      'add-url',
      'My work',
      'https://example.com/disabled',
      '--name',
      'Disabled',
      '--disabled',
    ]);
    const result = await command(['open', 'My work', '--json']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(launched).toEqual(['First', 'Fails', 'Last']);
    expect(JSON.parse(result.stdout)).toMatchObject({
      skipped: 1,
      results: [
        { status: 'success' },
        { status: 'failed', error: 'Application could not be opened.' },
        { status: 'success' },
      ],
    });
    const workspace = JSON.parse(
      (await command(['show', 'My work', '--json'])).stdout,
    ) as Workspace;
    expect(workspace.lastUsedAt).not.toBeNull();
  });

  it('rejects duplicate names and invalid URLs with clean JSON errors', async () => {
    await createWorkspace();
    for (const args of [
      ['create', 'my WORK'],
      ['add-url', 'My work', 'javascript:alert(1)'],
      ['show', 'Missing'],
    ]) {
      const result = await command([...args, '--json']);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr).error).toEqual(expect.any(String));
    }
  });

  it.each([
    ['unknown'],
    ['show'],
    ['list', 'extra'],
    ['create', 'Work', '--arg=x'],
    ['list', '--order', '0'],
    ['add-url', 'Work', 'https://example.com', '--order', '1.5'],
    ['list', '--surprise'],
  ])('rejects malformed command %j', async (...args) => {
    const result = await command(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Error:');
  });

  it('passes the explicit data directory to the shared context factory', async () => {
    let selected: string | undefined;
    const code = await runCli(['list', '--data-dir', directory, '--json'], {
      createContext: (options) => {
        selected = options?.dataDir;
        return createContext(options);
      },
      out: () => {},
    });
    expect(code).toBe(0);
    expect(selected).toBe(directory);
  });
});
