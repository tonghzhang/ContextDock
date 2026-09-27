import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContext } from '../src/core';
import { WorkspaceTransferService } from '../src/transfer/service';
import { readArchive, buildArchive } from '../src/transfer/archive';
import { parseManifest } from '../src/transfer/manifest';
import { readLocalArchive, writeLocalArchive } from '../src/transfer/local-provider';
import { GitHubProvider } from '../src/transfer/github-provider';
import { Credentials } from '../src/desktop/credentials';
import type { Launcher } from '../src/shared/types';

const root = resolve('work', 'transfer-tests');
const directories: string[] = [];
const contexts: ReturnType<typeof createContext>[] = [];
async function setup(launcher: Launcher = { launch: vi.fn(async () => {}) }) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  directories.push(directory);
  const context = createContext({ dataDir: directory, launcher });
  contexts.push(context);
  const transfer = new WorkspaceTransferService(context.service, directory);
  return { ...context, transfer, directory };
}
afterEach(async () => {
  contexts.splice(0).forEach((context) => context.close());
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(root + sep)) throw new Error('Unsafe cleanup path.');
    await rm(directory, { force: true, recursive: true });
  }
});
async function sample() {
  const env = await setup();
  const pdf = join(env.directory, '資料.pdf');
  await writeFile(pdf, 'portable document');
  const exe = join(env.directory, 'editor.exe');
  await writeFile(exe, 'test executable fixture');
  const workspace = env.service.createWorkspace({
    name: 'ModelMux',
    description: 'Development resources',
  });
  env.service.addItem(workspace.id, {
    type: 'application',
    name: 'Editor',
    target: exe,
    arguments: ['--new-window', 'D:\\other computer\\project'],
    enabled: false,
  });
  const attachment = env.service.addItem(workspace.id, {
    type: 'file',
    name: 'Document',
    target: pdf,
  });
  env.service.addItem(workspace.id, { type: 'folder', name: 'Project', target: env.directory });
  env.service.addItem(workspace.id, {
    type: 'url',
    name: 'Docs',
    target: 'https://example.com/docs',
  });
  return { ...env, workspace: env.service.getWorkspace(workspace.id), attachment };
}

