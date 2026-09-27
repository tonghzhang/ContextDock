import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/types';
const api: DesktopApi = {
  exportWorkspace: (id, files, destination) =>
    ipcRenderer.invoke('transfer:export', id, files, destination),
  importLocal: () => ipcRenderer.invoke('transfer:import-local'),
  listRemote: () => ipcRenderer.invoke('transfer:list-remote'),
  importRemote: (path) => ipcRenderer.invoke('transfer:import-remote', path),
  locateImport: (id, itemId) => ipcRenderer.invoke('transfer:locate', id, itemId),
  commitImport: (id, mode) => ipcRenderer.invoke('transfer:commit', id, mode),
  cancelImport: (id) => ipcRenderer.invoke('transfer:cancel', id),
  locateItem: (id, itemId) => ipcRenderer.invoke('item:locate', id, itemId),
  getGitHubConnection: () => ipcRenderer.invoke('github:status'),
  saveGitHubConnection: (config) => ipcRenderer.invoke('github:save', config),
  setGitHubToken: () => ipcRenderer.invoke('github:token'),
  testGitHubConnection: () => ipcRenderer.invoke('github:test'),
  getLanguage: () => ipcRenderer.invoke('app:get-language'),
  setLanguage: (language) => ipcRenderer.invoke('app:set-language', language),
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  getWorkspace: (id) => ipcRenderer.invoke('workspace:get', id),
  createWorkspace: (input) => ipcRenderer.invoke('workspace:create', input),
  updateWorkspace: (id, input) => ipcRenderer.invoke('workspace:update', id, input),
  deleteWorkspace: (id) => ipcRenderer.invoke('workspace:delete', id),
  duplicateWorkspace: (id) => ipcRenderer.invoke('workspace:duplicate', id),
  addItem: (id, input) => ipcRenderer.invoke('item:add', id, input),
  updateItem: (id, itemId, input) => ipcRenderer.invoke('item:update', id, itemId, input),
  removeItem: (id, itemId) => ipcRenderer.invoke('item:remove', id, itemId),
  reorderItems: (id, ids) => ipcRenderer.invoke('item:reorder', id, ids),
  resumeWorkspace: (id) => ipcRenderer.invoke('workspace:resume', id),
  selectTarget: (type) => ipcRenderer.invoke('dialog:select-target', type),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
};
contextBridge.exposeInMainWorld('contextdock', Object.freeze(api));
