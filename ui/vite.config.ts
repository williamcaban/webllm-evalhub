import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `npm run dev` serves the UI on :5173 and forwards /mcp and /config.json to the local cors-proxy.py
// (python3 -I cors-proxy.py --config evalhub-chat.config.json). The proxy refuses foreign Origin headers
// (DNS-rebinding defence), so the dev server drops Origin on the forwarded request.
const PROXY = process.env.EVALHUB_PROXY ?? 'http://127.0.0.1:8787';
const viaProxy: ProxyOptions = {
  target: PROXY,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on('proxyReq', (req) => req.removeHeader('origin'));
  },
};

export default defineConfig({
  plugins: [react()],
  // The model worker uses dynamic imports, which need the ES module format.
  worker: { format: 'es' },
  server: { proxy: { '/mcp': viaProxy, '/config.json': viaProxy } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