describe('single-file workspace transfer', () => {
  it('rejects a corrupt attachment using the ZIP checksum without adding attachment hashes', async () => {
    const source = await sample();
    const bytes = Buffer.from(
      await source.transfer.export(source.workspace.id, [source.attachment.id]),
    );
    const offset = bytes.indexOf(Buffer.from('portable document'));
    expect(offset).toBeGreaterThan(0);
    bytes[offset] ^= 1;
    expect(() => readArchive(bytes)).toThrow('Invalid or oversized');
  });

  it('round-trips configuration, arguments, enabled state and launch order through a real ZIP file', async () => {
    const source = await sample();
    const filename = join(source.directory, 'ModelMux.contextdock');
    await writeLocalArchive(filename, await source.transfer.export(source.workspace.id, []));
    const bytes = await readLocalArchive(filename);
    expect(Buffer.from(bytes).subarray(0, 2).toString()).toBe('PK');
    const target = await setup();
    const preview = await target.transfer.prepare(bytes);
    expect(preview.duplicate).toBe(false);
    const imported = (await target.transfer.commit(preview.sessionId, 'replace'))!;
    expect(imported.id).toBe(source.workspace.id);
    expect(imported.name).toBe(source.workspace.name);
    expect(imported.description).toBe(source.workspace.description);
    const values = (workspace: typeof imported) =>
      workspace.items.map(({ type, name, target, arguments: args, enabled, launchOrder }) => ({
        type,
        name,
        target,
        args,
        enabled,
        launchOrder,
      }));
    expect(values(imported)).toEqual(values(source.workspace));
    expect(imported.items.every((item) => !item.unresolved)).toBe(true);
    const manifest = readArchive(bytes).manifest;
    expect(manifest).toMatchObject({ format: 'contextdock-workspace', version: 1 });
    expect(manifest.workspace.items[1].location.kind).toBe('local');
  });
  it('includes selected files, stages them, copies them to managed storage, and resumes their actual contents', async () => {
    const source = await sample();
    const data = await source.transfer.export(source.workspace.id, [source.attachment.id]);
    await rm(source.attachment.target);
    const launch = vi.fn(async (item: { type: string; target: string }) => {
      if (item.type === 'file')
        expect(await readFile(item.target, 'utf8')).toBe('portable document');
    });
    const target = await setup({ launch });
    const preview = await target.transfer.prepare(data);
    const staged = preview.items.find((item) => item.included)!;
    expect(await readFile(staged.target, 'utf8')).toBe('portable document');
    const imported = (await target.transfer.commit(preview.sessionId, 'replace'))!;
    const file = imported.items.find((item) => item.type === 'file')!;
    expect(file.target.startsWith(join(target.directory, 'attachments') + sep)).toBe(true);
    await expect(stat(staged.target)).rejects.toMatchObject({ code: 'ENOENT' });
    const report = await target.service.resumeWorkspace(imported.id);
    expect(report.results.every((item) => item.status === 'success')).toBe(true);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ target: file.target }));
  });
  it('keeps missing paths disabled, resumes other items, and allows later native-selected rebinding', async () => {
    const source = await sample();
    const data = await source.transfer.export(source.workspace.id, []);
    await rm(source.attachment.target);
    const target = await setup();
    const preview = await target.transfer.prepare(data);
    expect(preview.items[1]).toMatchObject({ unresolved: true, enabled: false });
    const imported = (await target.transfer.commit(preview.sessionId, 'replace'))!;
    const missing = imported.items[1];
    target.service.updateItem(imported.id, missing.id, { ...missing, enabled: true });
    const report = await target.service.resumeWorkspace(imported.id);
    expect(report.results.map((item) => item.name)).toEqual(['Project', 'Docs']);
    expect(report.skipped).toBe(2);
    const located = join(target.directory, 'found.pdf');
    await writeFile(located, 'rebound');
    const resolved = await target.transfer.locateSaved(imported.id, missing.id, located);
    expect(resolved).toMatchObject({ unresolved: false, enabled: true, target: located });
  });
  it('locates missing items in preview and preserves originally disabled state and arguments', async () => {
    const source = await sample();
    const app = source.workspace.items[0];
    const data = await source.transfer.export(source.workspace.id, []);
    await rm(app.target);
    const target = await setup();
    const preview = await target.transfer.prepare(data);
    await expect(
      target.transfer.locate(preview.sessionId, app.id, source.directory),
    ).rejects.toThrow('application');
    const exe = join(target.directory, 'replacement.exe');
    await writeFile(exe, 'test');
    const located = await target.transfer.locate(preview.sessionId, app.id, exe);
    expect(located.items[0]).toMatchObject({
      unresolved: false,
      enabled: false,
      arguments: app.arguments,
    });
    const imported = (await target.transfer.commit(preview.sessionId, 'replace'))!;
    expect(imported.items[0].target).toBe(exe);
    expect(imported.items[0].enabled).toBe(false);
  });
  it('supports replace, duplicate, and cancel by workspace ID, with transactional validation', async () => {
    const source = await sample();
    const data = await source.transfer.export(source.workspace.id, []);
    source.service.updateWorkspace(source.workspace.id, { name: 'Changed' });
    let preview = await source.transfer.prepare(data);
    expect(preview.duplicate).toBe(true);
    expect(await source.transfer.commit(preview.sessionId, 'cancel')).toBeNull();
    expect(source.service.getWorkspace(source.workspace.id).name).toBe('Changed');
    preview = await source.transfer.prepare(data);
    const replaced = (await source.transfer.commit(preview.sessionId, 'replace'))!;
    expect(replaced.id).toBe(source.workspace.id);
    expect(replaced.name).toBe('ModelMux');
    expect(source.service.listWorkspaces()).toHaveLength(1);
    preview = await source.transfer.prepare(data);
    const copied = (await source.transfer.commit(preview.sessionId, 'duplicate'))!;
    expect(copied.id).not.toBe(replaced.id);
    expect(
      copied.items.every((item) => !replaced.items.some((other) => other.id === item.id)),
    ).toBe(true);
    expect(source.service.listWorkspaces()).toHaveLength(2);
    expect(() =>
      source.service.importWorkspace(
        {
          ...replaced,
          items: [{ ...replaced.items[0], unresolved: false, target: 'invalid' }],
        },
        'replace',
      ),
    ).toThrow();
    expect(source.service.getWorkspace(replaced.id)).toEqual(replaced);
  });
  it('handles same-name different-ID imports without treating them as duplicate IDs', async () => {
    const source = await sample();
    const target = await setup();
    target.service.createWorkspace({ name: source.workspace.name });
    const preview = await target.transfer.prepare(
      await source.transfer.export(source.workspace.id, []),
    );
    expect(preview.duplicate).toBe(false);
    const imported = (await target.transfer.commit(preview.sessionId, 'replace'))!;
    expect(imported.name).toBe('ModelMux (import 1)');
    expect(target.service.listWorkspaces()).toHaveLength(2);
  });
  it('rejects missing attachments, wrong format/version, traversal and duplicate archive paths before touching SQLite', async () => {
    const source = await sample();
    const target = await setup();
    const original = readArchive(
      await source.transfer.export(source.workspace.id, [source.attachment.id]),
    );
    for (const value of [
      { ...original.manifest, format: 'wrong' },
      { ...original.manifest, version: 2 },
      { ...original.manifest, token: 'not-allowed' },
    ])
      expect(() => parseManifest(value)).toThrow();
    const manifestBytes = Buffer.from(JSON.stringify(original.manifest));
    for (const entries of [
      { 'manifest.json': manifestBytes },
      { 'manifest.json': manifestBytes, '../escape.txt': Buffer.from('bad') },
      { 'manifest.json': manifestBytes, 'files/CON.txt': Buffer.from('bad') },
      {
        'manifest.json': manifestBytes,
        'files/safe.txt': Buffer.from('one'),
        'files/SAFE.txt': Buffer.from('two'),
      },
    ] as Record<string, Uint8Array>[])
      await expect(target.transfer.prepare(zipSync(entries))).rejects.toThrow();
    await expect(target.transfer.prepare(Buffer.from('not a zip'))).rejects.toThrow();
    expect(target.service.listWorkspaces()).toEqual([]);
  });
  it('never packages a folder or executable application as an attachment', async () => {
    const source = await sample();
    for (const item of source.workspace.items.filter((item) => item.type !== 'file'))
      await expect(source.transfer.export(source.workspace.id, [item.id])).rejects.toThrow(
        'Only file',
      );
  });
  it('rechecks missing paths at commit and does not activate a removed resource', async () => {
    const source = await sample();
    const target = await setup();
    const preview = await target.transfer.prepare(
      await source.transfer.export(source.workspace.id, []),
    );
    await rm(source.attachment.target);
    const imported = (await target.transfer.commit(preview.sessionId, 'replace'))!;
    expect(imported.items[1]).toMatchObject({ unresolved: true, enabled: false });
  });
});

