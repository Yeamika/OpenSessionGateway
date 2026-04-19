import type { WebSocket } from "ws";

import type { ClientSessionMeta, ClientSessionReason, ClientSessionState, ClientSessionStatus } from "@opensessiongateway/protocol-library";

export type RuntimeStatus = "online" | "offline";

export type RuntimeEndpoint = {
  runtimeID: string;
  host: string | null;
  protocol: string | null;
  port: number | null;
  instanceWorkspaceDirectory: string | null;
};

export type RuntimeState = {
  sessionID: string | null;
  title: string | null;
  status: RuntimeStatus;
  lastHeartbeatAt: string | null;
  updatedAt: string;
  snapshot: Record<string, unknown> | null;
};

export type RuntimeConnection = {
  ws: WebSocket | null;
  connectedAt: Date | null;
  lastActiveAt: Date | null;
};

export type RuntimeSdkHandles = {
  runtime?: unknown;
  tui?: unknown;
};

export type RuntimeNode = {
  endpoint: RuntimeEndpoint;
  state: RuntimeState;
  connection: RuntimeConnection;
  sdk: RuntimeSdkHandles;
};

export type RuntimeClientView = {
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  port: number | null;
  runtimeHost: string | null;
  runtimeProtocol: string | null;
  instanceWorkspaceDirectory: string | null;
  title: string | null;
  status: RuntimeStatus;
  sessionStatus: ClientSessionStatus | null;
  sessionState: ClientSessionState | null;
  sessionReason: ClientSessionReason | null;
  sessionMeta: ClientSessionMeta | null;
  lastActiveTime: string | null;
  activeCount: number;
  lastHeartbeatAt: string | null;
  updatedAt: string;
};
