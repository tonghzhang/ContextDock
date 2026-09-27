import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';

// Capture the real production UI with a disposable collection of fictional workspaces.
// No resource is launched, and the user's existing collection is never opened or changed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDirectory = path.join(root, 'work');
const outputDirectory = path.join(root, 'docs', 'screenshots');
const compact = process.argv.includes('--compact');
for (const file of ['dist/main.cjs', 'dist/preload.cjs', 'dist/renderer/index.html']) {
  try {
    await access(path.join(root, file));
  } catch {
    throw new Error('Build ContextDock first: npm run build');
  }
}
await mkdir(workDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
const profile = await mkdtemp(path.join(workDirectory, 'screenshot-'));
const temporaryDirectory = path.join(profile, 'temp');
await mkdir(temporaryDirectory, { recursive: true });
const env = {
  ...process.env,
  CONTEXTDOCK_DATA_DIR: profile,
  TEMP: temporaryDirectory,
  TMP: temporaryDirectory,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.CONTEXTDOCK_DEV_URL;

const examples = [
  {
    name: 'Research',
    description: 'A quiet place for papers, notes, and the next useful idea.',
    items: [
      { type: 'url', name: 'arXiv', target: 'https://arxiv.org/' },
      { type: 'url', name: 'MDN Web Docs', target: 'https://developer.mozilla.org/' },
      { type: 'folder', name: 'Reading notes', target: String.raw`C:\Projects\Research\notes` },
    ],
  },
  {
    name: 'Unity',
    description: 'Build, test, and refine the next scene.',
    items: [
      {
        type: 'application',
        name: 'Unity Editor',
        target: String.raw`C:\Applications\Unity\Editor\Unity.exe`,
        arguments: ['-projectPath', String.raw`C:\Projects\Studio`],
      },
      {
        type: 'application',
        name: 'Visual Studio Code',
        target: String.raw`C:\Applications\VS Code\Code.exe`,
        arguments: [String.raw`C:\Projects\Studio`],
      },
      { type: 'url', name: 'Unity Manual', target: 'https://docs.unity3d.com/Manual/' },
    ],
  },
  {
    name: 'ModelMux',
    description: 'The code, references, and design notes for the model gateway.',
    items: [
      {
        type: 'application',
        name: 'Visual Studio Code',
        target: String.raw`C:\Applications\VS Code\Code.exe`,
        arguments: [String.raw`C:\Projects\ModelMux`],
      },
      { type: 'url', name: 'Redis documentation', target: 'https://redis.io/docs/latest/' },
      { type: 'folder', name: 'Project docs', target: String.raw`C:\Projects\ModelMux\docs` },
      {
        type: 'file',
        name: 'Gateway design',
        target: String.raw`C:\Projects\ModelMux\docs\gateway-design.pdf`,
      },
    ],
  },
];

let application;
const rendererErrors = [];
try {
  application = await electron.launch({
    executablePath: electronExecutable,
    args: [root],
    cwd: root,
    env,
    timeout: 60000,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  await page.getByRole('button', { name: 'New workspace', exact: true }).waitFor();
  const info = await page.evaluate(() => window.contextdock.getAppInfo());
  assert.equal(info.ok, true);
  assert.equal(info.data.dataDirectory.toLowerCase(), profile.toLowerCase());

  await page.evaluate(async (samples) => {
    const api = window.contextdock;
    if (!api) throw new Error('The desktop API is unavailable.');
    const existing = await api.listWorkspaces();
    if (!existing.ok || existing.data.length !== 0) {
      throw new Error('Screenshot collection must start empty.');
    }
    for (const sample of samples) {
      const created = await api.createWorkspace({
        name: sample.name,
        description: sample.description,
      });
      if (!created.ok) throw new Error(created.error);
      for (const item of sample.items) {
        const added = await api.addItem(created.data.id, { ...item, enabled: true });
        if (!added.ok) throw new Error(added.error);
      }
    }
    // Refresh the same way the app notices changes made by the CLI or MCP server.
    window.dispatchEvent(new Event('focus'));
  }, examples);
  await page.getByRole('button', { name: 'Open details for ModelMux', exact: true }).click();
  await page.getByRole('heading', { name: 'ModelMux', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit Gateway design', exact: true }).waitFor();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1360, 980);
  });
  await page.waitForFunction(() => window.innerWidth === 1360 && window.innerHeight === 980);
  await page.evaluate(() => document.fonts.ready);
  const visibleText = await page.locator('body').innerText();
  assert.equal(visibleText.includes(root), false, 'Screenshot must not expose the checkout path.');
  assert.equal(
    visibleText.includes(profile),
    false,
    'Screenshot must not expose the test profile.',
  );
  await page.screenshot({
    path: path.join(outputDirectory, 'workspace.png'),
    animations: 'disabled',
  });
  console.log('Saved docs/screenshots/workspace.png using fictional sample workspaces.');

  if (process.argv.includes('--languages')) {
    for (const language of ['zh-CN', 'ja']) {
      const updated = await page.evaluate(
        (value) => window.contextdock.setLanguage(value),
        language,
      );
      assert.equal(updated.ok, true);
      await page.reload();
      await page.getByRole('heading', { name: 'ModelMux', exact: true }).waitFor();
      await page.waitForFunction((value) => document.documentElement.lang === value, language);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.join(outputDirectory, 'workspace-' + language + '.png'),
        animations: 'disabled',
      });
    }
    await page.evaluate(() => window.contextdock.setLanguage('en'));
    await page.reload();
    await page.getByRole('heading', { name: 'ModelMux', exact: true }).waitFor();
  }

  if (compact) {
    const compactDirectory = path.join(workDirectory, 'screenshots');
    await mkdir(compactDirectory, { recursive: true });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(920, 620);
    });
    await page.waitForFunction(() => window.innerWidth === 920 && window.innerHeight === 620);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      'The compact window must not overflow horizontally.',
    );
    await page.screenshot({
      path: path.join(compactDirectory, 'workspace-compact.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
      true,
      'The item dialog must receive keyboard focus.',
    );
    await page.screenshot({
      path: path.join(compactDirectory, 'item-dialog-compact.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    console.log('Saved compact layout checks in work/screenshots/.');
  }
  assert.deepEqual(rendererErrors, [], 'Renderer must finish without uncaught errors.');
} finally {
  if (application) await application.close();
}
