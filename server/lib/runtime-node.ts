import type { WebSocket } from "ws";

export type RuntimeStatus = "online" | "stale" | "offline";

export type RuntimeEndpoint = {
  runtimeID: string;
  host: string | null;
  protocol: string | null;
  port: number | null;
  workspace: string | null;
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
  port: number | null;
  runtimeHost: string | null;
  runtimeProtocol: string | null;
  workspace: string | null;
  title: string | null;
  status: RuntimeStatus;
  lastHeartbeatAt: string | null;
  updatedAt: string;
};
