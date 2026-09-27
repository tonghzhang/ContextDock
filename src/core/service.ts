import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ItemInput,
  Language,
  Launcher,
  LaunchReport,
  Workspace,
  WorkspaceInput,
  WorkspaceItem,
} from '../shared/types';
import { transaction } from './database';
import { WorkspaceError } from './errors';
import { itemInput, nameKey, text, workspaceInput } from './validation';

type WorkspaceRow = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
};
type ItemRow = {
  id: string;
  workspace_id: string;
  type: WorkspaceItem['type'];
  name: string;
  target: string;
  arguments_json: string;
  enabled: number;
  launch_order: number;
};

export class WorkspaceService {
  private readonly opening = new Set<string>();

  constructor(
    private readonly database: DatabaseSync,
    private readonly launcher: Launcher,
  ) {}

  getLanguage(): Language {
    const value = this.database
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('language')?.value;
    return value === 'en' || value === 'zh-CN' || value === 'ja' ? value : 'en';
  }

  setLanguage(language: Language): Language {
    if (language !== 'en' && language !== 'zh-CN' && language !== 'ja') {
      throw new WorkspaceError('Choose English, Simplified Chinese, or Japanese.');
    }
    return transaction(this.database, () => {
      this.database
        .prepare(
          'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run('language', language);
      return language;
    });
  }
  listWorkspaces(): Workspace[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM workspaces ORDER BY COALESCE(last_used_at, created_at) DESC, name_key ASC',
      )
      .all() as unknown as WorkspaceRow[];
    return rows.map((row) => this.workspaceFromRow(row));
  }

  getWorkspace(reference: string): Workspace {
    const key = text(reference, 'Workspace identifier', 200);
    const row = this.database
      .prepare(
        'SELECT * FROM workspaces WHERE id = ? OR name_key = ? ORDER BY (id = ?) DESC LIMIT 1',
      )
      .get(key, nameKey(key), key) as unknown as WorkspaceRow | undefined;
    if (!row) throw new WorkspaceError('Workspace not found.', 'NOT_FOUND');
    return this.workspaceFromRow(row);
  }

