import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Language } from '../shared/types';
import { translate, type MessageValues } from '../shared/i18n';
import { desktop, resultOf, localizeError } from './api';

interface I18nContextValue {
  language: Language;
  t: (message: string, values?: MessageValues) => string;
  setLanguage: (language: Language) => Promise<void>;
  languageSaving: boolean;
}
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>('en');
  const [loaded, setLoaded] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  const [languageSaving, setLanguageSaving] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    if (!window.contextdock) {
      setLoaded(true);
      return;
    }
    void resultOf(desktop().getLanguage())
      .then((saved) => {
        if (active) updateLanguage(saved);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadingError(
            error instanceof Error ? error.message : 'Could not load language preferences.',
          );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback(async (next: Language) => {
    if (saving.current) throw new Error('A language change is already in progress.');
    saving.current = true;
    setLanguageSaving(true);
    try {
      const saved = await resultOf(desktop().setLanguage(next));
      updateLanguage(saved);
      setLoadingError('');
    } finally {
      saving.current = false;
      setLanguageSaving(false);
    }
  }, []);
  const t = useCallback(
    (message: string, values?: MessageValues) => translate(language, message, values),
    [language],
  );
  const value = useMemo(
    () => ({ language, t, setLanguage, languageSaving }),
    [language, t, setLanguage, languageSaving],
  );
  return (
    <I18nContext.Provider value={value}>
      {loadingError && (
        <div className="form-error" role="alert">
          {localizeError(loadingError, language)}
        </div>
      )}
      {loaded ? (
        children
      ) : (
        <div className="startup-status" role="status">
          {t('Loading…')}
        </div>
      )}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('The language provider is unavailable.');
  return context;
}
