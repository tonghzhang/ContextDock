import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => {
  const nonce = randomBytes(16).toString('base64');
  return {
    root: 'src/renderer',
    base: './',
    plugins: [
      react(),
      {
        name: 'contextdock-development-csp',
        transformIndexHtml(html) {
          if (command !== 'serve') return html;
          return html
            .replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
            .replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`);
        },
      },
    ],
    html: command === 'serve' ? { cspNonce: nonce } : {},
    build: { outDir: '../../dist/renderer', emptyOutDir: true },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  };
});
