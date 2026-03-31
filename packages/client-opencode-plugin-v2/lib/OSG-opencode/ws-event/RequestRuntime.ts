import { createRequestRuntimePayload } from "@opensessiongateway/protocol-library";
import type { CurrentClientInfo } from "./CurrentClientInfo.js";
import type { SessionListResponse } from "./SessionList.js";
import { resolveTargetSessionContext } from "../runtime/target-context.js";

type QueryFactory = () => Record<string, unknown>;

type ReportPayload = {
  displayID?: string;
  instanceWorkspaceDirectory?: string;
  session?: {
    sessionID?: string;
    title?: string;
    status?: "idle" | "busy" | "error";
  };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSessionStatus(value: unknown): "idle" | "busy" | "error" | null {
  const status = text(value).toLowerCase();
  if (status === "idle") return "idle";
  if (status === "interrupted" || status === "error") return "error";
  if (status) return "busy";
  return null;
}

function currentStatusFromSessionStatus(value: "idle" | "busy" | "error" | null, fallback: string): string | null {
  if (value === "idle") return "Idle";
  if (value === "busy") return "Busy";
  if (value === "error") return "Interrupted";
  const current = text(fallback);
  return current || null;
}

function displayIDForTarget(query: QueryFactory, current: CurrentClientInfo, sessionID: string): string | undefined {
  if (current.sessionID !== sessionID) return undefined;
  const value = text(query()?.displayID);
  return value || undefined;
}

function readSessionRow(result: SessionListResponse, sessionID: string) {
  return result.sessions.find((item) => item.id === sessionID) || null;
}

export async function handleRequestRuntime(input: {
  ctx: any;
  query: QueryFactory;
  runtimeID: string;
  currentClientInfo: () => Promise<Record<string, unknown>>;
  listSession: (payload?: { list?: number; regex?: string }) => Promise<SessionListResponse>;
  reportClientContentExecuteing: (payload: ReportPayload, force?: boolean) => boolean;
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const req = createRequestRuntimePayload(input.payload || {});
  if (!req.sessionID) {
    return {
      ok: false,
      runtimeID: input.runtimeID,
      synced: false,
      session: {
        requested: true,
        exists: false,
        sessionID: "",
      },
      error: "RequestRuntime requires sessionID",
    };
  }

  const currentInfoRaw = await input.currentClientInfo().catch(() => ({}));
  const currentInfo = currentInfoRaw as CurrentClientInfo;
  const sessionTarget = await resolveTargetSessionContext(input.ctx, req.sessionID);
  const sessionList = await input.listSession({ list: 200 }).catch(() => ({ meta: { matched: 0 }, sessions: [] }));
  const sessionRow = readSessionRow(sessionList, req.sessionID);
  const sessionStatus = normalizeSessionStatus(sessionRow?.status);
  const currentStatus = currentStatusFromSessionStatus(sessionStatus, currentInfo.status);

  const reportPayload: ReportPayload | null = sessionTarget
    ? {
        instanceWorkspaceDirectory: sessionTarget.instanceWorkspaceDirectory,
        session: {
          sessionID: sessionTarget.sessionID,
          title: sessionRow?.title,
          status: sessionStatus || undefined,
        },
        ...(displayIDForTarget(input.query, currentInfo, sessionTarget.sessionID)
          ? { displayID: displayIDForTarget(input.query, currentInfo, sessionTarget.sessionID) }
          : {}),
      }
    : null;

  const synced = reportPayload ? input.reportClientContentExecuteing(reportPayload, true) : false;

  return {
    ok: true,
    runtimeID: input.runtimeID,
    synced,
    session: {
      requested: true,
      exists: Boolean(sessionTarget),
      sessionID: req.sessionID,
      title: sessionRow?.title,
      status: sessionStatus,
      displayID: displayIDForTarget(input.query, currentInfo, req.sessionID) || null,
    },
    currentStatus,
  };
}
