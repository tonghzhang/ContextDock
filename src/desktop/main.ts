import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContext, resolveDataDirectory } from '../core';
import { translate } from '../shared/i18n';
import type { ApiResult, ItemInput, Language, WorkspaceInput } from '../shared/types';

app.setName('ContextDock');
const dataDirectory = resolveDataDirectory();
const desktopDirectory = path.join(dataDirectory, 'desktop');
for (const directory of [
  desktopDirectory,
  path.join(desktopDirectory, 'session'),
  path.join(desktopDirectory, 'logs'),
])
  mkdirSync(directory, { recursive: true });
app.setPath('userData', desktopDirectory);
app.setPath('sessionData', path.join(desktopDirectory, 'session'));
app.setPath('logs', path.join(desktopDirectory, 'logs'));
const devUrl = !app.isPackaged ? process.env.CONTEXTDOCK_DEV_URL : undefined;
if (devUrl && new URL(devUrl).origin !== 'http://127.0.0.1:5173') {
  throw new Error('Development URL must use the local ContextDock development server.');
}
const pageUrl = devUrl || pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let context: ReturnType<typeof createContext> | undefined;
let shortcut = 'Control+Alt+Space';
let shortcutRegistered = false;
let language: Language = 'en';

function t(message: string): string {
  return translate(language, message);
}

function refreshNativeMenus(): void {
  tray?.setToolTip(t('ContextDock — resume your workspace'));
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('Open ContextDock'), click: showWindow },
      { type: 'separator' },
      { label: t('Quit ContextDock'), click: () => app.quit() },
    ]),
  );
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: t('File'),
        submenu: [
          { label: t('Show ContextDock'), click: showWindow },
          { type: 'separator' },
          { label: t('Quit'), accelerator: 'Alt+F4', click: () => app.quit() },
        ],
      },
      {
        label: t('Edit'),
        submenu: [
          { label: t('Undo'), role: 'undo' },
          { label: t('Redo'), role: 'redo' },
          { type: 'separator' },
          { label: t('Cut'), role: 'cut' },
          { label: t('Copy'), role: 'copy' },
          { label: t('Paste'), role: 'paste' },
          { label: t('Select all'), role: 'selectAll' },
        ],
      },
      {
        label: t('View'),
        submenu: [
          { label: t('Actual size'), role: 'resetZoom' },
          { label: t('Zoom in'), role: 'zoomIn' },
          { label: t('Zoom out'), role: 'zoomOut' },
        ],
      },
    ]),
  );
}

function showWindow(): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function registerHandlers(): void {
  const service = context!.service;
  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    'workspace:list': () => service.listWorkspaces(),
    'workspace:get': (id) => service.getWorkspace(id as string),
    'workspace:create': (input) => service.createWorkspace(input as WorkspaceInput),
    'workspace:update': (id, input) =>
      service.updateWorkspace(id as string, input as WorkspaceInput),
    'workspace:delete': (id) => service.deleteWorkspace(id as string),
    'workspace:duplicate': (id) => service.duplicateWorkspace(id as string),
    'workspace:resume': (id) => service.resumeWorkspace(id as string),
    'item:add': (id, input) => service.addItem(id as string, input as ItemInput),
    'item:update': (id, itemId, input) =>
      service.updateItem(id as string, itemId as string, input as ItemInput),
    'item:remove': (id, itemId) => service.removeItem(id as string, itemId as string),
    'item:reorder': (id, ids) => service.reorderItems(id as string, ids as string[]),
    'app:info': () => ({ version: app.getVersion(), dataDirectory, shortcut, shortcutRegistered }),
    'app:get-language': () => {
      language = service.getLanguage();
      refreshNativeMenus();
      return language;
    },
    'app:set-language': (value) => {
      language = service.setLanguage(value as Language);
      refreshNativeMenus();
      return language;
    },
    'dialog:select-target': async (type) => {
      if (type !== 'application' && type !== 'file' && type !== 'folder') {
        throw new Error('Choose an application, file, or folder.');
      }
      if (!window) throw new Error('The application window is unavailable.');
      const selected = await dialog.showOpenDialog(window, {
        title: t(
          type === 'application'
            ? 'Select application'
            : type === 'file'
              ? 'Select file'
              : 'Select folder',
        ),
        buttonLabel: t('Select'),
        properties: type === 'folder' ? ['openDirectory'] : ['openFile'],
        ...(type === 'application'
          ? { filters: [{ name: t('Windows applications'), extensions: ['exe'] }] }
          : type === 'file'
            ? { filters: [{ name: t('All files'), extensions: ['*'] }] }
            : {}),
      });
      return selected.canceled ? null : (selected.filePaths[0] ?? null);
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<ApiResult<unknown>> => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      ) {
        return { ok: false, error: t('This request did not come from the application window.') };
      }
      try {
        return { ok: true, data: await handler(...args) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'The operation could not be completed.',
        };
      }
    });
  }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1220,
    height: 790,
    minWidth: 920,
    minHeight: 620,
    title: 'ContextDock',
    backgroundColor: '#11151f',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: Boolean(devUrl),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== pageUrl) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', showWindow);
  window.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.on('closed', () => {
    window = null;
  });
  void window.loadURL(pageUrl).catch((error: unknown) => {
    dialog.showErrorBox(
      t('ContextDock could not open'),
      t(error instanceof Error ? error.message : 'The application could not load its window.'),
    );
    app.quit();
  });
  const image = nativeImage
    .createFromPath(path.join(__dirname, '..', 'resources', 'icon.png'))
    .resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.on('double-click', showWindow);
  refreshNativeMenus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  void app
    .whenReady()
    .then(() => {
      context = createContext({ dataDir: dataDirectory });
      language = context.service.getLanguage();
      registerHandlers();
      createWindow();
      shortcutRegistered = globalShortcut.register(shortcut, showWindow);
      if (!shortcutRegistered) {
        shortcut = 'Control+Shift+Space';
        shortcutRegistered = globalShortcut.register(shortcut, showWindow);
      }
    })
    .catch((error: unknown) => {
      dialog.showErrorBox(
        t('ContextDock could not start'),
        t(error instanceof Error ? error.message : 'The application could not finish starting.'),
      );
      app.quit();
    });
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    tray?.destroy();
    context?.close();
  });
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
}
