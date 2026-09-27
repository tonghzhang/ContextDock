import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { WorkspaceError } from './errors';

export function resolveDataDirectory(override?: string): string {
  const configured = override ?? process.env.CONTEXTDOCK_DATA_DIR;
  if (configured !== undefined) {
    if (typeof configured !== 'string' || !configured.trim() || !isAbsolute(configured)) {
      throw new WorkspaceError('The data directory must be an absolute path.');
    }
    return resolve(configured);
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ContextDock');
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'ContextDock');
}
