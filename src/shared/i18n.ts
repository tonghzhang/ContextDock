import { transferMessages } from './locales/transfer';
import type { Language } from './types';
import { appMessages } from './locales/app';
import { dialogMessages } from './locales/dialogs';
import { commonMessages } from './locales/common';
import { nativeMessages } from './locales/native';

export const languages = ['en', 'zh-CN', 'ja'] as const;
export type MessageValues = Record<string, string | number>;
export type TranslationTable = Record<string, Record<Exclude<Language, 'en'>, string>>;
export const catalogs: TranslationTable[] = [
  commonMessages,
  appMessages,
  dialogMessages,
  nativeMessages,
  transferMessages,
];
export const messages: TranslationTable = Object.assign({}, ...catalogs);

export function translate(language: Language, message: string, values: MessageValues = {}): string {
  const template = language === 'en' ? message : (messages[message]?.[language] ?? message);
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}
