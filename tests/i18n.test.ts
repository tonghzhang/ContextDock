import { describe, expect, it, afterEach, vi } from 'vitest';
import { catalogs, languages, messages, translate } from '../src/shared/i18n';
import { itemSummary, localizeError, relativeDate } from '../src/renderer/api';
import type { WorkspaceItem } from '../src/shared/types';
const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
afterEach(() => vi.useRealTimers());

describe('desktop translations', () => {
  it('provides nonempty Chinese and Japanese translations without losing interpolation values', () => {
    expect(languages).toEqual(['en', 'zh-CN', 'ja']);
    expect(Object.keys(messages).length).toBeGreaterThan(100);
    for (const [english, translations] of Object.entries(messages)) {
      for (const language of ['zh-CN', 'ja'] as const) {
        expect(translations[language].trim(), english + ' / ' + language).not.toBe('');
        expect(placeholders(translations[language]), english + ' / ' + language).toEqual(
          placeholders(english),
        );
      }
    }
  });
  it('keeps shared translations consistent across interface catalogs', () => {
    const seen = new Map<string, object>();
    for (const catalog of catalogs)
      for (const [message, translations] of Object.entries(catalog)) {
        if (seen.has(message)) expect(translations, message).toEqual(seen.get(message));
        seen.set(message, translations);
      }
  });
  it('does not treat names, paths, or replacement values as templates', () => {
    const target = 'D:\\Projects\\{name}\\設計.pdf';
    const output = translate('zh-CN', 'Path does not exist: {target}', { target });
    expect(output).toBe('路径不存在：' + target);
    expect(translate('ja', 'Unknown system diagnostic')).toBe('Unknown system diagnostic');
    expect(translate('en', 'Used {count}m ago', { count: 5 })).toBe('Used 5m ago');
    expect(translate('ja', 'Used {count}m ago', { count: 5 })).toBe('5 分前に使用');
  });
  it('localizes launch and validation errors without changing their details', () => {
    expect(localizeError('Path does not exist: D:\\docs\\a.pdf', 'ja')).toBe(
      'パスが存在しません：D:\\docs\\a.pdf',
    );
    expect(
      localizeError(
        'Workspace name must not be empty and must be at most 200 characters without control characters.',
        'zh-CN',
      ),
    ).toBe('工作区名称不能为空，最多 200 个字符，且不能包含控制字符。');
    expect(localizeError('Windows could not open this item (exit 1).', 'ja')).toContain(
      '終了コード 1',
    );
    expect(localizeError('Windows could not start this item: EACCES', 'zh-CN')).toContain('EACCES');
    expect(
      localizeError('A workspace with this name already exists. Choose a different name.', 'zh-CN'),
    ).toContain('已存在');
  });
  it('formats resource counts and usage dates for the selected language', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
    expect(relativeDate('2026-09-27T08:00:00Z', 'zh-CN')).toBe('2 小时前使用');
    expect(relativeDate('2026-09-27T08:00:00Z', 'ja')).toBe('2 時間前に使用');
    expect(relativeDate(null, 'ja')).toBe('まだ再開していません');
    expect(itemSummary([], 'zh-CN')).toBe('暂无资源');
    const items = [{ type: 'url' }, { type: 'url' }, { type: 'folder' }] as WorkspaceItem[];
    expect(itemSummary(items, 'zh-CN')).toBe('2 个网站 · 1 个文件夹');
    expect(itemSummary(items, 'en')).toBe('2 websites · 1 folder');
  });
});
