import { useState } from 'react';
import type { Workspace } from '../shared/types';
import type { ImportMode, ImportPreview, RemoteWorkspace } from '../shared/transfer';
import { desktop, errorText, resultOf } from './api';
import { useI18n } from './i18n';
import { ErrorMessage, Modal, Spinner } from './dialogs';
export function ExportDialog({
  workspace,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  async function save(destination: 'local' | 'github') {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      setDone(await resultOf(desktop().exportWorkspace(workspace.id, selected, destination)));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('Export workspace')} subtitle={workspace.name} onClose={onClose} busy={busy}>
      <div className="dialog-body">
        <p className="settings-copy">
          {t(
            'Configuration is always included. Select ordinary files to carry with this workspace.',
          )}
        </p>
        <p className="field-hint">
          {t(
            'Apps and folders stay as local references. Arguments are preserved unchanged. Maximum package size: 25 MB.',
          )}
        </p>
        <div className="transfer-items">
          {workspace.items
            .filter((item) => item.type === 'file')
            .map((item) => (
              <label className="transfer-item" key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  disabled={busy || item.unresolved}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    )
                  }
                />
                <span>
                  <strong>{item.name}</strong>
                  <small className="path-value">{item.target}</small>
                </span>
              </label>
            ))}
        </div>
        <p className="field-hint">
          {t(
            selected.length
              ? 'Selected files will be included.'
              : 'Configuration only; no files selected.',
          )}
        </p>
        {error !== null && <ErrorMessage>{errorText(error, language)}</ErrorMessage>}
        {done && <p role="status">{t('Workspace exported.')}</p>}
      </div>
      <div className="dialog-footer transfer-actions">
        {busy && <Spinner />}
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void save('github')}
        >
          {t('Export to GitHub')}
        </button>
        <button
          className="button button-primary"
          disabled={busy}
          onClick={() => void save('local')}
        >
          {t('Save file…')}
        </button>
      </div>
    </Modal>
  );
}
export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (workspace: Workspace) => Promise<void>;
}) {
  const { t, language } = useI18n();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [remote, setRemote] = useState<RemoteWorkspace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (preview) await resultOf(desktop().cancelImport(preview.sessionId));
    onClose();
  }
  async function commit(mode: ImportMode) {
    if (!preview) return;
    const workspace = await resultOf(desktop().commitImport(preview.sessionId, mode));
    if (workspace) await onImported(workspace);
  }
  return (
    <Modal title={t('Import workspace')} onClose={() => void run(close)} busy={busy} wide>
      <div className="dialog-body">
        {!preview ? (
          <>
            <div className="transfer-actions">
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const value = await resultOf(desktop().importLocal());
                    if (value) setPreview(value);
                  })
                }
              >
                {t('Choose .contextdock file…')}
              </button>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setRemote(await resultOf(desktop().listRemote()));
                  })
                }
              >
                {t('Import from GitHub')}
              </button>
            </div>
            {remote !== null && (
              <section className="transfer-items">
                <h3>{t('GitHub workspaces')}</h3>
                {!remote.length && <p>{t('No remote workspaces yet.')}</p>}
                {remote.map((item) => (
                  <div className="transfer-item" key={item.path}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.path}</small>
                    </span>
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setPreview(await resultOf(desktop().importRemote(item.path)));
                        })
                      }
                    >
                      {t('Import')}
                    </button>
                  </div>
                ))}
              </section>
            )}
          </>
        ) : (
          <>
            <h3>{preview.name}</h3>
            <p className="settings-copy">{preview.description}</p>
            <p className="field-hint">
              {t('Missing paths remain disabled. You can locate them now or after import.')}
            </p>
            <div className="transfer-items">
              {preview.items.map((item) => (
                <div className="transfer-item" key={item.id}>
                  <span aria-hidden="true">{item.unresolved ? '⚠' : '✓'}</span>
                  <span>
                    <strong>{item.name}</strong>
                    <small className="path-value">
                      {item.included ? t('Included') : item.target}
                    </small>
                    {item.arguments.length > 0 && (
                      <small className="path-value">{item.arguments.join(' · ')}</small>
                    )}
                    {item.unresolved && (
                      <small className="unresolved-label">{t('Needs locating')}</small>
                    )}
                    {!item.enabled && <small>{t('Disabled')}</small>}
                  </span>
                  {item.unresolved && (
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setPreview(
                            await resultOf(desktop().locateImport(preview.sessionId, item.id)),
                          );
                        })
                      }
                    >
                      {t('Locate…')}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {preview.duplicate && (
              <p className="form-error">
                {t('This workspace already exists. Replace it or import an independent copy.')}
              </p>
            )}
          </>
        )}
        {busy && (
          <p role="status">
            <Spinner /> {t('Working…')}
          </p>
        )}
        {error !== null && <ErrorMessage>{errorText(error, language)}</ErrorMessage>}
      </div>
      <div className="dialog-footer transfer-actions">
        <button className="button button-secondary" disabled={busy} onClick={() => void run(close)}>
          {t('Cancel')}
        </button>
        {preview && (
          <>
            {preview.duplicate && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => void run(() => commit('duplicate'))}
              >
                {t('Import as copy')}
              </button>
            )}
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void run(() => commit('replace'))}
            >
              {t(preview.duplicate ? 'Replace workspace' : 'Import')}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
