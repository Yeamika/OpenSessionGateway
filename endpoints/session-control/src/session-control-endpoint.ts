import WebSocket from 'ws';
import {
  LinkHandshake,
  createLinkHandshake,
  validateLinkHandshake,
  PROTOCOL_VERSION,
} from './link-handshake';
import {
  RouterMessage,
  RouterResponse,
  RouterOp,
  ROUTER_OPS,
  REQUIRED_PERMISSIONS,
  PermissionCheckResult,
} from './router-ops';
import { EventEmitter } from 'events';

export interface SessionControlConfig {
  routerUrl: string;
  peerId: string;
  metadata?: Record<string, unknown>;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'failed';

const DEFAULT_RECONNECT_INTERVAL = 3000;
const DEFAULT_MAX_RECONNECT = 10;

export class SessionControlEndpoint extends EventEmitter {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (resp: RouterResponse) => void; reject: (err: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  private msgCounter = 0;

  constructor(private config: SessionControlConfig) {
    super();
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting' || this.state === 'handshaking') {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.setState('connecting');

      try {
        this.ws = new WebSocket(this.config.routerUrl);
      } catch (err) {
        this.setState('failed');
        reject(err);
        return;
      }

      const connectTimeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.cleanup();
          this.setState('failed');
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.setState('handshaking');
        this.sendHandshake()
          .then(() => {
            this.setState('connected');
            this.reconnectAttempts = 0;
            this.emit('connected');
            resolve();
          })
          .catch((err) => {
            this.cleanup();
            this.setState('failed');
            reject(err);
          });
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(connectTimeout);
        this.setState('disconnected');
        this.emit('disconnected', code, reason.toString());
        this.rejectAllPending('Connection closed');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        this.emit('error', err);
        if (this.state === 'connecting' || this.state === 'handshaking') {
          this.cleanup();
          this.setState('failed');
          reject(err);
        }
      });
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    this.setState('disconnected');
  }

  async sendRouterOp(op: RouterOp, params?: Record<string, unknown>): Promise<RouterResponse> {
    if (this.state !== 'connected') {
      throw new Error(`Not connected (state: ${this.state})`);
    }

    const id = this.nextId();
    const msg: RouterMessage = { type: op, id, ...params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for op=${op} id=${id}`));
      }, 15000);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.send(msg);
    });
  }

  async addPrompt(sessionId: string, msg: string, source?: string): Promise<RouterResponse> {
    return this.sendRouterOp(ROUTER_OPS.CONTROL_ADD_PROMPT, {
      session_id: sessionId,
      message: msg,
      source: source ?? 'session-control-endpoint',
    });
  }

  async listSessions(): Promise<RouterResponse> {
    return this.sendRouterOp(ROUTER_OPS.SESSION_LIST);
  }

  async readSession(sessionId: string): Promise<RouterResponse> {
    return this.sendRouterOp(ROUTER_OPS.SESSION_READ, { session_id: sessionId });
  }

  async listRoutes(): Promise<RouterResponse> {
    return this.sendRouterOp(ROUTER_OPS.ROUTE_LIST);
  }

  async announceRoute(routeInfo: Record<string, unknown>): Promise<RouterResponse> {
    return this.sendRouterOp(ROUTER_OPS.ANNOUNCE_ROUTE, routeInfo);
  }

  async checkPermissions(): Promise<PermissionCheckResult> {
    const missing: string[] = [];
    for (const perm of REQUIRED_PERMISSIONS) {
      try {
        const resp = await this.sendRouterOp(perm, { _check: true });
        if (!resp.success) {
          missing.push(perm);
        }
      } catch {
        missing.push(perm);
      }
    }
    return {
      allowed: missing.length === 0,
      missing: missing.length > 0 ? missing : undefined,
    };
  }

  private async sendHandshake(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('No WebSocket'));
        return;
      }

      const handshake = createLinkHandshake(this.config.peerId, this.config.metadata);
      const handshakeTimeout = setTimeout(() => {
        reject(new Error('Handshake timeout'));
      }, 5000);

      const onHandshakeResponse = (data: WebSocket.Data) => {
        clearTimeout(handshakeTimeout);
        this.ws?.off('message', onHandshakeResponse);

        try {
          const resp = JSON.parse(data.toString()) as RouterResponse;
          if (resp.type === 'link_handshake_ack' && resp.success) {
            resolve();
          } else {
            reject(
              new Error(
                `Handshake rejected: ${resp.error ?? 'unknown'}`
              )
            );
          }
        } catch (err) {
          reject(err);
        }
      };

      this.ws.on('message', onHandshakeResponse);
      this.ws.send(JSON.stringify(handshake));
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    let msg: RouterResponse;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this.emit('error', new Error('Invalid JSON from router'));
      return;
    }

    if (msg.id && this.pendingRequests.has(msg.id as string)) {
      const pending = this.pendingRequests.get(msg.id as string)!;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msg.id as string);
      pending.resolve(msg);
    } else {
      this.emit('router-message', msg);
    }
  }

  private send(msg: RouterMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }
    this.ws.send(JSON.stringify(msg));
  }

  private nextId(): string {
    return `sc_${++this.msgCounter}_${Date.now()}`;
  }

  private setState(s: ConnectionState): void {
    const prev = this.state;
    this.state = s;
    this.emit('state-change', s, prev);
  }

  private cleanup(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`${reason} (pending id=${id})`));
    }
    this.pendingRequests.clear();
  }

  private scheduleReconnect(): void {
    const max = this.config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT;
    if (this.reconnectAttempts >= max) {
      this.setState('failed');
      this.emit('reconnect-failed');
      return;
    }

    const interval = this.config.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL;
    this.reconnectAttempts++;
    this.emit('reconnect-scheduled', this.reconnectAttempts, max);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, interval);
  }
}
