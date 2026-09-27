import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import { createServer } from 'vite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
await mkdir(path.join(root, 'work'), { recursive: true });
const profile = await mkdtemp(path.join(root, 'work', 'desktop-smoke-'));
const env = { ...process.env, CONTEXTDOCK_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.CONTEXTDOCK_E2E_EXE;
const developmentServer =
  process.env.CONTEXTDOCK_E2E_DEV === '1' ? await createServer() : undefined;
if (developmentServer) {
  await developmentServer.listen();
  env.CONTEXTDOCK_DEV_URL = 'http://127.0.0.1:5173';
}
const errors = [];
let application;
async function launch() {
  application = await electron.launch({
    executablePath: packaged || electronExecutable,
    args: packaged ? [] : ['.'],
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'New workspace', exact: true }).waitFor();
  return page;
}
async function getWorkspaces(page) {
  const result = await page.evaluate(() => window.contextdock.listWorkspaces());
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
async function addItem(page, type, name, target, { args = '', picker = false } = {}) {
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('radio', { name: type, exact: true }).check();
  if (picker) {
    await application.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async (_parent, options) => {
        globalThis.__contextdockPickerOptions = options;
        return { canceled: false, filePaths: [selected] };
      };
    }, target);
    await modal.getByRole('button', { name: new RegExp('^Select ') }).click();
  } else {
    const labels = {
      Application: 'Application path',
      File: 'File path',
      Folder: 'Folder path',
      URL: 'Website address',
    };
    await modal.getByLabel(labels[type], { exact: true }).fill(target);
  }
  await modal.getByLabel('Item name', { exact: true }).focus();
  await modal.getByLabel('Item name', { exact: true }).fill(name);
  if (args) await modal.getByLabel(/^Arguments/).fill(args);
  await modal.getByRole('button', { name: 'Add item', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
}
try {
  let page = await launch();
  const info = await page.evaluate(() => window.contextdock.getAppInfo());
  assert.equal(info.ok, true);
  assert.equal(info.data.dataDirectory.toLowerCase(), profile.toLowerCase());
  assert.equal(info.data.shortcutRegistered, true, 'Global shortcut must register for smoke test');
  const isolation = await page.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
  }));
  assert.deepEqual(isolation, { require: 'undefined', process: 'undefined' });

  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Focus Session');
  await page.getByLabel(/^Description/).fill('An end-to-end workspace');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create workspace', exact: true })
    .click();
  await page.getByRole('heading', { name: 'Focus Session', exact: true }).waitFor();

  // Native picker is supplied a deterministic choice; production still uses the OS dialog.
  await addItem(page, 'Application', 'Smoke process', process.execPath, {
    args: '-e\nprocess.exit(0)',
    picker: true,
  });
  const chooser = await application.evaluate(() => globalThis.__contextdockPickerOptions);
  assert.deepEqual(chooser.properties, ['openFile']);
  assert.deepEqual(chooser.filters[0].extensions, ['exe']);
  await addItem(page, 'File', 'Missing document', path.join(profile, 'missing.pdf'));
  await addItem(page, 'Folder', 'Working folder', profile, { picker: true });
  assert.deepEqual(
    (await application.evaluate(() => globalThis.__contextdockPickerOptions)).properties,
    ['openDirectory'],
  );
  await page.getByRole('switch', { name: 'Enable Working folder', exact: true }).click();
  await addItem(page, 'URL', 'Reference site', 'https://example.com');
  await page.getByRole('switch', { name: 'Enable Reference site', exact: true }).click();

  await page.getByRole('button', { name: 'Edit Reference site', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Website address', { exact: true })
    .fill('javascript:alert(1)');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  await page
    .getByRole('dialog')
    .getByLabel('Website address', { exact: true })
    .fill('https://example.com/docs');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: 'Move Missing document up', exact: true }).click();
  let saved = (await getWorkspaces(page))[0];
  assert.deepEqual(
    saved.items.map((item) => item.launchOrder),
    [0, 1, 2, 3],
  );
  assert.equal(saved.items[0].name, 'Missing document');
  assert.equal(saved.items[1].name, 'Smoke process');

  await page.keyboard.press('Control+k');
  await page.getByRole('searchbox', { name: 'Search workspaces', exact: true }).fill('Focus');
  await page.keyboard.press('Enter');
  await page
    .getByRole('dialog')
    .getByRole('heading', { name: 'Some items need attention' })
    .waitFor();
  assert.match(await page.getByLabel('Resume summary', { exact: true }).textContent(), /1 opened/);
  assert.match(await page.getByLabel('Resume summary', { exact: true }).textContent(), /1 failed/);
  assert.match(
    await page.getByLabel('Resume summary', { exact: true }).textContent(),
    /2 disabled/,
  );
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  saved = (await getWorkspaces(page))[0];
  assert.ok(saved.lastUsedAt);

  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate workspace', exact: true }).click();
  await page.getByRole('heading', { name: 'Focus Session (copy)', exact: true }).waitFor();
  const copies = await getWorkspaces(page);
  assert.equal(copies.length, 2);
  const original = copies.find((workspace) => workspace.name === 'Focus Session');
  const copy = copies.find((workspace) => workspace.name.endsWith('(copy)'));
  assert.equal(copy.items.length, 4);
  assert.equal(
    copy.items.some((item) => original.items.some((other) => other.id === item.id)),
    false,
  );
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete workspace', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await getWorkspaces(page)).length, 1);

  await page.getByRole('button', { name: 'Edit workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Focus Session renamed');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('heading', { name: 'Focus Session renamed', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Focus Session');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('heading', { name: 'Focus Session', exact: true }).waitFor();

  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('focus session');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create workspace', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await getWorkspaces(page)).length, 1);

  await addItem(page, 'File', 'Temporary bookmark', path.join(profile, 'sample.txt'), {
    picker: true,
  });
  assert.deepEqual(
    (await application.evaluate(() => globalThis.__contextdockPickerOptions)).properties,
    ['openFile'],
  );
  await page.getByRole('button', { name: 'Remove Temporary bookmark', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove item', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await getWorkspaces(page))[0].items.length, 4);

  const cliFile = packaged
    ? path.join(path.dirname(packaged), 'resources', 'cli', 'cli.cjs')
    : path.join(root, 'dist', 'cli.cjs');
  const runtime = packaged || process.execPath;
  const runtimeEnv = { ...env, ...(packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
  const listed = JSON.parse(
    execFileSync(runtime, [cliFile, 'list', '--json'], { env: runtimeEnv, encoding: 'utf8' }),
  );
  assert.equal(listed[0].name, 'Focus Session');
  const mcpFile = packaged
    ? path.join(path.dirname(packaged), 'resources', 'cli', 'mcp.cjs')
    : path.join(root, 'dist', 'mcp.cjs');
  const client = new Client({ name: 'contextdock-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: runtime,
    args: [mcpFile],
    env: runtimeEnv,
    stderr: 'pipe',
  });
  let protocolErrors = '';
  transport.stderr?.on('data', (data) => {
    protocolErrors += data.toString();
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 6);
    const response = await client.callTool({
      name: 'get_workspace',
      arguments: { workspace: 'Focus Session' },
    });
    assert.equal(response.isError, false);
    assert.equal(response.structuredContent.workspace.items.length, 4);
  } finally {
    await client.close();
  }
  assert.equal(protocolErrors, '');
  await page.screenshot({ path: path.join(profile, 'desktop.png'), animations: 'disabled' });
  await application.close();
  application = undefined;
  page = await launch();
  await page.getByRole('button', { name: 'Open details for Focus Session', exact: true }).waitFor();
  assert.equal((await getWorkspaces(page))[0].items.length, 4);
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(920, 620),
  );
  await page.screenshot({ path: path.join(profile, 'desktop-small.png'), animations: 'disabled' });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    'No horizontal page overflow at minimum size',
  );
  assert.deepEqual(errors, []);
  const result = {
    status: 'passed',
    packaged: Boolean(packaged),
    development: Boolean(developmentServer),
    checks: [
      'desktop CRUD',
      'native-picker options',
      'item CRUD/order/toggle',
      'URL validation',
      'sequential partial Resume',
      'Ctrl+K/Enter',
      'global shortcut registration',
      'SQLite restart persistence',
      'CLI shared data',
      'MCP stdio shared data',
      'renderer isolation',
      'minimum window size',
    ],
    profile,
  };
  await writeFile(path.join(profile, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await application?.close();
  await developmentServer?.close();
}
