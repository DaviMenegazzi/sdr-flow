import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { devProxy, createDevProxy } from '../apps/web/vite.config.js';
import { ExecutionWebSocketServer } from '../apps/api/src/ws.js';

interface ViteProxyServer {
  close(): Promise<void>;
  httpServer?: Server;
  listen(): Promise<void>;
}

const requireFromWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));

function listen(server: Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function waitForMessage(socket: WebSocket, predicate: (message: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, 2_000);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

describe('Inbox realtime proxy routing', () => {
  let apiServer: Server | undefined;
  let apiSocketServer: ExecutionWebSocketServer | undefined;
  let vite: ViteProxyServer | undefined;

  afterEach(async () => {
    await vite?.close();
    apiSocketServer?.close();
    await new Promise<void>(resolve => apiServer?.close(() => resolve()) ?? resolve());
    vite = undefined;
    apiSocketServer = undefined;
    apiServer = undefined;
  });

  it('forwards the authenticated /ws endpoint through the Vite development server', () => {
    expect(devProxy['/api']).toMatchObject({ target: 'http://127.0.0.1:3001' });
    expect(devProxy['/ws']).toMatchObject({
      target: 'http://127.0.0.1:3001',
      ws: true,
    });
  });

  it('preserves websocket upgrades through the web container used by compose', () => {
    const nginx = readFileSync(new URL('../infra/nginx.conf', import.meta.url), 'utf8');
    const wsBlock = nginx.match(/location \/ws \{([\s\S]*?)\n  \}/)?.[1] ?? '';

    expect(wsBlock).toContain('proxy_pass http://api:3001;');
    expect(wsBlock).toContain('proxy_http_version 1.1;');
    expect(wsBlock).toContain('proxy_set_header Upgrade $http_upgrade;');
    expect(wsBlock).toContain('proxy_set_header Connection "upgrade";');
    expect(wsBlock).toContain('proxy_buffering off;');
  });

  it('delivers an authenticated Inbox event through the Vite /ws proxy without a REST refresh', async () => {
    apiServer = createServer();
    apiSocketServer = new ExecutionWebSocketServer();
    apiSocketServer.attach(apiServer, {
      authenticate: async token => token === 'inbox-jwt' ? { userId: 'user-a' } : null,
      authorize: async (userId, scope) => (
        userId === 'user-a' && scope.organizationId === 'org-1'
          ? { organizationId: 'org-1' }
          : null
      ),
    });
    const apiPort = await listen(apiServer);

    // Vite is a web-workspace development dependency rather than a root dependency. Resolve it
    // from the same package that owns vite.config.ts, exactly as `pnpm --filter @sdr/web dev` does.
    const viteModule = await import(pathToFileURL(requireFromWeb.resolve('vite')).href) as {
      createServer(config: unknown): Promise<ViteProxyServer>;
    };
    vite = await viteModule.createServer({
      configFile: false,
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: true,
        proxy: createDevProxy(`http://127.0.0.1:${apiPort}`),
      },
    });
    await vite.listen();
    const viteAddress = vite.httpServer?.address();
    const vitePort = typeof viteAddress === 'object' && viteAddress ? viteAddress.port : 0;

    const client = new WebSocket(`ws://127.0.0.1:${vitePort}/ws?token=inbox-jwt`);
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'subscribe', channel: 'inbox', organizationId: 'org-1' }));
    await waitForMessage(client, message => message.type === 'subscribed' && message.channel === 'inbox');

    apiSocketServer.broadcast({
      schemaVersion: 1,
      type: 'inbox:message.created',
      eventId: '00000000-0000-4000-8000-000000000001',
      organizationId: 'org-1',
      conversationId: '00000000-0000-4000-8000-000000000002',
      occurredAt: new Date().toISOString(),
      payload: { content: 'chegou sem refresh' },
    });
    const event = await waitForMessage(client, message => message.type === 'inbox:message.created');
    expect(event.payload).toEqual({ content: 'chegou sem refresh' });
    client.close();
  });
});