describe('GitHub single-archive provider', () => {
  const connection = { owner: 'sample', repository: 'private-workspaces', branch: 'main' };
  const token = 'github_pat_' + 'fakeForTestingOnly';
  function githubMock(data: Uint8Array, id: string) {
    const requests: { url: string; init: RequestInit }[] = [];
    let uploaded: Record<string, unknown> | undefined;
    const path = 'contextdock/workspaces/' + id + '.contextdock';
    const request = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      const address = String(url);
      requests.push({ url: address, init });
      if (init.method === 'PUT') {
        uploaded = JSON.parse(String(init.body));
        return Response.json({ content: { path } });
      }
      if (address.includes('/branches/')) return Response.json({ name: 'main' });
      if (address.includes('/contents/' + path)) {
        if ((init.headers as Record<string, string>).Accept === 'application/vnd.github.raw+json')
          return new Response(Buffer.from(data));
        return Response.json({ sha: 'existing-file-sha' });
      }
      if (address.includes('/contents/contextdock/workspaces'))
        return Response.json([{ type: 'file', path }]);
      return Response.json({ private: true, size: 1 });
    }) as typeof fetch;
    return {
      provider: new GitHubProvider(connection, token, request),
      requests,
      uploaded: () => uploaded,
    };
  }
  it('uploads exactly one archive, lists names and downloads into the very same import service', async () => {
    const source = await sample();
    const data = await source.transfer.export(source.workspace.id, [source.attachment.id]);
    const mock = githubMock(data, source.workspace.id);
    await mock.provider.upload(source.workspace.id, data);
    expect(mock.requests.filter((request) => request.init.method === 'PUT')).toHaveLength(1);
    expect(Buffer.from(String(mock.uploaded()!.content), 'base64')).toEqual(Buffer.from(data));
    expect(mock.uploaded()!.sha).toBe('existing-file-sha');
    const remote = await mock.provider.list();
    expect(remote[0].name).toBe('ModelMux');
    const target = await setup();
    const preview = await target.transfer.prepare(await mock.provider.download(remote[0].path));
    const imported = (await target.transfer.commit(preview.sessionId, 'replace'))!;
    expect(await readFile(imported.items[1].target, 'utf8')).toBe('portable document');
    expect(JSON.stringify(readArchive(data).manifest)).not.toContain(token);
    expect(
      mock.requests.every((request) =>
        request.url.startsWith('https://api.github.com/repos/sample/private-workspaces'),
      ),
    ).toBe(true);
  });
  it.each([401, 403, 404, 500])('does not mutate local workspaces on HTTP %s', async (status) => {
    const source = await sample();
    const before = source.service.listWorkspaces();
    const provider = new GitHubProvider(
      connection,
      token,
      vi.fn(async () => new Response(null, { status })),
    );
    await expect(
      provider.upload(source.workspace.id, await source.transfer.export(source.workspace.id, [])),
    ).rejects.toThrow('GitHub');
    await expect(provider.list()).rejects.toThrow('GitHub');
    expect(source.service.listWorkspaces()).toEqual(before);
  });
  it('sanitizes network exceptions and rejects public repositories and remote path injection', async () => {
    const failed = new GitHubProvider(
      connection,
      token,
      vi.fn(async () => {
        throw new Error('request failed with ' + token);
      }),
    );
    await expect(failed.list()).rejects.toThrow('Check your connection');
    try {
      await failed.list();
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
    const publicRepo = new GitHubProvider(
      connection,
      token,
      vi.fn(async () => Response.json({ private: false })),
    );
    await expect(publicRepo.list()).rejects.toThrow('private');
    await expect(publicRepo.download('../elsewhere')).rejects.toThrow('Invalid remote');
  });
  it('handles empty repositories and missing remote files without multi-file commits', async () => {
    const data = buildArchive(
      {
        format: 'contextdock-workspace',
        version: 1,
        workspace: { id: randomUUID(), name: 'Empty', description: '', items: [] },
      },
      {},
    );
    const request = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      if (init.method === 'PUT') return Response.json({});
      return String(url).includes('/contents/')
        ? new Response(null, { status: 404 })
        : Response.json({ private: true, size: 0 });
    });
    const provider = new GitHubProvider(connection, token, request);
    expect(await provider.list()).toEqual([]);
    await provider.upload(readArchive(data).manifest.workspace.id, data);
    const body = JSON.parse(
      String(request.mock.calls.find(([, init]) => init?.method === 'PUT')![1]!.body),
    );
    expect(body.sha).toBeUndefined();
  });
});

