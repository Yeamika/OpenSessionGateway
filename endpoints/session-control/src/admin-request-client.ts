import WebSocket from 'ws';
import { createLinkHandshake, PROTOCOL_VERSION } from './link-handshake';
import { RouterMessage, RouterResponse, ROUTER_OPS } from './router-ops';

export interface AdminRequestClientConfig {
  routerUrl: string;
  peerId: string;
  adminPeerId: string;
}

export class AdminRequestClient {
  private ws: WebSocket | null = null;
  private msgCounter = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (resp: RouterResponse) => void; reject: (err: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();

  constructor(private config: AdminRequestClientConfig) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.routerUrl);

      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error('Admin client connection timeout'));
      }, 10000);

      this.ws.on('open', async () => {
        clearTimeout(timeout);
        try {
          await this.handshake();
          resolve();
        } catch (err) {
          this.cleanup();
          reject(err);
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async requestRuleChange(
    targetPeerId: string,
    grantOp: string,
    allow: boolean,
    reason: string
  ): Promise<RouterResponse> {
    return this.sendRequest(ROUTER_OPS.ADMIN_REQUEST, {
      action: allow ? 'grant' : 'revoke',
      target_peer_id: targetPeerId,
      operation: grantOp,
      reason,
    });
  }

  disconnect(): void {
    this.cleanup();
  }

  private async handshake(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('No WebSocket'));

      const hs = createLinkHandshake(this.config.adminPeerId, {
        role: 'admin-request-client',
        manages: [this.config.peerId],
      });

      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout'));
      }, 5000);

      const onResp = (data: WebSocket.Data) => {
        clearTimeout(timeout);
        this.ws?.off('message', onResp);
        try {
          const resp = JSON.parse(data.toString());
          if (resp.success) resolve();
          else reject(new Error(`Handshake rejected: ${resp.error}`));
        } catch (err) {
          reject(err);
        }
      };

      this.ws.on('message', onResp);
      this.ws.send(JSON.stringify(hs));
    });
  }

  private sendRequest(
    type: string,
    params: Record<string, unknown>
  ): Promise<RouterResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const id = `admin_${++this.msgCounter}_${Date.now()}`;
    const msg: RouterMessage = { type, id, ...params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Admin request timeout id=${id}`));
      }, 15000);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(msg));
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const msg = JSON.parse(data.toString()) as RouterResponse;
      if (msg.id && this.pendingRequests.has(msg.id as string)) {
        const pending = this.pendingRequests.get(msg.id as string)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.id as string);
        pending.resolve(msg);
      }
    } catch {}
  }

  private cleanup(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();
  }
}
