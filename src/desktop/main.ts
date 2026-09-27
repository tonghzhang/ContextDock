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
import type { ApiResult, ItemInput, WorkspaceInput } from '../shared/types';

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
    'dialog:select-target': async (type) => {
      if (type !== 'application' && type !== 'file' && type !== 'folder') {
        throw new Error('Choose an application, file, or folder.');
      }
      if (!window) throw new Error('The application window is unavailable.');
      const selected = await dialog.showOpenDialog(window, {
        title:
          type === 'application'
            ? 'Select application'
            : type === 'file'
              ? 'Select file'
              : 'Select folder',
        properties: type === 'folder' ? ['openDirectory'] : ['openFile'],
        ...(type === 'application'
          ? { filters: [{ name: 'Windows applications', extensions: ['exe'] }] }
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
        return { ok: false, error: 'This request did not come from the application window.' };
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
      'ContextDock could not open',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });
  const image = nativeImage
    .createFromPath(path.join(__dirname, '..', 'resources', 'icon.png'))
    .resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip('ContextDock — resume your workspace');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open ContextDock', click: showWindow },
      { type: 'separator' },
      { label: 'Quit ContextDock', click: () => app.quit() },
    ]),
  );
  tray.on('double-click', showWindow);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Show ContextDock', click: showWindow },
          { type: 'separator' },
          { label: 'Quit', accelerator: 'Alt+F4', click: () => app.quit() },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  void app
    .whenReady()
    .then(() => {
      context = createContext({ dataDir: dataDirectory });
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
        'ContextDock could not start',
        error instanceof Error ? error.message : String(error),
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
