import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all([
  bundle({
    entryPoints: {
      main: 'src/desktop/main.ts',
      preload: 'src/desktop/preload.ts',
      cli: 'src/cli/cli.ts',
      mcp: 'src/mcp/mcp.ts',
    },
    outdir: 'dist',
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    bundle: true,
    external: ['electron'],
    sourcemap: false,
    banner: { js: '/* ContextDock — MIT License */' },
  }),
  viteBuild(),
]);
console.log('Production desktop, CLI and MCP builds completed.');
