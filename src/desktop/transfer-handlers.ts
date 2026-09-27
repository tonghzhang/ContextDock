import { dialog, safeStorage, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { safeFileName } from '../transfer/manifest';
import type { WorkspaceService } from '../core/service';
import type { GitHubConnection, ImportMode } from '../shared/transfer';
import type { ItemType } from '../shared/types';
import { WorkspaceTransferService } from '../transfer/service';
import { GitHubProvider } from '../transfer/github-provider';
import { readLocalArchive, writeLocalArchive } from '../transfer/local-provider';
import { Credentials, promptForToken } from './credentials';
export function transferHandlers(
  service: WorkspaceService,
  dataDirectory: string,
  getWindow: () => BrowserWindow | null,
  t: (message: string) => string,
) {
  const transfer = new WorkspaceTransferService(service, dataDirectory);
  const credentials = new Credentials(join(dataDirectory, 'desktop'), safeStorage);
  async function github() {
    const { owner, repository, branch } = await credentials.status();
    return new GitHubProvider({ owner, repository, branch }, await credentials.token());
  }
  async function selectTarget(type: ItemType): Promise<string | null> {
    const window = getWindow();
    if (!window || type === 'url') throw new Error('Choose an unresolved item.');
    const result = await dialog.showOpenDialog(window, {
      title: t(
        type === 'application'
          ? 'Select application'
          : type === 'folder'
            ? 'Select folder'
            : 'Select file',
      ),
      properties: type === 'folder' ? ['openDirectory'] : ['openFile'],
      ...(type === 'application'
        ? { filters: [{ name: t('Windows applications'), extensions: ['exe'] }] }
        : {}),
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }
  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    'transfer:export': async (id, fileIds, destination) => {
      if (destination !== 'local' && destination !== 'github')
        throw new Error('Choose an export destination.');
      let path: string | undefined;
      if (destination === 'local') {
        const window = getWindow();
        if (!window) throw new Error('The application window is unavailable.');
        const workspace = service.getWorkspace(id as string);
        const result = await dialog.showSaveDialog(window, {
          title: t('Export workspace'),
          defaultPath: safeFileName(workspace.name) + '.contextdock',
          filters: [{ name: 'ContextDock', extensions: ['contextdock'] }],
        });
        if (result.canceled || !result.filePath) return false;
        path = result.filePath;
      }
      const data = await transfer.export(id as string, fileIds as string[]);
      if (path) await writeLocalArchive(path, data);
      else await (await github()).upload(id as string, data);
      return true;
    },
    'transfer:import-local': async () => {
      const window = getWindow();
      if (!window) throw new Error('The application window is unavailable.');
      const result = await dialog.showOpenDialog(window, {
        title: t('Import workspace'),
        properties: ['openFile'],
        filters: [{ name: 'ContextDock', extensions: ['contextdock'] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return transfer.prepare(await readLocalArchive(result.filePaths[0]));
    },
    'transfer:list-remote': async () => (await github()).list(),
    'transfer:import-remote': async (path) =>
      transfer.prepare(await (await github()).download(path as string)),
    'transfer:locate': async (sessionId, itemId) => {
      const preview = transfer.preview(sessionId as string);
      const item = preview.items.find((item) => item.id === itemId && item.unresolved);
      if (!item) throw new Error('Choose an unresolved item.');
      const target = await selectTarget(item.type);
      return target ? transfer.locate(preview.sessionId, item.id, target) : preview;
    },
    'transfer:commit': (id, mode) => transfer.commit(id as string, mode as ImportMode),
    'transfer:cancel': (id) => transfer.cancel(id as string),
    'item:locate': async (workspaceId, itemId) => {
      const item = service
        .getWorkspace(workspaceId as string)
        .items.find((item) => item.id === itemId && item.unresolved);
      if (!item) throw new Error('Choose an unresolved item.');
      const target = await selectTarget(item.type);
      return target ? transfer.locateSaved(workspaceId as string, item.id, target) : null;
    },
    'github:status': () => credentials.status(),
    'github:save': (config) => credentials.save(config as GitHubConnection),
    'github:token': async () => {
      let token = await promptForToken({
        title: t('GitHub token'),
        hint: t('Paste a fine-grained PAT. It stays on this computer.'),
        save: t('Save'),
        cancel: t('Cancel'),
      });
      try {
        if (token) await credentials.storeToken(token);
      } finally {
        token = null;
      }
      return credentials.status();
    },
    'github:test': async () => (await github()).testConnection(),
  };
  let busy = false;
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      async (...args: unknown[]) => {
        if (busy) throw new Error('Another transfer is in progress. Please wait.');
        busy = true;
        try {
          return await handler(...args);
        } finally {
          busy = false;
        }
      },
    ]),
  );
}
