import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Keep the browser on one origin in development: InboxPage connects to `/ws` on the
// current host, just like it does behind the production reverse proxy. Without this
// explicit upgrade proxy, REST snapshots work through `/api` but realtime Inbox events
// never reach the authenticated API socket.
export function createDevProxy(target = 'http://127.0.0.1:3001') {
  return {
    '/api': {
      target,
      changeOrigin: true,
    },
    '/ws': {
      target,
      changeOrigin: true,
      ws: true,
    },
  };
}

export const devProxy = createDevProxy();

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'SUPABASE_'],
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  server: { port: 5173, strictPort: true, proxy: devProxy },
});
