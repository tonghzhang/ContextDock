import type { ApiResult, DesktopApi, ItemType, Workspace, WorkspaceItem } from '../shared/types';

export function desktop(): DesktopApi {
  if (!window.contextdock) throw new Error('Open the desktop app to manage your workspaces.');
  return window.contextdock;
}

export async function resultOf<T>(request: Promise<ApiResult<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The action could not be completed. Try again.';
}

export const typeNames: Record<ItemType, string> = {
  application: 'Application',
  file: 'File',
  folder: 'Folder',
  url: 'URL',
};

export function itemSummary(items: WorkspaceItem[]): string {
  if (items.length === 0) return 'No items yet';
  const names: Record<ItemType, [string, string]> = {
    application: ['app', 'apps'],
    file: ['file', 'files'],
    folder: ['folder', 'folders'],
    url: ['website', 'websites'],
  };
  return (['application', 'url', 'folder', 'file'] as const)
    .map((type) => {
      const count = items.filter((item) => item.type === type).length;
      return count ? `${count} ${names[type][count === 1 ? 0 : 1]}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

export function relativeDate(iso: string | null): string {
  if (!iso) return 'Not resumed yet';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'Used just now';
  if (minutes < 60) return `Used ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Used ${hours}h ago`;
  if (hours < 48) return 'Used yesterday';
  const days = Math.floor(hours / 24);
  if (days < 30) return `Used ${days}d ago`;
  return `Used ${new Date(iso).toLocaleDateString()}`;
}

export function workspaceMatches(workspace: Workspace, query: string): boolean {
  const text = query.trim().toLocaleLowerCase();
  return !text || `${workspace.name} ${workspace.description}`.toLocaleLowerCase().includes(text);
}
