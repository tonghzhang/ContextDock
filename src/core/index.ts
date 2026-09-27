import { openDatabase } from './database';
import { resolveDataDirectory } from './paths';
import { WorkspaceService } from './service';
import { WindowsLauncher } from './launcher';
import type { Launcher } from '../shared/types';

export { WorkspaceError } from './errors';
export { WorkspaceService } from './service';
export { WindowsLauncher } from './launcher';
export { resolveDataDirectory } from './paths';

export function createContext(options: { dataDir?: string; launcher?: Launcher } = {}) {
  const dataDirectory = resolveDataDirectory(options.dataDir);
  const database = openDatabase(dataDirectory);
  let closed = false;
  return {
    service: new WorkspaceService(database, options.launcher ?? new WindowsLauncher()),
    dataDirectory,
    close() {
      if (!closed) {
        database.close();
        closed = true;
      }
    },
  };
}
