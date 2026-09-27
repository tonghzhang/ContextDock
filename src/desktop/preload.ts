import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/types';
const api: DesktopApi = {
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
