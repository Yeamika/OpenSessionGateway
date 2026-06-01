import WebSocket from 'ws';
import { AdminRequestClient } from '../src/admin-request-client';
import { ROUTER_OPS } from '../src/router-ops';

const MOCK_ROUTER_PORT = 19877;
const MOCK_ROUTER_URL = `ws://127.0.0.1:${MOCK_ROUTER_PORT}`;

function createMockAdminRouter(
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

describe('AdminRequestClient', () => {
  let mockRouter: { server: WebSocket.Server; close: () => Promise<void> };

  afterEach(async () => {
    if (mockRouter) {
      await mockRouter.close();
    }
  });

  it('connects and completes handshake', async () => {
    mockRouter = createMockAdminRouter();

    const client = new AdminRequestClient({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
      adminPeerId: 'admin-request-client',
    });

    await client.connect();
    client.disconnect();
  });

  it('sends admin.request to grant a permission', async () => {
    let receivedMsg: any = null;
    mockRouter = createMockAdminRouter(undefined, (msg) => {
      receivedMsg = msg;
      return {
        type: msg.type + '_response',
        success: true,
        id: msg.id,
        granted: msg.operation,
      };
    });

    const client = new AdminRequestClient({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
      adminPeerId: 'admin-request-client',
    });

    await client.connect();
    const resp = await client.requestRuleChange(
      'session-control-endpoint',
      'control.add_prompt',
      true,
      'Needed for session prompt injection'
    );
    expect(resp.success).toBe(true);
    expect(receivedMsg.type).toBe('admin.request');
    expect(receivedMsg.action).toBe('grant');
    expect(receivedMsg.target_peer_id).toBe('session-control-endpoint');
    expect(receivedMsg.operation).toBe('control.add_prompt');
    expect(receivedMsg.reason).toBe('Needed for session prompt injection');
    client.disconnect();
  });

  it('sends admin.request to revoke a permission', async () => {
    let receivedMsg: any = null;
    mockRouter = createMockAdminRouter(undefined, (msg) => {
      receivedMsg = msg;
      return {
        type: msg.type + '_response',
        success: true,
        id: msg.id,
      };
    });

    const client = new AdminRequestClient({
      routerUrl: MOCK_ROUTER_URL,
      peerId: 'session-control-endpoint',
      adminPeerId: 'admin-request-client',
    });

    await client.connect();
    const resp = await client.requestRuleChange(
      'session-control-endpoint',
      'admin.rules.write',
      false,
      'Revoking unnecessary admin access'
    );
    expect(resp.success).toBe(true);
    expect(receivedMsg.action).toBe('revoke');
    client.disconnect();
  });
});
