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
import { desktop, errorText, getTypeNames, localizeError, resultOf } from './api';
import { useI18n } from './i18n';
import { GitHubSettings } from './github-settings';

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

export function Modal({
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
  const { t } = useI18n();
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
        <button
          className="icon-button"
          aria-label={t('Close dialog')}
          onClick={onClose}
          disabled={busy}
        >
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
  const { language, t } = useI18n();
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
      setError(errorText(caught, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={workspace ? t('Edit workspace') : t('New workspace')}
      subtitle={t('Give this collection of apps, files, and websites a home.')}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="dialog-body form-stack">
          <div className="field">
            <label htmlFor={`${id}-name`}>{t('Workspace name')}</label>
            <input
              id={`${id}-name`}
              data-autofocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('e.g. Product website')}
              maxLength={120}
              required
              disabled={busy}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-description`}>
              {t('Description')} <span className="optional">{t('Optional')}</span>
            </label>
            <textarea
              id={`${id}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('What are you working on?')}
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
            {t('Cancel')}
          </button>
          <button className="button button-primary" type="submit" disabled={busy || !name.trim()}>
            {busy && <Spinner />}
            {workspace ? t('Save changes') : t('Create workspace')}
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
  const { language, t } = useI18n();
  const typeNames = getTypeNames(language);
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
    application: t('Application path'),
    file: t('File path'),
    folder: t('Folder path'),
    url: t('Website address'),
  };

  const pickerLabels = {
    application: t('Select application'),
    file: t('Select file'),
    folder: t('Select folder'),
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
      setError(errorText(caught, language));
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
      setError(errorText(caught, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={item ? t('Edit item') : t('Add item')}
      subtitle={t('Choose what to open when you resume this workspace.')}
      onClose={onClose}
      busy={busy || picking}
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="dialog-body form-stack">
          <fieldset className="type-fieldset" disabled={busy || picking}>
            <legend>{t('Item type')}</legend>
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
                  type === 'url' ? 'https://example.com' : t('Choose a path or paste one here')
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
                  {pickerLabels[type]}
                </button>
              )}
            </div>
            {type === 'url' && (
              <p className="field-hint">
                {t('HTTP and HTTPS links open in your default browser.')}
              </p>
            )}
            {type === 'file' && (
              <p className="field-hint">{t('Files open with their default Windows app.')}</p>
            )}
            {type === 'folder' && (
              <p className="field-hint">{t('Folders open in File Explorer.')}</p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-name`}>{t('Item name')}</label>
            <input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={type === 'url' ? t('e.g. Documentation') : t('A name you recognize')}
              maxLength={120}
              required
              disabled={busy || picking}
              autoComplete="off"
            />
          </div>
          {type === 'application' && (
            <div className="field">
              <label htmlFor={`${id}-arguments`}>
                {t('Arguments')} <span className="optional">{t('Optional')}</span>
              </label>
              <textarea
                id={`${id}-arguments`}
                className="path-value"
                value={argumentText}
                onChange={(event) => setArgumentText(event.target.value)}
                placeholder={t('One argument per line')}
                rows={3}
                disabled={busy || picking}
                spellCheck={false}
                aria-describedby={`${id}-arguments-hint`}
              />
              <p className="field-hint" id={`${id}-arguments-hint`}>
                {t(
                  'Put each argument on a separate line. A path with spaces stays on one line, without extra quotes.',
                )}
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
            <span>{t('Open this item when resuming')}</span>
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
            {t('Cancel')}
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || picking || !name.trim() || !target.trim()}
          >
            {busy && <Spinner />}
            {item ? t('Save changes') : t('Add item')}
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
  const { language, t } = useI18n();
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (caught) {
      setError(errorText(caught, language));
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
          {t('Cancel')}
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
  const { language, t } = useI18n();
  const opened = report.results.filter((result) => result.status === 'success').length;
  const failed = report.results.length - opened;
  return (
    <Modal
      title={failed ? t('Some items need attention') : t('Ready to pick up where you left off')}
      subtitle={report.workspaceName}
      onClose={onClose}
      wide
    >
      <div className="dialog-body report-body">
        <div className="report-summary" aria-label={t('Resume summary')}>
          <span className="status-success">
            <CheckCircle2 size={16} aria-hidden="true" />
            {t('{count} opened', { count: opened })}
          </span>
          {failed > 0 && (
            <span className="status-failed">
              <AlertCircle size={16} aria-hidden="true" />
              {t('{count} failed', { count: failed })}
            </span>
          )}
          {report.skipped > 0 && <span>{t('{count} disabled', { count: report.skipped })}</span>}
        </div>
        {report.results.length > 0 ? (
          <ul className="report-list" aria-label={t('Launch results')}>
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
                      {result.status === 'success' ? t('Opened') : t('Failed')}
                    </span>
                  </div>
                  <p className="path-value" title={result.target}>
                    {result.target}
                  </p>
                  {result.error && (
                    <p className="launch-error">{localizeError(result.error, language)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-report">
            {t('There were no enabled items to open. Add an item or turn one on to get started.')}
          </p>
        )}
        <p className="field-hint report-note">
          {t('Opened items have been handed to Windows. Some apps may take a moment to appear.')}
        </p>
      </div>
      <div className="dialog-footer">
        <button className="button button-primary" onClick={onClose} data-autofocus>
          {t('Back to workspace')}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Modal>
  );
}

export function SettingsDialog({ info, onClose }: { info: AppInfo | null; onClose: () => void }) {
  const { language, t, setLanguage, languageSaving } = useI18n();
  const [error, setError] = useState('');
  const languageId = useId();

  async function changeLanguage(nextLanguage: typeof language) {
    if (languageSaving) return;
    setError('');
    try {
      await setLanguage(nextLanguage);
    } catch (caught) {
      setError(errorText(caught, language));
    }
  }

  return (
    <Modal
      title={t('Settings')}
      subtitle={t('Save your workspace. Resume it in one click.')}
      onClose={onClose}
      busy={languageSaving}
    >
      <div className="dialog-body settings-body">
        <div className="settings-brand">
          <Logo large />
          <div>
            <strong>ContextDock</strong>
            <p>{t('Version {version}', { version: info?.version ?? '—' })}</p>
          </div>
        </div>
        <section>
          <div className="field">
            <label htmlFor={languageId}>{t('Language')}</label>
            <select
              id={languageId}
              aria-label={t('Language')}
              value={language}
              onChange={(event) => void changeLanguage(event.target.value as typeof language)}
              disabled={languageSaving}
              aria-describedby={languageId + '-hint'}
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
              <option value="ja">日本語</option>
            </select>
            <p className="field-hint" id={languageId + '-hint'}>
              {t('Changes apply immediately and are saved automatically.')}
            </p>
            {languageSaving && (
              <p className="field-hint" role="status">
                <Spinner /> {t('Saving language…')}
              </p>
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
          </div>
        </section>
        <GitHubSettings />
        <section>
          <h3>{t('Keyboard shortcuts')}</h3>
          <dl className="shortcuts-list">
            <div>
              <dt>{t('Show ContextDock')}</dt>
              <dd>
                <kbd>{info?.shortcut ?? 'Ctrl + Alt + Space'}</kbd>
              </dd>
            </div>
            <div>
              <dt>{t('Search workspaces')}</dt>
              <dd>
                <kbd>Ctrl</kbd>
                <kbd>K</kbd>
              </dd>
            </div>
            <div>
              <dt>{t('Select and resume')}</dt>
              <dd>
                <kbd aria-label={t('Up arrow')}>
                  <ArrowUp size={12} aria-hidden="true" />
                </kbd>
                <kbd aria-label={t('Down arrow')}>
                  <ArrowDown size={12} aria-hidden="true" />
                </kbd>
                <span>{t('then')}</span>
                <kbd>Enter</kbd>
              </dd>
            </div>
          </dl>
          {info && !info.shortcutRegistered && (
            <ErrorMessage>
              {t(
                'The global shortcut is in use by another app. Close that app or change its shortcut, then restart ContextDock.',
              )}
            </ErrorMessage>
          )}
        </section>
        <section>
          <h3>{t('Stored on this computer')}</h3>
          <p className="settings-copy">
            {t(
              'Your workspaces stay local. The desktop app, CLI, and MCP server share the same workspace collection.',
            )}
          </p>
          <label className="field-hint" htmlFor="data-directory">
            {t('Data folder')}
          </label>
          <input
            id="data-directory"
            className="path-value"
            readOnly
            value={info?.dataDirectory ?? t('Unavailable')}
            aria-label={t('Data folder')}
          />
        </section>
      </div>
      <div className="dialog-footer">
        <button
          className="button button-primary"
          onClick={onClose}
          data-autofocus
          disabled={languageSaving}
        >
          {t('Done')}
        </button>
      </div>
    </Modal>
  );
}
