import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock3,
  Copy,
  Keyboard,
  Layers3,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppInfo, LaunchReport, Workspace, WorkspaceItem } from '../shared/types';
import {
  desktop,
  errorText,
  itemSummary,
  relativeDate,
  resultOf,
  typeNames,
  workspaceMatches,
} from './api';
import {
  ConfirmDialog,
  ItemDialog,
  ItemIcon,
  Logo,
  ReportDialog,
  SettingsDialog,
  Spinner,
  WorkspaceDialog,
} from './dialogs';

type DialogState =
  | { kind: 'workspace'; workspace?: Workspace }
  | { kind: 'item'; workspaceId: string; item?: WorkspaceItem }
  | { kind: 'delete-workspace'; workspace: Workspace }
  | { kind: 'delete-item'; workspaceId: string; item: WorkspaceItem }
  | { kind: 'report'; report: LaunchReport }
  | { kind: 'settings' }
  | null;

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadSequence = useRef(0);
  const operationRunning = useRef(false);
  const available = Boolean(window.contextdock);

  const refresh = useCallback(async (preferredId?: string) => {
    const sequence = ++loadSequence.current;
    try {
      const loaded = await resultOf(desktop().listWorkspaces());
      if (sequence !== loadSequence.current) return;
      setWorkspaces(loaded);
      setSelectedId((previous) => {
        if (preferredId && loaded.some((workspace) => workspace.id === preferredId))
          return preferredId;
        if (previous && loaded.some((workspace) => workspace.id === previous)) return previous;
        return loaded[0]?.id ?? null;
      });
    } catch (caught) {
      if (sequence === loadSequence.current) setError(errorText(caught));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    void refresh();
    void resultOf(desktop().getAppInfo())
      .then(setInfo)
      .catch((caught: unknown) => setError(errorText(caught)));
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      loadSequence.current += 1;
    };
  }, [available, refresh]);

  const filtered = useMemo(
    () => workspaces.filter((workspace) => workspaceMatches(workspace, query)),
    [workspaces, query],
  );
  const selected = filtered.find((workspace) => workspace.id === selectedId) ?? filtered[0];
  const busy = actionBusy || runningId !== null;

  const resume = useCallback(
    async (workspace: Workspace) => {
      if (operationRunning.current) return;
      operationRunning.current = true;
      setRunningId(workspace.id);
      setError('');
      setAnnouncement(`Opening ${workspace.name}.`);
      try {
        const report = await resultOf(desktop().resumeWorkspace(workspace.id));
        await refresh(workspace.id);
        setDialog({ kind: 'report', report });
        setAnnouncement(`Finished opening ${workspace.name}.`);
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        operationRunning.current = false;
        setRunningId(null);
      }
    },
    [refresh],
  );

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (dialog || !available) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (
        event.key === '/' &&
        !typing &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [available, dialog]);

  function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      const current = Math.max(
        0,
        filtered.findIndex((workspace) => workspace.id === selected?.id),
      );
      const next =
        (current + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
      setSelectedId(filtered[next].id);
      document
        .getElementById(`workspace-${filtered[next].id}`)
        ?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && selected) {
      event.preventDefault();
      void resume(selected);
    } else if (event.key === 'Escape') {
      setQuery('');
    }
  }

  async function mutate(action: () => Promise<unknown>, message: string, preferredId?: string) {
    if (operationRunning.current) return;
    operationRunning.current = true;
    setActionBusy(true);
    setError('');
    try {
      await action();
      await refresh(preferredId);
      setAnnouncement(message);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      operationRunning.current = false;
      setActionBusy(false);
    }
  }

  async function duplicate(workspace: Workspace) {
    await mutate(async () => {
      const copy = await resultOf(desktop().duplicateWorkspace(workspace.id));
      setQuery('');
      setSelectedId(copy.id);
    }, 'Workspace duplicated.');
  }

  function moveItem(workspace: Workspace, item: WorkspaceItem, direction: -1 | 1) {
    const items = [...workspace.items].sort((left, right) => left.launchOrder - right.launchOrder);
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const next = index + direction;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]];
    void mutate(
      () =>
        resultOf(
          desktop().reorderItems(
            workspace.id,
            items.map((candidate) => candidate.id),
          ),
        ),
      'Launch order updated.',
      workspace.id,
    );
  }

  if (!available) {
    return (
      <main className="desktop-required">
        <Logo large />
        <h1>ContextDock lives on your desktop.</h1>
        <p>
          Open the installed app to save your apps, files, folders, and websites in a workspace.
        </p>
        <p className="muted">Your workspaces stay on your computer.</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <Logo />
          <span>ContextDock</span>
        </div>
        <div className="sidebar-section-label">Your space</div>
        <button
          className="nav-button active"
          onClick={() => {
            setQuery('');
            searchRef.current?.focus();
          }}
          aria-current="page"
          title="All workspaces"
        >
          <Layers3 size={18} aria-hidden="true" />
          <span>Workspaces</span>
          <span className="nav-count">{workspaces.length}</span>
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-dot" />
            Stored on this computer
          </div>
          <button
            className="nav-button settings-button"
            onClick={() => setDialog({ kind: 'settings' })}
            disabled={busy}
            title="About and shortcuts"
          >
            <Settings2 size={17} aria-hidden="true" />
            <span>About & shortcuts</span>
          </button>
          <span className="version">{info ? `v${info.version}` : 'ContextDock'}</span>
        </div>
      </aside>
      <main className="main-content">
        <header className="app-header">
          <div>
            <h1>Workspaces</h1>
            <p>Everything you need, ready when you are.</p>
          </div>
          <button
            className="button button-secondary new-workspace-button"
            onClick={() => setDialog({ kind: 'workspace' })}
            disabled={busy}
          >
            <Plus size={16} aria-hidden="true" />
            New workspace
          </button>
        </header>
        {error && (
          <div className="global-error" role="alert">
            <span>{error}</span>
            <button
              className="text-button"
              onClick={() => {
                setError('');
                void refresh();
              }}
            >
              Reload
            </button>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="workspace-layout">
          <section className="library" aria-label="Workspace library">
            <div className="search-wrap">
              <Search size={17} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                aria-label="Search workspaces"
                placeholder="Search workspaces…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={searchKeys}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="search-hint"
              />
              {query ? (
                <button
                  className="icon-button clear-search"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : (
                <kbd className="search-key">Ctrl K</kbd>
              )}
            </div>
            <div className="library-heading">
              <span>{query.trim() ? 'Search results' : 'All workspaces'}</span>
              <span>{filtered.length}</span>
            </div>
            <div className="workspace-list-scroll">
              {loading ? (
                <div className="library-empty" role="status">
                  <Spinner />
                  <p>Loading workspaces…</p>
                </div>
              ) : filtered.length > 0 ? (
                <ul className="workspace-list" aria-label="Workspaces">
                  {filtered.map((workspace) => (
                    <li
                      id={`workspace-${workspace.id}`}
                      key={workspace.id}
                      className={`workspace-card${selected?.id === workspace.id ? ' selected' : ''}`}
                    >
                      <button
                        className="workspace-select"
                        aria-label={`Open details for ${workspace.name}`}
                        aria-pressed={selected?.id === workspace.id}
                        onClick={() => setSelectedId(workspace.id)}
                      >
                        <span className="workspace-glyph">
                          <Layers3 size={19} strokeWidth={1.6} aria-hidden="true" />
                        </span>
                        <span className="workspace-card-content">
                          <strong title={workspace.name}>{workspace.name}</strong>
                          <span className="workspace-summary">{itemSummary(workspace.items)}</span>
                          <span
                            className="workspace-last-used"
                            title={
                              workspace.lastUsedAt
                                ? new Date(workspace.lastUsedAt).toLocaleString()
                                : undefined
                            }
                          >
                            {relativeDate(workspace.lastUsedAt)}
                          </span>
                        </span>
                      </button>
                      <button
                        className="quick-resume"
                        aria-label={`Resume ${workspace.name}`}
                        title={`Resume ${workspace.name}`}
                        onClick={() => void resume(workspace)}
                        disabled={busy || workspace.items.every((item) => !item.enabled)}
                      >
                        {runningId === workspace.id ? (
                          <Spinner />
                        ) : (
                          <Play
                            size={15}
                            fill="currentColor"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="library-empty">
                  <Search size={22} strokeWidth={1.5} aria-hidden="true" />
                  <p>
                    {query.trim() ? 'No matching workspaces' : 'Your workspaces will appear here'}
                  </p>
                  {query.trim() && (
                    <button className="text-button" onClick={() => setQuery('')}>
                      Clear search
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="search-hint" id="search-hint">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> select
              </span>
              <span>
                <kbd>Enter</kbd> resume
              </span>
            </div>
          </section>
          {selected ? (
            <WorkspaceDetail
              workspace={selected}
              running={runningId === selected.id}
              busy={busy}
              onResume={() => void resume(selected)}
              onEdit={() => setDialog({ kind: 'workspace', workspace: selected })}
              onDuplicate={() => void duplicate(selected)}
              onDelete={() => setDialog({ kind: 'delete-workspace', workspace: selected })}
              onAdd={() => setDialog({ kind: 'item', workspaceId: selected.id })}
              onEditItem={(item) => setDialog({ kind: 'item', workspaceId: selected.id, item })}
              onRemoveItem={(item) =>
                setDialog({ kind: 'delete-item', workspaceId: selected.id, item })
              }
              onToggleItem={(item) =>
                void mutate(
                  () =>
                    resultOf(
                      desktop().updateItem(selected.id, item.id, {
                        type: item.type,
                        name: item.name,
                        target: item.target,
                        arguments: item.arguments,
                        enabled: !item.enabled,
                      }),
                    ),
                  `${item.name} ${item.enabled ? 'disabled' : 'enabled'}.`,
                  selected.id,
                )
              }
              onMoveItem={(item, direction) => moveItem(selected, item, direction)}
            />
          ) : (
            <section className="welcome-panel">
              <div className="welcome-content">
                <Logo large />
                <span className="eyebrow">A place to pick up again</span>
                <h2>{query.trim() ? 'Find your next workspace.' : 'Make room for your work.'}</h2>
                <p>
                  {query.trim()
                    ? 'Try another name, or clear your search to see all workspaces.'
                    : 'Bring your apps, files, folders, and websites together. Open them all with one click.'}
                </p>
                {query.trim() ? (
                  <button className="button button-secondary" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                ) : (
                  <button
                    className="button button-primary"
                    onClick={() => setDialog({ kind: 'workspace' })}
                    disabled={busy || loading}
                  >
                    <Plus size={17} aria-hidden="true" />
                    Create your first workspace
                  </button>
                )}
                <div className="welcome-footnote">
                  <Keyboard size={15} aria-hidden="true" />
                  <span>
                    <kbd>Ctrl</kbd> + <kbd>K</kbd> to find a workspace
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {dialog?.kind === 'workspace' && (
        <WorkspaceDialog
          workspace={dialog.workspace}
          onClose={() => setDialog(null)}
          onSaved={async (workspace) => {
            setQuery('');
            await refresh(workspace.id);
            setDialog(null);
            setAnnouncement('Workspace saved.');
          }}
        />
      )}
      {dialog?.kind === 'item' && (
        <ItemDialog
          workspaceId={dialog.workspaceId}
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            await refresh(dialog.workspaceId);
            setDialog(null);
            setAnnouncement('Item saved.');
          }}
        />
      )}
      {dialog?.kind === 'delete-workspace' && (
        <ConfirmDialog
          title={`Delete “${dialog.workspace.name}”?`}
          description="This removes the workspace and its saved items. Your files, folders, and applications stay on your computer."
          action="Delete workspace"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await resultOf(desktop().deleteWorkspace(dialog.workspace.id));
            await refresh();
            setDialog(null);
            setAnnouncement('Workspace deleted.');
          }}
        />
      )}
      {dialog?.kind === 'delete-item' && (
        <ConfirmDialog
          title={`Remove “${dialog.item.name}”?`}
          description="This removes the item from this workspace. The original resource stays where it is."
          action="Remove item"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await resultOf(desktop().removeItem(dialog.workspaceId, dialog.item.id));
            await refresh(dialog.workspaceId);
            setDialog(null);
            setAnnouncement('Item removed.');
          }}
        />
      )}
      {dialog?.kind === 'report' && (
        <ReportDialog report={dialog.report} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'settings' && (
        <SettingsDialog info={info} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function WorkspaceDetail({
  workspace,
  busy,
  running,
  onResume,
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
  onEditItem,
  onRemoveItem,
  onToggleItem,
  onMoveItem,
}: {
  workspace: Workspace;
  busy: boolean;
  running: boolean;
  onResume: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAdd: () => void;
  onEditItem: (item: WorkspaceItem) => void;
  onRemoveItem: (item: WorkspaceItem) => void;
  onToggleItem: (item: WorkspaceItem) => void;
  onMoveItem: (item: WorkspaceItem, direction: -1 | 1) => void;
}) {
  const items = [...workspace.items].sort((left, right) => left.launchOrder - right.launchOrder);
  const enabled = items.filter((item) => item.enabled).length;
  return (
    <section
      className="detail-panel"
      aria-label={`${workspace.name} workspace`}
      aria-busy={running}
    >
      <div className="detail-scroll">
        <div className="detail-topline">
          <span className="eyebrow">Workspace</span>
          <div className="workspace-actions">
            <button
              className="icon-button"
              aria-label="Edit workspace"
              title="Edit workspace"
              onClick={onEdit}
              disabled={busy}
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              aria-label="Duplicate workspace"
              title="Duplicate workspace"
              onClick={onDuplicate}
              disabled={busy}
            >
              <Copy size={16} aria-hidden="true" />
            </button>
            <span className="action-divider" />
            <button
              className="icon-button danger-icon"
              aria-label="Delete workspace"
              title="Delete workspace"
              onClick={onDelete}
              disabled={busy}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="detail-title">
          <span className="detail-glyph">
            <Layers3 size={29} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2>{workspace.name}</h2>
        </div>
        {workspace.description && <p className="workspace-description">{workspace.description}</p>}
        <div className="detail-meta">
          <Clock3 size={13} aria-hidden="true" />
          <span
            title={
              workspace.lastUsedAt ? new Date(workspace.lastUsedAt).toLocaleString() : undefined
            }
          >
            {relativeDate(workspace.lastUsedAt)}
          </span>
          <span className="meta-dot">·</span>
          <span>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className="launch-bar">
          <div>
            <span className="launch-ready-dot" />
            <span>
              {enabled === 0
                ? 'Add or enable an item to resume'
                : `${enabled} ${enabled === 1 ? 'item' : 'items'} ready to open`}
            </span>
          </div>
          <button
            className="button button-primary resume-button"
            onClick={onResume}
            disabled={busy || enabled === 0}
          >
            {running ? <Spinner /> : <Play size={14} fill="currentColor" aria-hidden="true" />}
            {running ? 'Opening…' : 'Resume workspace'}
          </button>
        </div>
        <div className="items-heading">
          <h3>Items</h3>
          <span>Opens from top to bottom</span>
        </div>
        {items.length > 0 ? (
          <ol className="item-list" aria-label="Workspace items in launch order">
            {items.map((item, index) => (
              <li className={`item-row${item.enabled ? '' : ' item-disabled'}`} key={item.id}>
                <span className="item-order" aria-label={`Launch order ${index + 1}`}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className={`item-type-icon type-${item.type}`} title={typeNames[item.type]}>
                  <ItemIcon type={item.type} />
                </span>
                <div className="item-content">
                  <div className="item-name">
                    <strong title={item.name}>{item.name}</strong>
                    {!item.enabled && <span className="disabled-badge">Disabled</span>}
                  </div>
                  <p className="item-target path-value" title={item.target}>
                    {item.target}
                  </p>
                  {item.type === 'application' && item.arguments.length > 0 && (
                    <p className="item-arguments path-value" title={item.arguments.join(' · ')}>
                      <span>Args</span> {item.arguments.join(' · ')}
                    </p>
                  )}
                </div>
                <div className="item-actions">
                  <button
                    className={`enable-toggle${item.enabled ? ' enabled' : ''}`}
                    role="switch"
                    aria-checked={item.enabled}
                    aria-label={`Enable ${item.name}`}
                    title={item.enabled ? 'Disable item' : 'Enable item'}
                    onClick={() => onToggleItem(item)}
                    disabled={busy}
                  >
                    <span>
                      {item.enabled && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                    </span>
                  </button>
                  <div className="item-tool-buttons">
                    <button
                      className="icon-button"
                      aria-label={`Move ${item.name} up`}
                      title="Move up"
                      onClick={() => onMoveItem(item, -1)}
                      disabled={busy || index === 0}
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Move ${item.name} down`}
                      title="Move down"
                      onClick={() => onMoveItem(item, 1)}
                      disabled={busy || index === items.length - 1}
                    >
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Edit ${item.name}`}
                      title="Edit item"
                      onClick={() => onEditItem(item)}
                      disabled={busy}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button danger-icon"
                      aria-label={`Remove ${item.name}`}
                      title="Remove item"
                      onClick={() => onRemoveItem(item)}
                      disabled={busy}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-items">
            <span className="empty-items-icon">
              <Plus size={22} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <h4>What belongs in this workspace?</h4>
            <p>
              Add an app, a file, a folder, or a website.
              <br />
              ContextDock will remember the way back.
            </p>
          </div>
        )}
        <button className="add-item-button" onClick={onAdd} disabled={busy}>
          <Plus size={17} aria-hidden="true" />
          Add item
        </button>
      </div>
      <footer className="detail-footer">
        <span>Save your workspace. Resume it in one click.</span>
        <span className="footer-mark">
          <Layers3 size={13} aria-hidden="true" />
        </span>
      </footer>
    </section>
  );
}
