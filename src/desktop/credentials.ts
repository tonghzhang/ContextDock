import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { GitHubConnection, GitHubStatus } from '../shared/transfer';
import { connectionSchema } from '../transfer/github-provider';
interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
const storedSchema = connectionSchema.extend({ encryptedToken: z.string().optional() });
export class Credentials {
  constructor(
    private readonly directory: string,
    private readonly encryption: Encryption,
  ) {}
  private async read() {
    try {
      return storedSchema.parse(
        JSON.parse(await readFile(join(this.directory, 'github-connection.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { owner: '', repository: '', branch: 'main' };
      throw new Error('GitHub settings could not be read. Save the connection again.');
    }
  }
  async status(): Promise<GitHubStatus> {
    const value = await this.read();
    return {
      owner: value.owner,
      repository: value.repository,
      branch: value.branch,
      hasToken: Boolean(value.encryptedToken),
    };
  }
  private async write(value: GitHubConnection & { encryptedToken?: string }): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temp = join(this.directory, 'credentials-' + randomUUID() + '.tmp');
    try {
      await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await rename(temp, join(this.directory, 'github-connection.json'));
    } finally {
      await rm(temp, { force: true });
    }
  }
  async save(config: GitHubConnection): Promise<GitHubStatus> {
    const parsed = connectionSchema.safeParse(config);
    if (!parsed.success) throw new Error('Enter a valid GitHub owner, repository, and branch.');
    const old = await this.read();
    await this.write({ ...parsed.data, encryptedToken: old.encryptedToken });
    return this.status();
  }
  async storeToken(token: string): Promise<void> {
    if (!this.encryption.isEncryptionAvailable())
      throw new Error('Secure token storage is unavailable.');
    if (!/^github_pat_[A-Za-z0-9_]+$/u.test(token))
      throw new Error('Enter a GitHub fine-grained personal access token.');
    const value = await this.read();
    if (!value.owner || !value.repository) throw new Error('Save the GitHub connection first.');
    await this.write({
      ...value,
      encryptedToken: this.encryption.encryptString(token).toString('base64'),
    });
  }
  async token(): Promise<string> {
    const value = await this.read();
    if (!value.encryptedToken) throw new Error('Set a GitHub token in Settings.');
    try {
      if (!this.encryption.isEncryptionAvailable()) throw new Error();
      return this.encryption.decryptString(Buffer.from(value.encryptedToken, 'base64'));
    } catch {
      throw new Error('The saved token cannot be decrypted. Set it again on this computer.');
    }
  }
}
// A native Windows password dialog keeps plaintext out of Electron's renderer and IPC.
// Only this fixed script, never the token, is passed on the command line.
export function promptForToken(labels: {
  title: string;
  hint: string;
  save: string;
  cancel: string;
}): Promise<string | null> {
  if (process.platform !== 'win32') throw new Error('Native token entry requires Windows.');
  const strings = Object.fromEntries(
    Object.entries(labels).map(([key, value]) => [key, Buffer.from(value).toString('base64')]),
  );
  const psText = (key: string) =>
    "[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + strings[key] + "'))";
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ContextDockWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command); }'
$form = New-Object Windows.Forms.Form
$form.Text = ${psText('title')}
$form.Width = 560
$form.Height = 220
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$label = New-Object Windows.Forms.Label
$label.Text = ${psText('hint')}
$label.SetBounds(20,20,500,45)
$inputBox = New-Object Windows.Forms.TextBox
$inputBox.UseSystemPasswordChar = $true
$inputBox.SetBounds(20,75,500,25)
$okButton = New-Object Windows.Forms.Button
$okButton.Text = ${psText('save')}
$okButton.DialogResult = [Windows.Forms.DialogResult]::OK
$okButton.SetBounds(310,115,100,30)
$cancelButton = New-Object Windows.Forms.Button
$cancelButton.Text = ${psText('cancel')}
$cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
$cancelButton.SetBounds(420,115,100,30)
$form.Controls.AddRange(@($label,$inputBox,$okButton,$cancelButton))
$form.AcceptButton = $okButton
$form.CancelButton = $cancelButton
$form.Add_Shown({ [ContextDockWindow]::ShowWindow($form.Handle, 5) | Out-Null; $form.Activate(); $inputBox.Focus() | Out-Null })
if ($form.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($inputBox.Text) }
$inputBox.Clear()
$form.Dispose()
`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let value = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      value += chunk;
      if (value.length > 4096) child.kill();
    });
    child.on('error', () => reject(new Error('Native token entry could not open.')));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error('Native token entry could not open.'));
      else resolve(value.trim() || null);
      value = '';
    });
  });
}
