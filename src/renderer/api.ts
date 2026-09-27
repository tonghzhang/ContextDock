import type {
  ApiResult,
  DesktopApi,
  ItemType,
  Language,
  Workspace,
  WorkspaceItem,
} from '../shared/types';
import { translate } from '../shared/i18n';

export function desktop(): DesktopApi {
  if (!window.contextdock) throw new Error('Open the desktop app to manage your workspaces.');
  return window.contextdock;
}

export async function resultOf<T>(request: Promise<ApiResult<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

// Keep operating-system details and user-provided paths intact while translating the known context.
export function localizeError(message: string, language: Language): string {
  const direct = translate(language, message);
  if (direct !== message || language === 'en') return direct;
  const targetPrefixes = [
    ['Path does not exist: ', 'Path does not exist: {target}'],
    ['Cannot access this path: ', 'Cannot access this path: {target}'],
  ] as const;
  for (const [prefix, template] of targetPrefixes) {
    if (message.startsWith(prefix))
      return translate(language, template, { target: message.slice(prefix.length) });
  }
  const launchPrefix = 'Windows could not start this item: ';
  if (message.startsWith(launchPrefix))
    return translate(language, 'Windows could not start this item: {reason}', {
      reason: message.slice(launchPrefix.length),
    });
  const exit = /^Windows could not open this item \(exit (.+)\)\.$/.exec(message);
  if (exit)
    return translate(language, 'Windows could not open this item (exit {code}).', {
      code: exit[1],
    });
  const simpleField =
    /^(Workspace|Workspace name|Workspace identifier|Description|Item|Item name|Item identifier|Target) must be (an object|text)\.$/.exec(
      message,
    );
  if (simpleField)
    return translate(language, '{field} must be ' + simpleField[2] + '.', {
      field: translate(language, simpleField[1]),
    });
  const length =
    /^(Workspace|Workspace name|Workspace identifier|Description|Item|Item name|Item identifier|Target) (must not be empty and )?must be at most (\d+) characters without control characters\.$/.exec(
      message,
    );
  if (length)
    return translate(
      language,
      '{field} ' +
        (length[2] ?? '') +
        'must be at most {count} characters without control characters.',
      { field: translate(language, length[1]), count: length[3] },
    );
  return message;
}

export function errorText(error: unknown, language: Language = 'en'): string {
  return localizeError(
    error instanceof Error ? error.message : 'The action could not be completed. Try again.',
    language,
  );
}

export function getTypeNames(language: Language): Record<ItemType, string> {
  return {
    application: translate(language, 'Application'),
    file: translate(language, 'File'),
    folder: translate(language, 'Folder'),
    url: translate(language, 'URL'),
  };
}

export function itemSummary(items: WorkspaceItem[], language: Language = 'en'): string {
  if (items.length === 0) return translate(language, 'No items yet');
  const names: Record<ItemType, [string, string]> = {
    application: ['{count} app', '{count} apps'],
    file: ['{count} file', '{count} files'],
    folder: ['{count} folder', '{count} folders'],
    url: ['{count} website', '{count} websites'],
  };
  return (['application', 'url', 'folder', 'file'] as const)
    .map((type) => {
      const count = items.filter((item) => item.type === type).length;
      return count ? translate(language, names[type][count === 1 ? 0 : 1], { count }) : '';
    })
    .filter(Boolean)
    .join(' · ');
}

export function relativeDate(iso: string | null, language: Language = 'en'): string {
  if (!iso) return translate(language, 'Not resumed yet');
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return translate(language, 'Used just now');
  if (minutes < 60) return translate(language, 'Used {count}m ago', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate(language, 'Used {count}h ago', { count: hours });
  if (hours < 48) return translate(language, 'Used yesterday');
  const days = Math.floor(hours / 24);
  if (days < 30) return translate(language, 'Used {count}d ago', { count: days });
  return translate(language, 'Used {date}', {
    date: new Intl.DateTimeFormat(language).format(new Date(iso)),
  });
}

export function workspaceMatches(workspace: Workspace, query: string): boolean {
  const text = query.trim().toLocaleLowerCase();
  return !text || `${workspace.name} ${workspace.description}`.toLocaleLowerCase().includes(text);
}