describe('main-process credentials', () => {
  it('persists encrypted bytes only and returns no token or ciphertext to the renderer', async () => {
    const env = await setup();
    // Test adapter; production injects Electron safeStorage (Windows DPAPI).
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) =>
        Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 173)),
      decryptString: (value: Buffer) =>
        Buffer.from([...value].map((byte) => byte ^ 173)).toString(),
    };
    const credentials = new Credentials(env.directory, encryption);
    const token = 'github_pat_' + 'fakeForTestingOnly';
    await credentials.save({ owner: 'example', repository: 'private', branch: 'main' });
    await credentials.storeToken(token);
    const disk = await readFile(join(env.directory, 'github-connection.json'), 'utf8');
    expect(disk).not.toContain(token);
    expect(await credentials.token()).toBe(token);
    const status = await credentials.status();
    expect(Object.keys(status).sort()).toEqual(['branch', 'hasToken', 'owner', 'repository']);
    expect(JSON.stringify(status)).not.toContain(token);
    expect(status.hasToken).toBe(true);
    expect(await readFile(join(env.directory, 'contextdock.sqlite'), 'utf8')).not.toContain(token);
    const rendererFiles = ['src/renderer/github-settings.tsx', 'src/desktop/preload.ts'];
    for (const path of rendererFiles) {
      const source = await readFile(path, 'utf8');
      expect(source).not.toMatch(/encryptString|decryptString|encryptedToken|type="password"/u);
    }
    const insecure = new Credentials(env.directory, {
      ...encryption,
      isEncryptionAvailable: () => false,
    });
    await expect(insecure.storeToken(token)).rejects.toThrow('Secure token storage');
    await expect(credentials.storeToken('invalid')).rejects.toThrow('fine-grained');
  });
});
