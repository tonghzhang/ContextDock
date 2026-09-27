import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
await mkdir('work', { recursive: true });
await build({
  entryPoints: ['src/desktop/credentials.ts'],
  outfile: 'work/native-credentials.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
});
const { promptForToken } = createRequire(import.meta.url)(
  path.resolve('work/native-credentials.cjs'),
);
const helper = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Probe {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string name);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string name);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, string text);
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(15)
$window = [IntPtr]::Zero
while ([DateTime]::UtcNow -lt $deadline -and $window -eq [IntPtr]::Zero) {
  $window = [Probe]::FindWindow([NullString]::Value, 'ContextDock Token Smoke')
  if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 150 }
}
if ($window -eq [IntPtr]::Zero) { exit 2 }
Start-Sleep -Milliseconds 400
if (-not [Probe]::IsWindowVisible($window)) { exit 3 }
$child = [IntPtr]::Zero
$edit = [IntPtr]::Zero
do {
  $child = [Probe]::FindWindowEx($window, $child, [NullString]::Value, [NullString]::Value)
  if ($child -eq [IntPtr]::Zero) { break }
  $class = New-Object Text.StringBuilder 256
  [Probe]::GetClassName($child, $class, 256) | Out-Null
  if ($class.ToString().Contains('.EDIT.')) { $edit = $child; break }
} while ($true)
if ($edit -eq [IntPtr]::Zero) { exit 4 }
$passwordCharacter = [Probe]::SendMessage($edit, 0xD2, [IntPtr]::Zero, $null)
if ($passwordCharacter -eq [IntPtr]::Zero) { exit 5 }
[Probe]::SendMessage($edit, 0xC, [IntPtr]::Zero, ('github_pat_' + 'fakeNativeProbe')) | Out-Null
$save = [Probe]::FindWindowEx($window, [IntPtr]::Zero, [NullString]::Value, 'Save probe')
if ($save -eq [IntPtr]::Zero) { exit 6 }
[Probe]::SendMessage($save, 0xF5, [IntPtr]::Zero, $null) | Out-Null
`;
const worker = spawn(
  path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoProfile', '-EncodedCommand', Buffer.from(helper, 'utf16le').toString('base64')],
  { windowsHide: true, stdio: 'ignore' },
);
const completed = new Promise((resolve, reject) => {
  worker.on('error', reject);
  worker.on('close', (code) =>
    code === 0 ? resolve() : reject(new Error('Native input probe failed with code ' + code)),
  );
});
const deadline = setTimeout(() => {
  worker.kill();
  process.exit(3);
}, 25000);
try {
  const [, token] = await Promise.all([
    completed,
    promptForToken({
      title: 'ContextDock Token Smoke',
      hint: 'Isolated test with a fake token.',
      save: 'Save probe',
      cancel: 'Cancel',
    }),
  ]);
  assert.equal(token === 'github_pat_' + 'fakeNativeProbe', true);
  console.log(
    'Native password dialog: visible window, masked input and main-process return passed.',
  );
} finally {
  clearTimeout(deadline);
  worker.kill();
}
