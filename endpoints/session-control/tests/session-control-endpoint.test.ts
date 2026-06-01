import WebSocket from 'ws';
import { SessionControlEndpoint } from '../src/session-control-endpoint';
import { ROUTER_OPS } from '../src/router-ops';
import { createLinkHandshake } from '../src/link-handshake';

const MOCK_ROUTER_PORT = 19876;
const MOCK_ROUTER_URL = `ws://127.0.0.1:${MOCK_ROUTER_PORT}`;

function createMockRouter(
  onHandshake?: (hs: any) => boolean,
  onRequest?: (msg: any) => any
): { server: WebSocket.Server; close: () => Promise<void> } {
  const server = new WebSocket.Server({ port: MOCK_ROUTER_PORT });

  server.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'link_handshake') {
        const ok = onHandshake ? onHandshake(msg) : true;
        ws.send(
          JSON.stringify({
            type: 'link_handshake_ack',
            success: ok,
            id: msg.id,
            ...(ok ? {} : { error: 'rejected' }),
          })
        );
        return;
      }

      if (onRequest) {
        const resp = onRequest(msg);
        ws.send(JSON.stringify(resp));
      } else {
        ws.send(
          JSON.stringify({
            type: msg.type + '_response',
            success: true,
            id: msg.id,
          })
        );
      }
    });
  });

  return {
    server,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe('SessionControlEndpoint', () => {
  let mockRouter: { server: WebSocket.Server; close: () => Promise<void> };

  afterEach(async () => {
    if (mockRouter) {
      await mockRouter.close();
    }
  });

  it('connects and completes LinkHandshake', async () => {
    mockRouter = createMockRouter();

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();
    expect(endpoint.connectionState).toBe('connected');
    endpoint.disconnect();
  });

  it('receives correct LinkHandshake with protocol_version and peer_id', async () => {
    let receivedHs: any = null;
    mockRouter = createMockRouter((hs) => {
      receivedHs = hs;
      return true;
    });

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
      metadata: { role: 'session-control' },
    });

    await endpoint.connect();
    expect(receivedHs).toBeTruthy();
    expect(receivedHs.type).toBe('link_handshake');
    expect(receivedHs.protocol_version).toBe(1);
    expect(receivedHs.peer_id).toBe('session-control-endpoint');
    expect(receivedHs.metadata.role).toBe('session-control');
    expect('capabilities' in receivedHs).toBe(false);
    expect('role' in receivedHs).toBe(false);
    endpoint.disconnect();
  });

  it('rejects connection on handshake failure', async () => {
    mockRouter = createMockRouter(() => false);

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await expect(endpoint.connect()).rejects.toThrow('Handshake rejected');
    expect(endpoint.connectionState).toBe('failed');
  });

  it('sends control.add_prompt through router', async () => {
    let receivedMsg: any = null;
    mockRouter = createMockRouter(undefined, (msg) => {
      receivedMsg = msg;
      return {
        type: msg.type + '_response',
        success: true,
        id: msg.id,
      };
    });

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();

    const resp = await endpoint.addPrompt('sess-123', 'Hello session', 'test-source');
    expect(resp.success).toBe(true);
    expect(receivedMsg.type).toBe('control.add_prompt');
    expect(receivedMsg.session_id).toBe('sess-123');
    expect(receivedMsg.message).toBe('Hello session');
    expect(receivedMsg.source).toBe('test-source');
    endpoint.disconnect();
  });

  it('sends session.list through router', async () => {
    let receivedMsg: any = null;
    mockRouter = createMockRouter(undefined, (msg) => {
      receivedMsg = msg;
      return {
        type: msg.type + '_response',
        success: true,
        id: msg.id,
        sessions: ['sess-1', 'sess-2'],
      };
    });

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();
    const resp = await endpoint.listSessions();
    expect(resp.success).toBe(true);
    expect(receivedMsg.type).toBe('session.list');
    endpoint.disconnect();
  });

  it('sends session.read through router', async () => {
    mockRouter = createMockRouter(undefined, (msg) => ({
      type: msg.type + '_response',
      success: true,
      id: msg.id,
      session_id: msg.session_id,
    }));

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();
    const resp = await endpoint.readSession('sess-1');
    expect(resp.success).toBe(true);
    expect(resp.session_id).toBe('sess-1');
    endpoint.disconnect();
  });

  it('sends route.list through router', async () => {
    mockRouter = createMockRouter(undefined, (msg) => ({
      type: msg.type + '_response',
      success: true,
      id: msg.id,
      routes: [],
    }));

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();
    const resp = await endpoint.listRoutes();
    expect(resp.success).toBe(true);
    endpoint.disconnect();
  });

  it('sends announce.route through router', async () => {
    mockRouter = createMockRouter(undefined, (msg) => ({
      type: msg.type + '_response',
      success: true,
      id: msg.id,
    }));

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();
    const resp = await endpoint.announceRoute({ endpoint: 'session-control', path: '/sessions' });
    expect(resp.success).toBe(true);
    endpoint.disconnect();
  });

  it('checkPermissions reports missing permissions', async () => {
    mockRouter = createMockRouter(undefined, (msg) => {
      if (msg._check) {
        const allowed = msg.type !== 'control.add_prompt';
        return {
          type: msg.type + '_response',
          success: allowed,
          id: msg.id,
          ...(allowed ? {} : { error: 'permission denied' }),
        };
      }
      return { type: msg.type + '_response', success: true, id: msg.id };
    });

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();
    const result = await endpoint.checkPermissions();
    expect(result.allowed).toBe(false);
    expect(result.missing).toContain('control.add_prompt');
    endpoint.disconnect();
  });

  it('checkPermissions returns allowed when all granted', async () => {
    mockRouter = createMockRouter(undefined, (msg) => ({
      type: msg.type + '_response',
      success: true,
      id: msg.id,
    }));

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();
    const result = await endpoint.checkPermissions();
    expect(result.allowed).toBe(true);
    expect(result.missing).toBeUndefined();
    endpoint.disconnect();
  });

  it('rejects sendRouterOp when not connected', async () => {
    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await expect(endpoint.listSessions()).rejects.toThrow('Not connected');
  });

  it('emits disconnected on server close', async () => {
    mockRouter = createMockRouter();

    const endpoint = new SessionControlEndpoint({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
    });

    await endpoint.connect();
    const disconnectPromise = new Promise<number>((resolve) => {
      endpoint.on('disconnected', (code) => resolve(code));
    });

    for (const client of mockRouter.server.clients) {
      client.close();
    }

    const code = await disconnectPromise;
    expect(typeof code).toBe('number');
  });
});
