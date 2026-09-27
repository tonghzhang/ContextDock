import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { WorkspaceService } from '../core/service';
import { readLocalArchive } from './local-provider';
import { itemInput } from '../core/validation';
import type { Workspace, WorkspaceItem } from '../shared/types';
import type { ImportMode, ImportPreview } from '../shared/transfer';
import { buildArchive, MAX_ARCHIVE_BYTES, readArchive } from './archive';
import { safeAttachmentPath, safeFileName, type Manifest } from './manifest';

async function exists(item: Pick<WorkspaceItem, 'type' | 'target'>): Promise<boolean> {
  if (item.type === 'url') return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      stat(item.target),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Path check timed out.')), 3000);
      }),
    ]);
    return item.type === 'folder' ? info.isDirectory() : info.isFile();
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
interface Session {
  directory: string;
  preview: ImportPreview;
  originalEnabled: Map<string, boolean>;
}
export class WorkspaceTransferService {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly dataDirectory: string,
  ) {}
  async export(workspaceId: string, selectedFileIds: string[]): Promise<Uint8Array> {
    if (!Array.isArray(selectedFileIds) || selectedFileIds.some((id) => typeof id !== 'string'))
      throw new Error('Choose files to include.');
    const workspace = this.workspaces.getWorkspace(workspaceId);
    if (
      selectedFileIds.some(
        (id) => !workspace.items.some((item) => item.id === id && item.type === 'file'),
      )
    )
      throw new Error('Only file items can be included.');
    const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
    let size = 0;
    const manifest: Manifest = {
      format: 'contextdock-workspace',
      version: 1,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        items: [],
      },
    };
    for (const item of workspace.items) {
      let location: Manifest['workspace']['items'][number]['location'] =
        item.type === 'url'
          ? { kind: 'url', url: item.target }
          : { kind: 'local', path: item.target };
      if (selectedFileIds.includes(item.id)) {
        if (!(await exists(item))) throw new Error('A selected attachment is unavailable.');
        const info = await stat(item.target);
        size += info.size;
        if (size > MAX_ARCHIVE_BYTES) throw new Error('Workspace package exceeds the size limit.');
        const fileName = safeFileName(basename(item.target));
        const path = 'files/' + manifest.workspace.items.length + '-' + fileName;
        if (!safeAttachmentPath(path)) throw new Error('Invalid attachment path.');
        files[path] = await readLocalArchive(item.target);
        size += files[path].length - info.size;
        if (size > MAX_ARCHIVE_BYTES) throw new Error('Workspace package exceeds the size limit.');
        location = { kind: 'attachment', path };
      }
      manifest.workspace.items.push({
        id: item.id,
        type: item.type,
        name: item.name,
        enabled: item.enabled,
        launchOrder: item.launchOrder,
        arguments: [...item.arguments],
        location,
      });
    }
    return buildArchive(manifest, files);
  }
  async prepare(data: Uint8Array): Promise<ImportPreview> {
    // One preview at a time: staging never becomes a second workspace database.
    await this.cancelAll();
    const { manifest, files } = readArchive(data);
    const root = join(this.dataDirectory, 'transfer-temp');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'import-'));
    try {
      await mkdir(join(directory, 'files'));
      for (const [name, content] of Object.entries(files))
        await writeFile(join(directory, name), content, { flag: 'wx' });
      const items: ImportPreview['items'] = [];
      const originalEnabled = new Map<string, boolean>();
      for (const entry of manifest.workspace.items) {
        const loc = entry.location;
        const target =
          loc.kind === 'url'
            ? loc.url
            : loc.kind === 'local'
              ? loc.path
              : join(directory, loc.path);
        const input = itemInput({ ...entry, target });
        const unresolved = !(await exists(input));
        items.push({
          ...input,
          id: entry.id,
          workspaceId: manifest.workspace.id,
          unresolved,
          enabled: unresolved ? false : entry.enabled,
          included: loc.kind === 'attachment',
        });
        originalEnabled.set(entry.id, entry.enabled);
      }
      const preview: ImportPreview = {
        sessionId: randomUUID(),
        id: manifest.workspace.id,
        name: manifest.workspace.name,
        description: manifest.workspace.description,
        duplicate: this.workspaces.hasWorkspaceId(manifest.workspace.id),
        items,
      };
      this.sessions.set(preview.sessionId, { directory, preview, originalEnabled });
      return structuredClone(preview);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  preview(id: string): ImportPreview {
    return structuredClone(this.session(id).preview);
  }
  async locate(sessionId: string, itemId: string, target: string): Promise<ImportPreview> {
    const session = this.session(sessionId);
    const item = session.preview.items.find((item) => item.id === itemId);
    if (!item || !item.unresolved || item.type === 'url')
      throw new Error('Choose an unresolved item.');
    const validated = itemInput({ ...item, target });
    if (!(await exists(validated))) throw new Error('The selected path is unavailable.');
    Object.assign(item, validated, {
      unresolved: false,
      enabled: session.originalEnabled.get(item.id) ?? false,
    });
    return structuredClone(session.preview);
  }
  async locateSaved(workspaceId: string, itemId: string, target: string): Promise<WorkspaceItem> {
    const item = this.workspaces.getWorkspace(workspaceId).items.find((item) => item.id === itemId);
    if (!item || !item.unresolved || item.type === 'url')
      throw new Error('Choose an unresolved item.');
    const value = itemInput({ ...item, target });
    if (!(await exists(value))) throw new Error('The selected path is unavailable.');
    return this.workspaces.resolveItem(workspaceId, itemId, value.target);
  }
  async commit(sessionId: string, mode: ImportMode): Promise<Workspace | null> {
    const session = this.session(sessionId);
    if (!['replace', 'duplicate', 'cancel'].includes(mode))
      throw new Error('Choose replace, duplicate, or cancel.');
    if (mode === 'cancel') {
      await this.cancel(sessionId);
      return null;
    }
    const managed = join(this.dataDirectory, 'attachments', randomUUID());
    let committed = false;
    try {
      const items = [];
      for (const item of session.preview.items) {
        let target = item.target;
        if (item.included) {
          await mkdir(managed, { recursive: true });
          target = join(managed, basename(item.target));
          await copyFile(item.target, target);
        }
        const unresolved = !(await exists({ ...item, target }));
        items.push({ ...item, target, unresolved, enabled: unresolved ? false : item.enabled });
      }
      const result = this.workspaces.importWorkspace({ ...session.preview, items }, mode);
      committed = true;
      // A staging cleanup failure must not report that a committed import failed.
      await this.cancel(sessionId).catch(() => {});
      return result;
    } finally {
      if (!committed) await rm(managed, { recursive: true, force: true });
    }
  }
  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await rm(session.directory, { recursive: true, force: true });
    this.sessions.delete(sessionId);
  }
  async cancelAll(): Promise<void> {
    for (const id of this.sessions.keys()) await this.cancel(id);
  }
  private session(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Import preview expired. Choose the package again.');
    return session;
  }
}
