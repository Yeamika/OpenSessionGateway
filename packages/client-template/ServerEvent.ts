import { listAvailableModels } from "./ws-event/ListAvailableModels.js";
import { abortSessionOfClient } from "./ws-event/AbortSessionOfClient.js";
import { getSessionMsg } from "./ws-event/GetSessionMsg.js";
import { listLastUsedModelOfSession } from "./ws-event/ListLastUsedModelOfSession.js";
import { renameSessionOfClient } from "./ws-event/RenameSessionOfClient.js";
import { listSession } from "./ws-event/SessionList.js";
import { setClientDisplaySession } from "./ws-event/SetClientDisplaySession.js";
import { addPromot } from "./ws-event/AddPromot.js";
import { createNewSession } from "./ws-event/CreateNewSession.js";
import { requestInstanceWorkspaceReload } from "./ws-event/RequestInstanceWorkspaceReload.js";
import { showToast } from "./ws-event/ShowToast.js";
import { requestRuntime } from "./ws-event/RequestRuntime.js";
import { resolvePermissionRequest } from "./ws-event/ResolvePermissionRequest.js";
import type { TemplateRuntimeState } from "./runtime-state.js";
import { REQUEST_RUNTIME_EVENT, RESOLVE_PERMISSION_REQUEST_EVENT, type ClientContentExecuteingPayload, readWsEnvelope } from "@opensessiongateway/protocol-library";

function normalizeType(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type ServerEventDeps = {
  state: TemplateRuntimeState;
  reportClientContentExecuteing: (payload?: ClientContentExecuteingPayload, force?: boolean) => boolean;
  writeLog?: (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => void | Promise<void>;
};

function shouldReportContent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const src = value as Record<string, unknown>;
  return src.ok === true;
}

export async function handleServerEvent(message: unknown, deps: ServerEventDeps): Promise<unknown> {
  const envelope = readWsEnvelope(message);
  const type = normalizeType(envelope.type);
  const payload = envelope.data && typeof envelope.data === "object" ? (envelope.data as Record<string, unknown>) : {};

  if (type === "listsession") {
    return listSession(deps.state, payload);
  }

  if (type === "renamesessionofclient") {
    const result = await renameSessionOfClient(deps.state, payload);
    if (shouldReportContent(result)) deps.reportClientContentExecuteing();
    return result;
  }
  if (type === "setclientdisplaysession") {
    const result = await setClientDisplaySession(deps.state, payload);
    if (shouldReportContent(result)) deps.reportClientContentExecuteing();
    return result;
  }
  if (type === "abortsessionofclient") {
    const result = await abortSessionOfClient(deps.state, payload);
    if (shouldReportContent(result)) deps.reportClientContentExecuteing();
    return result;
  }
  if (type === "listavailablemodels") {
    return listAvailableModels(deps.state, payload);
  }
  if (type === "listlastusedmodelofsession") {
    return listLastUsedModelOfSession(deps.state, payload);
  }
  if (type === "getsessionmsg") {
    return getSessionMsg(deps.state, payload);
  }
  if (type === "addpromot") {
    const result = await addPromot(deps.state, payload);
    if (shouldReportContent(result)) deps.reportClientContentExecuteing();
    return result;
  }
  if (type === "createnewsession") {
    const result = await createNewSession(deps.state, payload);
    if (shouldReportContent(result)) deps.reportClientContentExecuteing();
    return result;
  }
  if (type === "requestinstanceworkspacereload") {
    const result = await requestInstanceWorkspaceReload(deps.state, payload);
    if (shouldReportContent(result)) deps.reportClientContentExecuteing();
    return result;
  }
  if (type === "servertoast") {
    return showToast(payload, deps.writeLog);
  }
  if (type === normalizeType(RESOLVE_PERMISSION_REQUEST_EVENT)) {
    return resolvePermissionRequest(deps.state, payload);
  }
  if (type === normalizeType(REQUEST_RUNTIME_EVENT)) {
    return requestRuntime(
      deps.state,
      (runtimePayload) => deps.reportClientContentExecuteing(runtimePayload, true),
      payload,
    );
  }

  return { accepted: true };
}
