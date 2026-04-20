import { ensureRuntimeDisplayBundle } from "@/lib/ClientModel/display/registry";
import { upsertPermissionAsked, upsertPermissionUpdated } from "@/lib/permission/registry";
import { upsertQuestionAsked, upsertQuestionUpdated } from "@/lib/question/registry";
import { ensureRuntimeInstanceWorkspaceBundle } from "@/lib/runtime-hub";
import { ensureRuntimeSessionBundle } from "@/lib/ClientModel/session/registry";
import {
  CLIENT_CONTENT_EXECUTEING_EVENT,
  PERMISSION_ASKED_EVENT,
  PERMISSION_UPDATED_EVENT,
  QUESTION_ASKED_EVENT,
  QUESTION_UPDATED_EVENT,
  readClientContentExecuteingPayload,
  readPermissionAskedPayload,
  readPermissionUpdatedPayload,
  readQuestionAskedPayload,
  readQuestionUpdatedPayload,
} from "@opensessiongateway/protocol-library";
import type { ListSessionRequestPayload } from "@opensessiongateway/protocol-library/ws-protocol/SessionList.js";

type HandleResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function field(value: unknown) {
  const next = text(value).replace(/\s+/g, " ");
  return JSON.stringify(next || "-");
}

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
      bundle.state = content.session?.state || null
      bundle.reason = content.session?.reason || null
      bundle.meta = content.session?.meta || null
    }
    const display = content.displayID ? ensureRuntimeDisplayBundle(queue.runtimeID, content.displayID) : null
    const sessionText = bundle?.sessionID || sessionID || "-"
    const titleText = sessionText === "-" ? "-" : title || "-"
    const statusText = sessionText === "-" ? "-" : [content.session?.state || "-", content.session?.reason || "-"].join(":")
    const meta = content.session?.meta && typeof content.session.meta === "object" ? content.session.meta as Record<string, unknown> : {}
    console.log(
      `[client content] runtime=${queue.runtimeID} display=${content.displayID || "-"} instanceWorkspace=${instanceWorkspaceDirectory || "-"} session=${sessionText} title=${field(titleText)} status=${statusText} subtitle=${field(meta.subtitle)} context=${field(meta.context)}`,
    )
    return {
      ok: true,
      data: {
        displayID: content.displayID || "",
        display: display?.displayID || null,
        instanceWorkspaceDirectory,
        sessionID: bundle?.sessionID || sessionID,
        title,
        state: content.session?.state || null,
        reason: content.session?.reason || null,
        meta: content.session?.meta || null,
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

  if (type === QUESTION_ASKED_EVENT) {
    const asked = readQuestionAskedPayload(payload);
    const record = upsertQuestionAsked(queue.runtimeID, asked);
    return {
      ok: true,
      data: {
        questionID: record.questionID,
        status: record.status,
        updatedAt: record.updatedAt,
      },
    };
  }

  if (type === QUESTION_UPDATED_EVENT) {
    const updated = readQuestionUpdatedPayload(payload);
    const record = upsertQuestionUpdated(queue.runtimeID, updated);
    return {
      ok: true,
      data: {
        questionID: record.questionID,
        status: record.status,
        updatedAt: record.updatedAt,
      },
    };
  }

  return { ok: true, accepted: true };
}
