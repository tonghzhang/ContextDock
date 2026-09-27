import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';

const dictionary = await build({
  entryPoints: ['src/shared/i18n.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { translate } = await import(
  'data:text/javascript;base64,' + Buffer.from(dictionary.outputFiles[0].text).toString('base64')
);
await mkdir('work', { recursive: true });
const profile = await mkdtemp(path.resolve('work/language-smoke-'));
const env = { ...process.env, CONTEXTDOCK_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.CONTEXTDOCK_E2E_EXE;
let app;
let page;
let language = 'en';
const errors = [];
const t = (message, values) => translate(language, message, values);
async function launch() {
  app = await electron.launch({
    executablePath: packaged || electronExecutable,
    args: packaged ? [] : ['.'],
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: t('New workspace'), exact: true }).waitFor();
}
async function settings() {
  await page.getByRole('button', { name: t('Settings'), exact: true }).click();
}
async function change(next) {
  await page.getByRole('combobox').selectOption(next);
  language = next;
  await page.waitForFunction((value) => document.documentElement.lang === value, next);
  assert.equal(await page.getByRole('combobox').inputValue(), next);
  await page
    .getByRole('dialog')
    .getByRole('heading', { name: t('Settings'), exact: true })
    .waitFor();
  const stored = await page.evaluate(() => window.contextdock.getLanguage());
  assert.equal(stored.data, next);
  const menu = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items.map((item) => item.label),
  );
  assert.equal(menu[0], t('File'));
}
async function done() {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('Done'), exact: true })
    .click();
}
try {
  await launch();
  const name = '多语言 Workspace ワークスペース';
  const target = path.join(profile, 'missing-document.pdf');
  const created = await page.evaluate(
    async ({ name, target }) => {
      const result = await window.contextdock.createWorkspace({
        name,
        description: '中文と日本語',
      });
      if (!result.ok) throw new Error(result.error);
      await window.contextdock.addItem(result.data.id, {
        type: 'file',
        name: '资料 / 資料',
        target,
      });
      await window.contextdock.addItem(result.data.id, {
        type: 'url',
        name: 'Documentation',
        target: 'https://example.com',
        enabled: false,
      });
      return result.data;
    },
    { name, target },
  );
  await page.reload();
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await settings();
  await change('zh-CN');
  await page.screenshot({ path: path.join(profile, 'settings-zh-CN.png') });
  await done();
  await page.getByRole('heading', { name: '工作区', exact: true }).waitFor();
  await page.getByRole('button', { name: t('Add item'), exact: true }).click();
  let modal = page.getByRole('dialog');
  await modal.getByRole('radio', { name: t('URL'), exact: true }).check();
  await modal.getByLabel(t('Website address'), { exact: true }).fill('javascript:alert(1)');
  await modal.getByLabel(t('Item name'), { exact: true }).focus();
  await modal.getByLabel(t('Item name'), { exact: true }).fill('无效网址');
  await modal.locator('button[type="submit"]').click();
  await modal.getByRole('alert').waitFor();
  assert.match(await modal.getByRole('alert').innerText(), /网址/);
  await modal.getByRole('button', { name: t('Cancel'), exact: true }).click();
  await page.getByRole('button', { name: t('Resume workspace'), exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('heading', { name: t('Some items need attention'), exact: true })
    .waitFor();
  assert.match(await page.locator('.launch-error').innerText(), /路径不存在/);
  await page.getByRole('button', { name: t('Back to workspace'), exact: true }).click();
  await settings();
  await change('ja');
  await done();
  await page.getByRole('searchbox', { name: 'ワークスペースを検索', exact: true }).waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async (_parent, options) => {
      globalThis.__pickerOptions = options;
      return { canceled: true, filePaths: [] };
    };
  });
  await page.evaluate(() => window.contextdock.selectTarget('application'));
  const options = await app.evaluate(() => globalThis.__pickerOptions);
  assert.equal(options.title, t('Select application'));
  assert.equal(options.buttonLabel, t('Select'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 620));
  await settings();
  await page.screenshot({ path: path.join(profile, 'settings-ja-small.png') });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await done();
  await page.screenshot({ path: path.join(profile, 'workspace-ja-small.png') });
  const saved = await page.evaluate((id) => window.contextdock.getWorkspace(id), created.id);
  assert.equal(saved.data.name, name);
  assert.equal(saved.data.items[0].target, target);
  assert.equal(saved.data.items.length, 2);
  await app.close();
  app = undefined;
  await launch();
  assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
  const resumed = await page.evaluate((id) => window.contextdock.getWorkspace(id), created.id);
  assert.deepEqual(resumed, saved);
  const invalid = await page.evaluate(() => window.contextdock.setLanguage('unsupported'));
  assert.equal(invalid.ok, false);
  assert.equal((await page.evaluate(() => window.contextdock.getLanguage())).data, 'ja');
  await settings();
  await change('en');
  await done();
  await page.getByRole('heading', { name: 'Workspaces', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        packaged: Boolean(packaged),
        profile,
        checks: [
          'English → Chinese → Japanese → English',
          'immediate native menu changes',
          'native file-picker localization',
          'Chinese validation and launch errors',
          'Japanese minimum-size layout',
          'language persistence after restart',
          'unchanged workspace content',
          'invalid language rejection',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
}
