import { createRequestRuntimePayload } from "@opensessiongateway/protocol-library";
import type { CurrentClientInfo } from "./CurrentClientInfo.js";
import { readCurrentSessionStateInfo } from "./CurrentClientInfo.js";
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
    state?: "idle" | "busy" | "waiting" | "stopped" | null;
    reason?: "completed" | "pending" | "tool" | "generating" | "reasoning" | "compacting" | "permission" | "question" | "aborted" | "error" | null;
    meta?: Record<string, unknown> | null;
  };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  const currentSessionState = currentInfo.sessionID === req.sessionID
    ? readCurrentSessionStateInfo(currentInfoRaw)
    : { state: null, reason: null, meta: null };

  const reportPayload: ReportPayload | null = sessionTarget
    ? {
        instanceWorkspaceDirectory: sessionTarget.instanceWorkspaceDirectory,
        session: {
          sessionID: sessionTarget.sessionID,
          title: sessionRow?.title,
          state: currentSessionState.state,
          reason: currentSessionState.reason,
          meta: currentSessionState.meta,
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
      state: currentSessionState.state,
      reason: currentSessionState.reason,
      meta: currentSessionState.meta,
      displayID: displayIDForTarget(input.query, currentInfo, req.sessionID) || null,
    },
  };
}
