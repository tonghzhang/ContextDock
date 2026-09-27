import { useEffect, useState } from 'react';
import type { GitHubStatus } from '../shared/transfer';
import { desktop, errorText, resultOf } from './api';
import { useI18n } from './i18n';
export function GitHubSettings() {
  const { language, t } = useI18n();
  const [config, setConfig] = useState<GitHubStatus>({
    owner: '',
    repository: '',
    branch: 'main',
    hasToken: false,
  });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void resultOf(desktop().getGitHubConnection())
      .then((value) => {
        if (active) {
          setConfig(value);
          setLoaded(true);
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: 'save' | 'token' | 'test') {
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      const { owner, repository, branch } = config;
      setConfig(await resultOf(desktop().saveGitHubConnection({ owner, repository, branch })));
      if (action === 'token') setConfig(await resultOf(desktop().setGitHubToken()));
      if (action === 'test') await resultOf(desktop().testGitHubConnection());
      setMessage(
        action === 'test' ? 'GitHub connection successful.' : 'Connection settings saved.',
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="github-settings">
      <h3>{t('GitHub connection')}</h3>
      <p className="field-hint">
        {t('Use a private repository and a fine-grained PAT with Contents: Read and write.')}
      </p>
      {(['owner', 'repository', 'branch'] as const).map((key) => (
        <label className="field" key={key}>
          <span>{t({ owner: 'Owner', repository: 'Repository', branch: 'Branch' }[key])}</span>
          <input
            value={config[key]}
            disabled={busy || !loaded}
            autoComplete="off"
            onChange={(event) => setConfig({ ...config, [key]: event.target.value })}
          />
        </label>
      ))}
      <p className="field-hint">
        {t(config.hasToken ? 'Token saved securely on this computer.' : 'No token saved.')}
      </p>
      <div className="transfer-actions">
        <button
          className="button button-secondary"
          disabled={busy || !loaded}
          onClick={() => void run('save')}
        >
          {t('Save connection')}
        </button>
        <button
          className="button button-secondary"
          disabled={busy || !loaded}
          onClick={() => void run('token')}
        >
          {t('Set token…')}
        </button>
        <button
          className="button button-secondary"
          disabled={busy || !loaded || !config.hasToken}
          onClick={() => void run('test')}
        >
          {t('Test connection')}
        </button>
      </div>
      {busy && <p role="status">{t('Working…')}</p>}
      {message && <p role="status">{t(message)}</p>}
      {error !== null && (
        <p className="form-error" role="alert">
          {errorText(error, language)}
        </p>
      )}
    </section>
  );
}