  createWorkspace(input: WorkspaceInput): Workspace {
    const value = workspaceInput(input);
    return transaction(this.database, () => {
      this.assertUniqueName(value.name);
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database
        .prepare(
          'INSERT INTO workspaces (id, name, name_key, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, value.name, nameKey(value.name), value.description, now, now);
      return this.getWorkspace(id);
    });
  }

  updateWorkspace(reference: string, input: WorkspaceInput): Workspace {
    const value = workspaceInput(input);
    return transaction(this.database, () => {
      const workspace = this.getWorkspace(reference);
      this.assertUniqueName(value.name, workspace.id);
      this.database
        .prepare(
          'UPDATE workspaces SET name = ?, name_key = ?, description = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          value.name,
          nameKey(value.name),
          input.description === undefined ? workspace.description : value.description,
          new Date().toISOString(),
          workspace.id,
        );
      return this.getWorkspace(workspace.id);
    });
  }

  deleteWorkspace(reference: string): void {
    transaction(this.database, () => {
      const workspace = this.getWorkspace(reference);
      if (this.opening.has(workspace.id))
        throw new WorkspaceError('Wait for this workspace to finish opening before deleting it.');
      this.database.prepare('DELETE FROM workspaces WHERE id = ?').run(workspace.id);
    });
  }

  duplicateWorkspace(reference: string): Workspace {
    return transaction(this.database, () => {
      const original = this.getWorkspace(reference);
      const base = original.name.slice(0, 180);
      let name = `${base} (copy)`;
      let suffix = 2;
      while (
        this.database.prepare('SELECT id FROM workspaces WHERE name_key = ?').get(nameKey(name))
      ) {
        name = `${base} (copy ${suffix})`;
        suffix += 1;
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      this.database
        .prepare(
          'INSERT INTO workspaces (id, name, name_key, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, name, nameKey(name), original.description, now, now);
      for (const item of original.items) this.insertItem(id, item);
      return this.getWorkspace(id);
    });
  }

  addItem(reference: string, input: ItemInput): WorkspaceItem {
    const value = itemInput(input);
    return transaction(this.database, () => {
      const workspace = this.getWorkspace(reference);
      const position =
        input.launchOrder === undefined
          ? workspace.items.length
          : Math.min(value.launchOrder, workspace.items.length);
      const item = this.insertItem(workspace.id, { ...value, launchOrder: position });
      const ids = workspace.items.map((entry) => entry.id);
      ids.splice(position, 0, item.id);
      this.writeOrder(workspace.id, ids);
      this.touch(workspace.id);
      return this.getItem(workspace.id, item.id);
    });
  }

  updateItem(reference: string, itemId: string, input: ItemInput): WorkspaceItem {
    return transaction(this.database, () => {
      const workspace = this.getWorkspace(reference);
      const existing = this.getItem(workspace.id, itemId);
      const value = itemInput(input, existing);
      this.database
        .prepare(
          'UPDATE workspace_items SET type = ?, name = ?, target = ?, arguments_json = ?, enabled = ? WHERE workspace_id = ? AND id = ?',
        )
        .run(
          value.type,
          value.name,
          value.target,
          JSON.stringify(value.arguments),
          value.enabled ? 1 : 0,
          workspace.id,
          existing.id,
        );
      const ids = workspace.items
        .filter((entry) => entry.id !== existing.id)
        .map((entry) => entry.id);
      ids.splice(Math.min(value.launchOrder, ids.length), 0, existing.id);
      this.writeOrder(workspace.id, ids);
      this.touch(workspace.id);
      return this.getItem(workspace.id, existing.id);
    });
  }

  removeItem(reference: string, itemId: string): void {
    transaction(this.database, () => {
      const workspace = this.getWorkspace(reference);
      const existing = this.getItem(workspace.id, itemId);
      this.database
        .prepare('DELETE FROM workspace_items WHERE workspace_id = ? AND id = ?')
        .run(workspace.id, existing.id);
      this.writeOrder(
        workspace.id,
        workspace.items.filter((item) => item.id !== existing.id).map((item) => item.id),
      );
      this.touch(workspace.id);
    });
  }

  reorderItems(reference: string, itemIds: string[]): Workspace {
    if (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== 'string')) {
      throw new WorkspaceError('Item order must be an array of item identifiers.');
    }
    return transaction(this.database, () => {
      const workspace = this.getWorkspace(reference);
      const expected = new Set(workspace.items.map((item) => item.id));
      if (
        itemIds.length !== expected.size ||
        new Set(itemIds).size !== expected.size ||
        itemIds.some((id) => !expected.has(id))
      ) {
        throw new WorkspaceError('Item order must include every workspace item exactly once.');
      }
      this.writeOrder(workspace.id, itemIds);
      this.touch(workspace.id);
      return this.getWorkspace(workspace.id);
    });
  }

  async resumeWorkspace(reference: string): Promise<LaunchReport> {
    const workspace = this.getWorkspace(reference);
    if (this.opening.has(workspace.id))
      throw new WorkspaceError('This workspace is already opening.');
    this.opening.add(workspace.id);
    const startedAt = new Date().toISOString();
    const report: LaunchReport = {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      startedAt,
      finishedAt: startedAt,
      skipped: workspace.items.filter((item) => !item.enabled).length,
      results: [],
    };
    try {
      this.database
        .prepare('UPDATE workspaces SET last_used_at = ?, updated_at = ? WHERE id = ?')
        .run(startedAt, startedAt, workspace.id);
      for (const item of workspace.items) {
        if (!item.enabled) continue;
        const result = { itemId: item.id, name: item.name, target: item.target, type: item.type };
        try {
          // Validate persisted values too; every entry point shares this boundary.
          itemInput(item);
          await this.launcher.launch(item);
          report.results.push({ ...result, status: 'success' });
        } catch (error) {
          report.results.push({
            ...result,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unable to open this item.',
          });
        }
      }
      report.finishedAt = new Date().toISOString();
      return report;
    } finally {
      this.opening.delete(workspace.id);
    }
  }

  private assertUniqueName(name: string, exceptId?: string): void {
    const row = this.database
      .prepare('SELECT id FROM workspaces WHERE name_key = ?')
      .get(nameKey(name));
    if (row && row.id !== exceptId)
      throw new WorkspaceError(
        'A workspace with this name already exists. Choose a different name.',
        'DUPLICATE',
      );
  }

  private workspaceFromRow(row: WorkspaceRow): Workspace {
    const items = this.database
      .prepare(
        'SELECT * FROM workspace_items WHERE workspace_id = ? ORDER BY launch_order ASC, id ASC',
      )
      .all(row.id) as unknown as ItemRow[];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at,
      items: items.map((item) => this.itemFromRow(item)),
    };
  }

  private itemFromRow(row: ItemRow): WorkspaceItem {
    let args: unknown;
    try {
      args = JSON.parse(row.arguments_json);
    } catch {
      throw new WorkspaceError('This item has invalid saved arguments.', 'STORAGE');
    }
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))
      throw new WorkspaceError('This item has invalid saved arguments.', 'STORAGE');
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      type: row.type,
      name: row.name,
      target: row.target,
      arguments: args as string[],
      enabled: row.enabled === 1,
      launchOrder: row.launch_order,
    };
  }

  private getItem(workspaceId: string, itemId: string): WorkspaceItem {
    const id = text(itemId, 'Item identifier', 100);
    const row = this.database
      .prepare('SELECT * FROM workspace_items WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, id) as unknown as ItemRow | undefined;
    if (!row) throw new WorkspaceError('Item not found in this workspace.', 'NOT_FOUND');
    return this.itemFromRow(row);
  }

  private insertItem(workspaceId: string, value: Required<ItemInput>): WorkspaceItem {
    const id = randomUUID();
    this.database
      .prepare(
        'INSERT INTO workspace_items (id, workspace_id, type, name, target, arguments_json, enabled, launch_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        workspaceId,
        value.type,
        value.name,
        value.target,
        JSON.stringify(value.arguments),
        value.enabled ? 1 : 0,
        value.launchOrder,
      );
    return { ...value, id, workspaceId, arguments: [...value.arguments] };
  }

  private writeOrder(workspaceId: string, ids: string[]): void {
    const statement = this.database.prepare(
      'UPDATE workspace_items SET launch_order = ? WHERE workspace_id = ? AND id = ?',
    );
    ids.forEach((id, index) => statement.run(index, workspaceId, id));
  }

  private touch(workspaceId: string): void {
    this.database
      .prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), workspaceId);
  }
}
