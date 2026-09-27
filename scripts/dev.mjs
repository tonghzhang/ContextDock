import { createServer } from 'vite';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import electron from 'electron';
const server = await createServer();
await server.listen();
await build({
  entryPoints: { main: 'src/desktop/main.ts', preload: 'src/desktop/preload.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  bundle: true,
  external: ['electron'],
  sourcemap: true,
});
const env = { ...process.env, CONTEXTDOCK_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => void stop(code ?? 0));
child.on('error', (error) => {
  console.error(error.message);
  void stop(1);
});
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
