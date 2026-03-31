import path from "node:path";
import type { CurrentClientInfo as SharedCurrentClientInfo } from "@opensessiongateway/protocol-library/ws-protocol/CurrentClient.js";

export type CurrentClientInfo = Pick<SharedCurrentClientInfo, "sessionID" | "sessionTitle" | "status" | "cwd">;

export function normalizeAbsoluteCwd(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  const absolute = path.isAbsolute(text) ? text : path.resolve(text);
  if (!absolute || absolute === "/") return "";
  return absolute;
}

export function createInitialCurrentClientInfo(directory: unknown): CurrentClientInfo {
  const initialCwd = normalizeAbsoluteCwd(directory);
  return {
    sessionID: "",
    sessionTitle: "",
    status: "Idle",
    cwd: initialCwd || "unknown",
  };
}

export function getCurrentClientInfoSnapshot(state: CurrentClientInfo): CurrentClientInfo {
  return { ...state };
}

export function statusFromSdk(statusType: unknown): string {
  if (statusType === "busy") return "Busy";
  if (statusType === "retry") return "Interrupted";
  return "Idle";
}

export function ensureSessionInfo(state: CurrentClientInfo, sessionID: unknown): boolean {
  const id = typeof sessionID === "string" ? sessionID.trim() : "";
  if (!id) return false;
  const changed = state.sessionID !== id;
  state.sessionID = id;
  if (changed) {
    state.sessionTitle = "";
  }
  return changed;
}

function extractSessionTitle(props: Record<string, unknown>): string {
  const directTitle = typeof props.title === "string" ? props.title.trim() : "";
  if (directTitle) return directTitle;

  const directSessionTitle = typeof props.sessionTitle === "string" ? props.sessionTitle.trim() : "";
  if (directSessionTitle) return directSessionTitle;

  const info = props.info && typeof props.info === "object" ? (props.info as Record<string, unknown>) : {};
  const infoTitle = typeof info.title === "string" ? info.title.trim() : "";
  if (infoTitle) return infoTitle;

  const session = props.session && typeof props.session === "object" ? (props.session as Record<string, unknown>) : {};
  const sessionTitle = typeof session.title === "string" ? session.title.trim() : "";
  if (sessionTitle) return sessionTitle;

  return "";
}

function extractSessionID(props: Record<string, unknown>): string {
  const direct = typeof props.sessionID === "string" ? props.sessionID.trim() : "";
  if (direct) return direct;

  const info = props.info && typeof props.info === "object" ? (props.info as Record<string, unknown>) : {};
  const infoID = typeof info.id === "string" ? info.id.trim() : "";
  if (infoID) return infoID;

  const session = props.session && typeof props.session === "object" ? (props.session as Record<string, unknown>) : {};
  return typeof session.id === "string" ? session.id.trim() : "";
}

function sessionEvent(type: unknown): boolean {
  return type === "session.created"
    || type === "session.updated"
    || type === "session.deleted"
    || type === "session.status"
    || type === "session.idle"
    || type === "session.error"
}

export function applyEventToCurrentClientInfo(
  state: CurrentClientInfo,
  event: unknown,
): { selected: boolean; shouldRefreshTitle: boolean } {
  const src = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const type = src.type;
  const props = src.properties && typeof src.properties === "object" ? (src.properties as Record<string, unknown>) : {};
  let shouldRefreshTitle = false;

  if (type === "tui.session.select") {
    const eventCwd = normalizeAbsoluteCwd(props.directory);
    if (eventCwd) {
      state.cwd = eventCwd;
    }
    const sessionID = typeof props.sessionID === "string" ? props.sessionID.trim() : "";
    if (sessionID) {
      const changed = ensureSessionInfo(state, sessionID);
      return { selected: true, shouldRefreshTitle: changed || !state.sessionTitle };
    }
    return { selected: false, shouldRefreshTitle: false };
  }

  const eventSessionID = sessionEvent(type) ? extractSessionID(props) : "";
  const eventCwd = normalizeAbsoluteCwd(props.directory);
  if (eventCwd) {
    state.cwd = eventCwd;
  }
  if (eventSessionID && !state.sessionID) {
    const changed = ensureSessionInfo(state, eventSessionID);
    if (changed || !state.sessionTitle) {
      shouldRefreshTitle = true;
    }
  }

  if (type === "session.created" || type === "session.updated") {
    if (eventSessionID) {
      const changed = ensureSessionInfo(state, eventSessionID);
      if (changed || !state.sessionTitle) {
        shouldRefreshTitle = true;
      }
    }
    const title = extractSessionTitle(props);
    if (title) {
      state.sessionTitle = title;
      shouldRefreshTitle = false;
    } else if (state.sessionID) {
      shouldRefreshTitle = true;
    }
    return { selected: false, shouldRefreshTitle };
  }

  if (type === "session.deleted") {
    const info = props.info && typeof props.info === "object" ? (props.info as Record<string, unknown>) : {};
    const deletedID = typeof info.id === "string" ? info.id.trim() : "";
    if (deletedID && deletedID === state.sessionID) {
      state.sessionTitle = "";
    }
    return { selected: false, shouldRefreshTitle: false };
  }

  if (type === "session.status") {
    if (eventSessionID) {
      const changed = ensureSessionInfo(state, eventSessionID);
      if (changed || !state.sessionTitle) {
        shouldRefreshTitle = true;
      }
    }
    const statusObj = props.status && typeof props.status === "object" ? (props.status as Record<string, unknown>) : {};
    state.status = statusFromSdk(statusObj.type);
    return { selected: false, shouldRefreshTitle };
  }

  if (type === "session.idle") {
    state.status = "Idle";
    return { selected: false, shouldRefreshTitle };
  }

  if (type === "permission.asked" || type === "session.error") {
    state.status = "Interrupted";
    return { selected: false, shouldRefreshTitle };
  }

  return { selected: false, shouldRefreshTitle };
}
