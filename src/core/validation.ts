import { isAbsolute, win32 } from 'node:path';
import type { ItemInput, ItemType, WorkspaceInput } from '../shared/types';
import { WorkspaceError } from './errors';

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new WorkspaceError(`${label} must be text.`);
  const result = value.trim();
  if (
    (!allowEmpty && !result) ||
    result.length > maxLength ||
    Array.from(result).some(
      (character) => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)),
    )
  ) {
    throw new WorkspaceError(
      `${label} ${!allowEmpty ? 'must not be empty and ' : ''}must be at most ${maxLength} characters without control characters.`,
    );
  }
  return result;
}

export function nameKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function workspaceInput(value: unknown): Required<WorkspaceInput> {
  const input = record(value, 'Workspace');
  const name = text(input.name, 'Workspace name', 200).normalize('NFKC').replace(/\s+/gu, ' ');
  return {
    name: text(name, 'Workspace name', 200),
    description: text(
      input.description === undefined ? '' : input.description,
      'Description',
      4096,
      true,
    ),
  };
}

export function itemInput(value: unknown, previous?: Required<ItemInput>): Required<ItemInput> {
  const input = record(value, 'Item');
  const types: ItemType[] = ['application', 'file', 'folder', 'url'];
  if (!types.includes(input.type as ItemType)) throw new WorkspaceError('Unknown item type.');
  const type = input.type as ItemType;
  const name = text(input.name, 'Item name', 200);
  let target = text(input.target, 'Target', 32768);
  if (/[\r\n]/u.test(target)) throw new WorkspaceError('Target must not contain line breaks.');
  if (type === 'url') {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new WorkspaceError('Enter a valid http:// or https:// URL.');
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      throw new WorkspaceError(
        'URLs must use http:// or https:// and must not include login credentials.',
      );
    }
    target = url.href;
  } else {
    if (
      !(win32.isAbsolute(target) && win32.parse(target).root.length > 1) &&
      !(process.platform !== 'win32' && isAbsolute(target))
    )
      throw new WorkspaceError('Choose an absolute file or folder path.');
    if (type === 'application' && !/\.exe$/iu.test(target))
      throw new WorkspaceError('Choose a Windows application (.exe).');
  }
  const args =
    input.arguments === undefined
      ? previous?.type === type
        ? previous.arguments
        : []
      : input.arguments;
  if (
    !Array.isArray(args) ||
    args.length > 128 ||
    args.some((arg) => typeof arg !== 'string' || arg.length > 32768 || arg.includes('\0'))
  ) {
    throw new WorkspaceError(
      'Arguments must be an array of at most 128 strings without null characters.',
    );
  }
  if (type !== 'application' && args.length)
    throw new WorkspaceError('Arguments are only supported for applications.');
  const enabled = input.enabled === undefined ? (previous?.enabled ?? true) : input.enabled;
  if (typeof enabled !== 'boolean') throw new WorkspaceError('Enabled must be true or false.');
  const launchOrder =
    input.launchOrder === undefined ? (previous?.launchOrder ?? 0) : input.launchOrder;
  if (
    !Number.isSafeInteger(launchOrder) ||
    Number(launchOrder) < 0 ||
    Number(launchOrder) > 1000000
  ) {
    throw new WorkspaceError('Launch order must be a nonnegative integer up to 1000000.');
  }
  return {
    type,
    name,
    target,
    arguments: [...args] as string[],
    enabled,
    launchOrder: Number(launchOrder),
  };
}
