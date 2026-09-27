import type { ItemInput, WorkspaceItem } from './types';
export type ImportMode = 'replace' | 'duplicate' | 'cancel';
export interface ImportPreview {
  sessionId: string;
  id: string;
  name: string;
  description: string;
  duplicate: boolean;
  items: (WorkspaceItem & { included: boolean })[];
}
export interface ImportedWorkspace {
  id: string;
  name: string;
  description: string;
  items: (Required<ItemInput> & { unresolved: boolean })[];
}
export interface GitHubConnection {
  owner: string;
  repository: string;
  branch: string;
}
export interface GitHubStatus extends GitHubConnection {
  hasToken: boolean;
}
export interface RemoteWorkspace {
  path: string;
  name: string;
}
