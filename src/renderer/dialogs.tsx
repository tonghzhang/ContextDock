import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  File,
  Folder,
  Globe2,
  Layers3,
  LoaderCircle,
  Monitor,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AppInfo, ItemType, LaunchReport, Workspace, WorkspaceItem } from '../shared/types';
import { desktop, errorText, resultOf, typeNames } from './api';

export function ItemIcon({ type, size = 18 }: { type: ItemType; size?: number }) {
  const Icon = { application: Monitor, file: File, folder: Folder, url: Globe2 }[type];
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand-mark${large ? ' brand-mark-large' : ''}`} aria-hidden="true">
      <Layers3 size={large ? 30 : 21} strokeWidth={1.6} />
    </span>
  );
}

export function Spinner() {
  return <LoaderCircle className="spinner" size={16} aria-hidden="true" />;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <div className="form-error" role="alert">
      <AlertCircle size={17} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const subtitleId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog-wide' : ''}`}
      aria-labelledby={headingId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <h2 id={headingId}>{title}</h2>
          {subtitle && <p id={subtitleId}>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function WorkspaceDialog({
  workspace,
  onClose,
  onSaved,
}: {
  workspace?: Workspace;
  onClose: () => void;
  onSaved: (workspace: Workspace) => Promise<void>;
}) {
  const [name, setName] = useState(workspace?.name ?? '');
  const [description, setDescription] = useState(workspace?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useId();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const input = { name: name.trim(), description: description.trim() };
      const saved = await resultOf(
        workspace
          ? desktop().updateWorkspace(workspace.id, input)
          : desktop().createWorkspace(input),
      );
      await onSaved(saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={workspace ? 'Edit workspace' : 'New workspace'}
      subtitle="Give this collection of apps, files, and websites a home."
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="dialog-body form-stack">
          <div className="field">
            <label htmlFor={`${id}-name`}>Workspace name</label>
            <input
              id={`${id}-name`}
              data-autofocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Product website"
              maxLength={120}
              required
              disabled={busy}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-description`}>
              Description <span className="optional">Optional</span>
            </label>
            <textarea
              id={`${id}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What are you working on?"
              maxLength={2000}
              rows={3}
              disabled={busy}
            />
          </div>
          {error && <ErrorMessage>{error}</ErrorMessage>}
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={busy || !name.trim()}>
            {busy && <Spinner />}
            {workspace ? 'Save changes' : 'Create workspace'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ItemDialog({
  workspaceId,
  item,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  item?: WorkspaceItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [type, setType] = useState<ItemType>(item?.type ?? 'application');
  const [name, setName] = useState(item?.name ?? '');
  const [target, setTarget] = useState(item?.target ?? '');
  const [argumentText, setArgumentText] = useState(item?.arguments.join('\n') ?? '');
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const targetLabels: Record<ItemType, string> = {
    application: 'Application path',
    file: 'File path',
    folder: 'Folder path',
    url: 'Website address',
  };

  async function selectTarget() {
    if (type === 'url' || picking) return;
    setPicking(true);
    setError('');
    try {
      const path = await resultOf(desktop().selectTarget(type));
      if (path) {
        setTarget(path);
        const fileName = path.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
        setName((current) => (current.trim() ? current : fileName.replace(/\.exe$/i, '')));
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPicking(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || picking) return;
    setBusy(true);
    setError('');
    try {
      const input = {
        type,
        name: name.trim(),
        target: target.trim(),
        arguments:
          type === 'application' ? argumentText.split('\n').filter((line) => line.length > 0) : [],
        enabled,
      };
      await resultOf(
        item
          ? desktop().updateItem(workspaceId, item.id, input)
          : desktop().addItem(workspaceId, input),
      );
      await onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={item ? 'Edit item' : 'Add item'}
      subtitle="Choose what to open when you resume this workspace."
      onClose={onClose}
      busy={busy || picking}
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="dialog-body form-stack">
          <fieldset className="type-fieldset" disabled={busy || picking}>
            <legend>Item type</legend>
            <div className="type-options">
              {(['application', 'file', 'folder', 'url'] as const).map((value) => (
                <label className={`type-option${type === value ? ' active' : ''}`} key={value}>
                  <input
                    type="radio"
                    name={`${id}-type`}
                    value={value}
                    checked={type === value}
                    onChange={() => setType(value)}
                  />
                  <ItemIcon type={value} />
                  <span>{typeNames[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor={`${id}-target`}>{targetLabels[type]}</label>
            <div className="path-input">
              <input
                id={`${id}-target`}
                data-autofocus
                className={type === 'url' ? '' : 'path-value'}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                onBlur={() => {
                  if (type !== 'url' || name.trim() || !target.trim()) return;
                  try {
                    setName(new URL(target).hostname);
                  } catch {
                    /* Validation runs on save. */
                  }
                }}
                type={type === 'url' ? 'url' : 'text'}
                placeholder={
                  type === 'url' ? 'https://example.com' : 'Choose a path or paste one here'
                }
                autoComplete="off"
                spellCheck={false}
                required
                disabled={busy || picking}
              />
              {type !== 'url' && (
                <button
                  type="button"
                  className="button button-secondary select-button"
                  onClick={() => void selectTarget()}
                  disabled={busy || picking}
                >
                  {picking ? <Spinner /> : <Folder size={16} aria-hidden="true" />}
                  Select {typeNames[type].toLowerCase()}
                </button>
              )}
            </div>
            {type === 'url' && (
              <p className="field-hint">HTTP and HTTPS links open in your default browser.</p>
            )}
            {type === 'file' && (
              <p className="field-hint">Files open with their default Windows app.</p>
            )}
            {type === 'folder' && <p className="field-hint">Folders open in File Explorer.</p>}
          </div>
          <div className="field">
            <label htmlFor={`${id}-name`}>Item name</label>
            <input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={type === 'url' ? 'e.g. Documentation' : 'A name you recognize'}
              maxLength={120}
              required
              disabled={busy || picking}
              autoComplete="off"
            />
          </div>
          {type === 'application' && (
            <div className="field">
              <label htmlFor={`${id}-arguments`}>
                Arguments <span className="optional">Optional</span>
              </label>
              <textarea
                id={`${id}-arguments`}
                className="path-value"
                value={argumentText}
                onChange={(event) => setArgumentText(event.target.value)}
                placeholder="One argument per line"
                rows={3}
                disabled={busy || picking}
                spellCheck={false}
                aria-describedby={`${id}-arguments-hint`}
              />
              <p className="field-hint" id={`${id}-arguments-hint`}>
                Put each argument on a separate line. A path with spaces stays on one line, without
                extra quotes.
              </p>
            </div>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={busy || picking}
            />
            <span>Open this item when resuming</span>
          </label>
          {error && <ErrorMessage>{error}</ErrorMessage>}
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={busy || picking}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || picking || !name.trim() || !target.trim()}
          >
            {busy && <Spinner />}
            {item ? 'Save changes' : 'Add item'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  description,
  action,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  action: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="dialog-body">
        <p className="confirm-description">{description}</p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
      <div className="dialog-footer">
        <button
          className="button button-secondary"
          onClick={onClose}
          disabled={busy}
          data-autofocus
        >
          Cancel
        </button>
        <button className="button button-danger" onClick={() => void confirm()} disabled={busy}>
          {busy && <Spinner />}
          {action}
        </button>
      </div>
    </Modal>
  );
}

export function ReportDialog({ report, onClose }: { report: LaunchReport; onClose: () => void }) {
  const opened = report.results.filter((result) => result.status === 'success').length;
  const failed = report.results.length - opened;
  return (
    <Modal
      title={failed ? 'Some items need attention' : 'Ready to pick up where you left off'}
      subtitle={report.workspaceName}
      onClose={onClose}
      wide
    >
      <div className="dialog-body report-body">
        <div className="report-summary" aria-label="Resume summary">
          <span className="status-success">
            <CheckCircle2 size={16} aria-hidden="true" />
            {opened} opened
          </span>
          {failed > 0 && (
            <span className="status-failed">
              <AlertCircle size={16} aria-hidden="true" />
              {failed} failed
            </span>
          )}
          {report.skipped > 0 && <span>{report.skipped} disabled</span>}
        </div>
        {report.results.length > 0 ? (
          <ul className="report-list" aria-label="Launch results">
            {report.results.map((result) => (
              <li className="report-item" key={result.itemId}>
                <span
                  className={`report-status ${result.status === 'success' ? 'status-success' : 'status-failed'}`}
                >
                  {result.status === 'success' ? (
                    <Check size={18} aria-hidden="true" />
                  ) : (
                    <AlertCircle size={18} aria-hidden="true" />
                  )}
                </span>
                <div className="report-item-content">
                  <div className="report-item-title">
                    <strong>{result.name}</strong>
                    <span
                      className={result.status === 'success' ? 'status-success' : 'status-failed'}
                    >
                      {result.status === 'success' ? 'Opened' : 'Failed'}
                    </span>
                  </div>
                  <p className="path-value" title={result.target}>
                    {result.target}
                  </p>
                  {result.error && <p className="launch-error">{result.error}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-report">
            There were no enabled items to open. Add an item or turn one on to get started.
          </p>
        )}
        <p className="field-hint report-note">
          Opened items have been handed to Windows. Some apps may take a moment to appear.
        </p>
      </div>
      <div className="dialog-footer">
        <button className="button button-primary" onClick={onClose} data-autofocus>
          Back to workspace
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Modal>
  );
}

export function SettingsDialog({ info, onClose }: { info: AppInfo | null; onClose: () => void }) {
  return (
    <Modal
      title="About ContextDock"
      subtitle="Save your workspace. Resume it in one click."
      onClose={onClose}
    >
      <div className="dialog-body settings-body">
        <div className="settings-brand">
          <Logo large />
          <div>
            <strong>ContextDock</strong>
            <p>Version {info?.version ?? '—'}</p>
          </div>
        </div>
        <section>
          <h3>Keyboard shortcuts</h3>
          <dl className="shortcuts-list">
            <div>
              <dt>Show ContextDock</dt>
              <dd>
                <kbd>{info?.shortcut ?? 'Ctrl + Alt + Space'}</kbd>
              </dd>
            </div>
            <div>
              <dt>Search workspaces</dt>
              <dd>
                <kbd>Ctrl</kbd>
                <kbd>K</kbd>
              </dd>
            </div>
            <div>
              <dt>Select and resume</dt>
              <dd>
                <kbd>
                  <ArrowUp size={12} />
                </kbd>
                <kbd>
                  <ArrowDown size={12} />
                </kbd>
                <span>then</span>
                <kbd>Enter</kbd>
              </dd>
            </div>
          </dl>
          {info && !info.shortcutRegistered && (
            <ErrorMessage>
              The global shortcut is in use by another app. Close that app or change its shortcut,
              then restart ContextDock.
            </ErrorMessage>
          )}
        </section>
        <section>
          <h3>Stored on this computer</h3>
          <p className="settings-copy">
            Your workspaces stay local. The desktop app, CLI, and MCP server share the same
            workspace collection.
          </p>
          <label className="field-hint" htmlFor="data-directory">
            Data folder
          </label>
          <input
            id="data-directory"
            className="path-value"
            readOnly
            value={info?.dataDirectory ?? 'Unavailable'}
            aria-label="Data folder"
          />
        </section>
      </div>
      <div className="dialog-footer">
        <button className="button button-primary" onClick={onClose} data-autofocus>
          Done
        </button>
      </div>
    </Modal>
  );
}
