import type {
  GitHubConnection,
  GitHubStatus,
  ImportMode,
  ImportPreview,
  RemoteWorkspace,
} from './transfer';
export type Language = 'en' | 'zh-CN' | 'ja';
export type ItemType = 'application' | 'file' | 'folder' | 'url';
export interface WorkspaceItem {
  id: string;
  workspaceId: string;
  unresolved?: boolean;
  type: ItemType;
  name: string;
  target: string;
  arguments: string[];
  enabled: boolean;
  launchOrder: number;
}
export interface Workspace {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  items: WorkspaceItem[];
}
export interface WorkspaceInput {
  name: string;
  description?: string;
}
export interface ItemInput {
  type: ItemType;
  name: string;
  target: string;
  arguments?: string[];
  enabled?: boolean;
  launchOrder?: number;
}
export interface LaunchResult {
  itemId: string;
  name: string;
  target: string;
  type: ItemType;
  status: 'success' | 'failed';
  error?: string;
}
export interface LaunchReport {
  workspaceId: string;
  workspaceName: string;
  startedAt: string;
  finishedAt: string;
  skipped: number;
  results: LaunchResult[];
}
export interface Launcher {
  launch(item: WorkspaceItem): Promise<void>;
}
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
export interface AppInfo {
  version: string;
  dataDirectory: string;
  shortcut: string;
  shortcutRegistered: boolean;
}
export interface DesktopApi {
  exportWorkspace(
    id: string,
    fileIds: string[],
    destination: 'local' | 'github',
  ): Promise<ApiResult<boolean>>;
  importLocal(): Promise<ApiResult<ImportPreview | null>>;
  listRemote(): Promise<ApiResult<RemoteWorkspace[]>>;
  importRemote(path: string): Promise<ApiResult<ImportPreview>>;
  locateImport(sessionId: string, itemId: string): Promise<ApiResult<ImportPreview>>;
  commitImport(sessionId: string, mode: ImportMode): Promise<ApiResult<Workspace | null>>;
  cancelImport(sessionId: string): Promise<ApiResult<void>>;
  locateItem(workspaceId: string, itemId: string): Promise<ApiResult<WorkspaceItem | null>>;
  getGitHubConnection(): Promise<ApiResult<GitHubStatus>>;
  saveGitHubConnection(config: GitHubConnection): Promise<ApiResult<GitHubStatus>>;
  setGitHubToken(): Promise<ApiResult<GitHubStatus>>;
  testGitHubConnection(): Promise<ApiResult<void>>;
  getLanguage(): Promise<ApiResult<Language>>;
  setLanguage(language: Language): Promise<ApiResult<Language>>;
  listWorkspaces(): Promise<ApiResult<Workspace[]>>;
  getWorkspace(id: string): Promise<ApiResult<Workspace>>;
  createWorkspace(input: WorkspaceInput): Promise<ApiResult<Workspace>>;
  updateWorkspace(id: string, input: WorkspaceInput): Promise<ApiResult<Workspace>>;
  deleteWorkspace(id: string): Promise<ApiResult<void>>;
  duplicateWorkspace(id: string): Promise<ApiResult<Workspace>>;
  addItem(workspaceId: string, input: ItemInput): Promise<ApiResult<WorkspaceItem>>;
  updateItem(
    workspaceId: string,
    itemId: string,
    input: ItemInput,
  ): Promise<ApiResult<WorkspaceItem>>;
  removeItem(workspaceId: string, itemId: string): Promise<ApiResult<void>>;
  reorderItems(workspaceId: string, itemIds: string[]): Promise<ApiResult<Workspace>>;
  resumeWorkspace(id: string): Promise<ApiResult<LaunchReport>>;
  selectTarget(type: 'application' | 'file' | 'folder'): Promise<ApiResult<string | null>>;
  getAppInfo(): Promise<ApiResult<AppInfo>>;
}
