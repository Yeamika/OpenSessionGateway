import { ensureRuntimeDisplayBundle } from "@/lib/ClientModel/display/registry";
import { upsertPermissionAsked, upsertPermissionUpdated } from "@/lib/permission/registry";
import { ensureRuntimeInstanceWorkspaceBundle } from "@/lib/runtime-hub";
import { ensureRuntimeSessionBundle } from "@/lib/ClientModel/session/registry";
import {
  CLIENT_CONTENT_EXECUTEING_EVENT,
  PERMISSION_ASKED_EVENT,
  PERMISSION_UPDATED_EVENT,
  readClientContentExecuteingPayload,
  readPermissionAskedPayload,
  readPermissionUpdatedPayload,
} from "@opensessiongateway/protocol-library";
import type { ListSessionRequestPayload } from "@opensessiongateway/protocol-library/ws-protocol/SessionList.js";

type HandleResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export async function handleWsEvent(
  queue: { runtimeID: string; hostName: string; events: unknown[] },
  type: string,
  payload: Record<string, unknown>,
  emitToQueue?: (runtimeID: string, eventType: string, data?: unknown, timeoutMs?: number) => Promise<unknown>,
): Promise<HandleResult> {
  void emitToQueue;
  if (type === "ListSession") {
    return {
      ok: true,
      data: payload as ListSessionRequestPayload,
    };
  }

  if (type === CLIENT_CONTENT_EXECUTEING_EVENT) {
    const content = readClientContentExecuteingPayload(payload)
    const instanceWorkspaceDirectory = content.instanceWorkspaceDirectory || ""
    const sessionID = content.session?.sessionID || ""
    const title = content.session?.title || ""
    const status = content.session?.status || ""

    if (instanceWorkspaceDirectory)
      ensureRuntimeInstanceWorkspaceBundle(
        queue.runtimeID,
        instanceWorkspaceDirectory,
        instanceWorkspaceDirectory,
      )

    const bundle = sessionID ? ensureRuntimeSessionBundle(queue.runtimeID, sessionID) : null
    if (bundle) {
      bundle.lastActiveTime = new Date().toISOString()
      bundle.activeCount += 1
      bundle.displayID = content.displayID || null
      bundle.title = title || null
      bundle.status = status === "idle" || status === "busy" || status === "error" ? status : null
    }
    const display = content.displayID ? ensureRuntimeDisplayBundle(queue.runtimeID, content.displayID) : null
    const sessionText = bundle?.sessionID || sessionID || "-"
    const titleText = sessionText === "-" ? "-" : title || "-"
    const statusText = sessionText === "-" ? "-" : status || "-"
    console.log(
      `[client content] runtime=${queue.runtimeID} display=${content.displayID || "-"} instanceWorkspace=${instanceWorkspaceDirectory || "-"} session=${sessionText} title=${titleText} status=${statusText}`,
    )
    return {
      ok: true,
      data: {
        displayID: content.displayID || "",
        display: display?.displayID || null,
        instanceWorkspaceDirectory,
        sessionID: bundle?.sessionID || sessionID,
        title,
        status,
      },
    }
  }

  if (type === PERMISSION_ASKED_EVENT) {
    const asked = readPermissionAskedPayload(payload);
    const record = upsertPermissionAsked(queue.runtimeID, asked);
    return {
      ok: true,
      data: {
        permissionID: record.permissionID,
        status: record.status,
        updatedAt: record.updatedAt,
      },
    };
  }

  if (type === PERMISSION_UPDATED_EVENT) {
    const updated = readPermissionUpdatedPayload(payload);
    const record = upsertPermissionUpdated(queue.runtimeID, updated);
    return {
      ok: true,
      data: {
        permissionID: record.permissionID,
        status: record.status,
        updatedAt: record.updatedAt,
      },
    };
  }

  return { ok: true, accepted: true };
}
