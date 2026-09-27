import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { win32 } from 'node:path';
import type { Launcher, WorkspaceItem } from '../shared/types';
import { WorkspaceError } from './errors';
import { itemInput } from './validation';

export interface LaunchProcessRequest {
  executable: string;
  arguments: string[];
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  waitForExit: boolean;
}

interface LauncherDependencies {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  stat?: (target: string) => Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  run?: (request: LaunchProcessRequest) => Promise<void>;
}

// The command is fixed. User-controlled URLs and paths are passed only as environment data.
const openTargetCommand =
  "$ErrorActionPreference = 'Stop'; try { Start-Process -FilePath $env:CONTEXTDOCK_OPEN_TARGET -ErrorAction Stop | Out-Null; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";

export function launchProcess(request: LaunchProcessRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, request.arguments, {
      shell: false,
      windowsHide: request.waitForExit,
      detached: !request.waitForExit,
      stdio: request.waitForExit ? ['ignore', 'ignore', 'pipe'] : 'ignore',
      cwd: request.cwd,
      env: request.environment ?? process.env,
    });
    let done = false;
    let stderr = '';
    const timer = setTimeout(() => {
      if (request.waitForExit) child.kill();
      finish(new Error('Windows took too long to open this item.'));
    }, 20000);
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(0, 4000);
    });
    child.once('error', (error) =>
      finish(new Error(`Windows could not start this item: ${error.message}`)),
    );
    child.once('spawn', () => {
      if (!request.waitForExit) {
        child.unref();
        finish();
      }
    });
    child.once('close', (code) => {
      if (request.waitForExit)
        finish(
          code === 0
            ? undefined
            : new Error(
                stderr.trim() || `Windows could not open this item (exit ${String(code)}).`,
              ),
        );
    });
  });
}

export class WindowsLauncher implements Launcher {
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly inspect: NonNullable<LauncherDependencies['stat']>;
  private readonly run: NonNullable<LauncherDependencies['run']>;

  constructor(dependencies: LauncherDependencies = {}) {
    this.platform = dependencies.platform ?? process.platform;
    this.environment = dependencies.environment ?? process.env;
    this.inspect = dependencies.stat ?? stat;
    this.run = dependencies.run ?? launchProcess;
  }

  private async inspectWithTimeout(target: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new WorkspaceError(
              'Windows took too long to check this path. Verify that the drive or network share is available.',
            ),
          ),
        10000,
      );
    });
    try {
      return await Promise.race([this.inspect(target), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  async launch(item: WorkspaceItem): Promise<void> {
    const value = itemInput(item);
    if (this.platform !== 'win32')
      throw new WorkspaceError('Opening workspace items requires Windows 10 or Windows 11.');
    if (value.type !== 'url') {
      let information:
        Awaited<ReturnType<typeof stat>> | { isFile(): boolean; isDirectory(): boolean };
      try {
        information = await this.inspectWithTimeout(value.target);
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
          throw new WorkspaceError(`Path does not exist: ${value.target}`, 'NOT_FOUND');
        throw new WorkspaceError(`Cannot access this path: ${value.target}`);
      }
      if (value.type === 'folder' && !information.isDirectory())
        throw new WorkspaceError('The saved folder path is not a folder.');
      if (value.type !== 'folder' && !information.isFile())
        throw new WorkspaceError('The saved file or application path is not a file.');
    }
    if (value.type === 'application') {
      await this.run({
        executable: value.target,
        arguments: value.arguments,
        cwd: win32.dirname(value.target),
        environment: this.environment,
        waitForExit: false,
      });
      return;
    }
    const windowsDirectory =
      this.environment.SystemRoot || this.environment.WINDIR || 'C:\\Windows';
    if (value.type === 'folder') {
      await this.run({
        executable: win32.join(windowsDirectory, 'explorer.exe'),
        arguments: [value.target],
        environment: this.environment,
        waitForExit: false,
      });
      return;
    }
    await this.run({
      executable: win32.join(
        windowsDirectory,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      arguments: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', openTargetCommand],
      environment: { ...this.environment, CONTEXTDOCK_OPEN_TARGET: value.target },
      waitForExit: true,
    });
  }
}
