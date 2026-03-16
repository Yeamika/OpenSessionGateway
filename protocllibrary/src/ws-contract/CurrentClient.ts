export type QueueShape = {
  runtimeID: string;
  hostName: string;
  events: Array<{ type?: string } | unknown>;
};

export type CurrentClientInfo = {
  runtimeID: string;
  sessionID: string;
  sessionTitle: string;
  status: string;
  cwd: string;
};

export type CurrentClientInfoCallbacks = {
  GetCurrentClientInfo?: () => Promise<Partial<CurrentClientInfo>> | Partial<CurrentClientInfo>;
};

export function createFallbackCurrentClientInfo(): CurrentClientInfo {
  return {
    runtimeID: "unknown",
    sessionID: "-",
    sessionTitle: "-",
    status: "-",
    cwd: "unknown",
  };
}
