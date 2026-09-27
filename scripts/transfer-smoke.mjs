import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';

const root = process.cwd();
await mkdir(path.join(root, 'work'), { recursive: true });
const profile = await mkdtemp(path.join(root, 'work', 'transfer-smoke-'));
const file = path.join(profile, 'notes.txt');
const archive = path.join(profile, 'Portable.contextdock');
const marker = path.join(profile, 'resumed.txt');
await writeFile(file, 'Carried between computers.');
const env = { ...process.env, CONTEXTDOCK_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronExecutable, args: ['.'], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'New workspace', exact: true }).waitFor();
  const original = await page.evaluate(
    async ({ file, executable, marker, profile }) => {
      const api = window.contextdock;
      const workspace = (
        await api.createWorkspace({
          name: 'Portable workspace',
          description: 'A real desktop transfer',
        })
      ).data;
      await api.addItem(workspace.id, {
        type: 'application',
        name: 'Resume probe',
        target: executable,
        arguments: ['-e', 'require("fs").writeFileSync(process.argv[1], "resumed")', marker],
      });
      await api.addItem(workspace.id, {
        type: 'file',
        name: 'Notes',
        target: file,
        enabled: false,
      });
      await api.addItem(workspace.id, {
        type: 'folder',
        name: 'Missing folder',
        target: profile + '/missing-project',
      });
      await api.addItem(workspace.id, {
        type: 'url',
        name: 'Website',
        target: 'https://example.com',
        enabled: false,
      });
      return (await api.getWorkspace(workspace.id)).data;
    },
    { file, executable: process.execPath, marker, profile },
  );
  await page.reload();
  await page.getByRole('heading', { name: 'Portable workspace', exact: true }).waitFor();
  await app.evaluate(({ dialog }, selected) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, archive);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('checkbox').check();
  await modal.getByRole('button', { name: 'Save file…', exact: true }).click();
  await modal.getByText('Workspace exported.', { exact: true }).waitFor();
  assert.equal((await readFile(archive)).subarray(0, 2).toString(), 'PK');
  await modal.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await modal.getByRole('button', { name: 'Choose .contextdock file…', exact: true }).click();
  await modal.getByText('Needs locating', { exact: true }).waitFor();
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual((await page.evaluate(() => window.contextdock.listWorkspaces())).data, [
    original,
  ]);

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await modal.getByRole('button', { name: 'Choose .contextdock file…', exact: true }).click();
  await modal.getByRole('button', { name: 'Import as copy', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  const workspaces = (await page.evaluate(() => window.contextdock.listWorkspaces())).data;
  const copy = workspaces.find((workspace) => workspace.id !== original.id);
  assert.equal(workspaces.length, 2);
  assert.equal(copy.items[2].unresolved, true);
  assert.equal(copy.items[2].enabled, false);
  assert.equal(await readFile(copy.items[1].target, 'utf8'), 'Carried between computers.');
  assert.deepEqual(copy.items[0].arguments, original.items[0].arguments);
  assert.equal(copy.items[1].enabled, false);
  assert.equal(
    await page.getByRole('switch', { name: 'Enable Missing folder', exact: true }).isDisabled(),
    true,
  );

  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async (_parent, options) => {
      globalThis.__transferPicker = options;
      return { canceled: false, filePaths: [folder] };
    };
  }, profile);
  await page.getByRole('button', { name: /Needs locating.*Locate/ }).click();
  await page.getByRole('switch', { name: 'Enable Missing folder', exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Enable Missing folder"]').disabled,
  );
  assert.deepEqual((await app.evaluate(() => globalThis.__transferPicker)).properties, [
    'openDirectory',
  ]);
  await page.getByRole('switch', { name: 'Enable Missing folder', exact: true }).click();
  await page.getByRole('button', { name: 'Resume workspace', exact: true }).click();
  await modal.getByRole('button', { name: 'Back to workspace', exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await readFile(marker, 'utf8'), 'resumed');
  await modal.getByRole('button', { name: 'Back to workspace', exact: true }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await modal.getByLabel('Owner', { exact: true }).fill('example');
  await modal.getByLabel('Repository', { exact: true }).fill('private-workspaces');
  await modal.getByRole('button', { name: 'Save connection', exact: true }).click();
  await modal.getByText('Connection settings saved.', { exact: true }).waitFor();
  assert.equal(
    await modal.getByRole('button', { name: 'Test connection', exact: true }).isDisabled(),
    true,
  );
  const connection = (await page.evaluate(() => window.contextdock.getGitHubConnection())).data;
  assert.deepEqual(Object.keys(connection).sort(), ['branch', 'hasToken', 'owner', 'repository']);
  const encryption = await app.evaluate(({ safeStorage }) => {
    const value = 'local-encryption-probe';
    const encrypted = safeStorage.encryptString(value);
    return {
      available: safeStorage.isEncryptionAvailable(),
      changed: !encrypted.includes(value),
      restored: safeStorage.decryptString(encrypted) === value,
    };
  });
  assert.deepEqual(encryption, { available: true, changed: true, restored: true });
  await modal.getByLabel('Language', { exact: true }).selectOption('zh-CN');
  await modal.getByRole('heading', { name: 'GitHub 连接', exact: true }).waitFor();
  await modal.getByLabel('语言', { exact: true }).selectOption('ja');
  await modal.getByRole('heading', { name: 'GitHub 接続', exact: true }).waitFor();
  await modal.getByLabel('言語', { exact: true }).selectOption('en');
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        checks: [
          'native save/open picker integration',
          'ZIP attachment export',
          'cancel preserves database',
          'copy import and managed attachments',
          'missing paths and native relocation',
          'actual executable Resume',
          'GitHub settings',
          'Windows safeStorage encryption',
          'English/Chinese/Japanese transfer UI',
        ],
        profile,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
