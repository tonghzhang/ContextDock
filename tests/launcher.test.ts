import { describe, expect, it, vi } from 'vitest';
import { WindowsLauncher, launchProcess, type LaunchProcessRequest } from '../src/core/launcher';
import type { WorkspaceItem } from '../src/shared/types';

const item = (type: WorkspaceItem['type'], target: string, args: string[] = []): WorkspaceItem => ({
  id: 'item',
  workspaceId: 'workspace',
  type,
  name: 'Test item',
  target,
  arguments: args,
  enabled: true,
  launchOrder: 0,
});
const fileStat = async () => ({ isFile: () => true, isDirectory: () => false });
const folderStat = async () => ({ isFile: () => false, isDirectory: () => true });
function setup(stat = fileStat) {
  const run = vi.fn(async (_request: LaunchProcessRequest) => {});
  return {
    run,
    launcher: new WindowsLauncher({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      stat,
      run,
    }),
  };
}

describe('WindowsLauncher', () => {
  it('launches an application with exact argument boundaries and its own working directory', async () => {
    const { launcher, run } = setup();
    const args = [
      'D:\\Project with spaces',
      '--flag',
      '$(whoami); & echo unsafe',
      'a"quoted"value',
    ];
    await launcher.launch(item('application', 'D:\\Apps\\My App.exe', args));
    expect(run).toHaveBeenCalledWith({
      executable: 'D:\\Apps\\My App.exe',
      arguments: args,
      cwd: 'D:\\Apps',
      environment: { SystemRoot: 'C:\\Windows' },
      waitForExit: false,
    });
  });

  it('opens folders with Windows Explorer without parsing user paths as commands', async () => {
    const { launcher, run } = setup(folderStat);
    await launcher.launch(item('folder', 'D:\\Projects\\Folder & Documents'));
    expect(run).toHaveBeenCalledWith({
      executable: 'C:\\Windows\\explorer.exe',
      arguments: ['D:\\Projects\\Folder & Documents'],
      environment: { SystemRoot: 'C:\\Windows' },
      waitForExit: false,
    });
  });

  it.each([
    ['url', 'https://example.com/?q=%27%3BStart-Process%20calc.exe&x=1'],
    ['file', "D:\\Docs\\annual 'report' & notes.pdf"],
  ] as const)(
    'opens %s using the default association with user data outside the fixed command',
    async (type, target) => {
      const { launcher, run } = setup();
      await launcher.launch(item(type, target));
      const request = run.mock.calls[0][0];
      expect(request.executable).toBe(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      );
      expect(request.waitForExit).toBe(true);
      expect(request.arguments).toContain('-NoProfile');
      expect(request.arguments.join(' ')).not.toContain(target);
      expect(request.arguments.at(-1)).toContain('$env:CONTEXTDOCK_OPEN_TARGET');
      expect(request.environment?.CONTEXTDOCK_OPEN_TARGET).toBe(target);
    },
  );

  it('does not require a filesystem target for URLs', async () => {
    const inspect = vi.fn(fileStat);
    const { run } = setup();
    const launcher = new WindowsLauncher({ platform: 'win32', stat: inspect, run });
    await launcher.launch(item('url', 'http://localhost:3000'));
    expect(inspect).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });

  it.each(['application', 'file', 'folder'] as const)(
    'reports a missing %s target without launching',
    async (type) => {
      const run = vi.fn(async () => {});
      const launcher = new WindowsLauncher({
        platform: 'win32',
        stat: async () => {
          throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
        },
        run,
      });
      await expect(launcher.launch(item(type, 'D:\\Missing\\target.exe'))).rejects.toThrow(
        'Path does not exist',
      );
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('bounds an unreachable network path check instead of hanging the workspace', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async () => {});
      const launcher = new WindowsLauncher({
        platform: 'win32',
        stat: () => new Promise(() => {}),
        run,
      });
      const outcome = expect(
        launcher.launch(item('file', '\\\\unavailable-server\\documents\\file.pdf')),
      ).rejects.toThrow('drive or network share is available');
      await vi.advanceTimersByTimeAsync(10000);
      await outcome;
      expect(run).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('distinguishes inaccessible targets from missing targets', async () => {
    const launcher = new WindowsLauncher({
      platform: 'win32',
      stat: async () => {
        throw Object.assign(new Error('Denied'), { code: 'EACCES' });
      },
    });
    await expect(launcher.launch(item('file', 'D:\\Private\\file.pdf'))).rejects.toThrow(
      'Cannot access this path',
    );
  });

  it('rejects files saved as folders and folders saved as applications', async () => {
    await expect(setup(fileStat).launcher.launch(item('folder', 'D:\\data'))).rejects.toThrow(
      'not a folder',
    );
    await expect(
      setup(folderStat).launcher.launch(item('application', 'D:\\directory.exe')),
    ).rejects.toThrow('not a file');
  });

  it('rejects unsafe protocols and invalid arguments at the launcher boundary too', async () => {
    const { launcher, run } = setup();
    await expect(launcher.launch(item('url', 'javascript:alert(1)'))).rejects.toThrow(
      'http:// or https://',
    );
    await expect(
      launcher.launch(item('application', 'D:\\run.exe', ['bad\0argument'])),
    ).rejects.toThrow('null characters');
    expect(run).not.toHaveBeenCalled();
  });

  it('propagates shell association failure so the service can report that item', async () => {
    const launcher = new WindowsLauncher({
      platform: 'win32',
      stat: fileStat,
      run: async () => {
        throw new Error('No application is associated with this file');
      },
    });
    await expect(launcher.launch(item('file', 'D:\\unknown.extension'))).rejects.toThrow(
      'No application is associated',
    );
  });

  it('reports unsupported platforms instead of opening arbitrary commands', async () => {
    const launcher = new WindowsLauncher({ platform: 'linux' });
    await expect(launcher.launch(item('url', 'https://example.com'))).rejects.toThrow(
      'requires Windows',
    );
  });
});

describe('launchProcess transport', () => {
  it('waits for successful shell dispatch without retaining a running process', async () => {
    await expect(
      launchProcess({
        executable: process.execPath,
        arguments: ['-e', 'process.exit(0)'],
        waitForExit: true,
        cwd: process.cwd(),
      }),
    ).resolves.toBeUndefined();
  });

  it('captures a nonzero process exit as a useful error', async () => {
    await expect(
      launchProcess({
        executable: process.execPath,
        arguments: ['-e', "process.stderr.write('Association failed'); process.exit(7)"],
        waitForExit: true,
        cwd: process.cwd(),
      }),
    ).rejects.toThrow('Association failed');
  });

  it('reports an executable that cannot be spawned', async () => {
    await expect(
      launchProcess({
        executable: 'Z:\\ContextDock-Missing-Test-Program.exe',
        arguments: [],
        waitForExit: false,
      }),
    ).rejects.toThrow('Windows could not start');
  });
});
