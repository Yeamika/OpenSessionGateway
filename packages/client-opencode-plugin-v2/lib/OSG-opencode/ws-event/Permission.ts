import {
  createPermissionAskedPayload,
  createPermissionUpdatedPayload,
  readResolvePermissionRequestPayload,
  type PermissionDecision,
} from "@opensessiongateway/protocol-library";
import type { CurrentClientInfo } from "./CurrentClientInfo.js";
import type { InstanceWorkspaceInfo } from "../runtime/instance-workspace-info.js";
import { resolveTargetSessionContext } from "../runtime/target-context.js";

type QueryFactory = () => Record<string, unknown>;

function client(ctx: any): any {
  return ctx?.client?._client;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readTime(value: unknown): string {
  const direct = text(value);
  if (direct) return direct;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function firstString(src: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(src[key]);
    if (value) return value;
  }
  return "";
}

function nestedSource(event: Record<string, unknown>): Record<string, unknown> {
  const props = record(event.properties);
  const candidates = [
    record(props.permission),
    record(props.ask),
    record(props.request),
    record(props.info),
    props,
  ];
  return candidates.find((item) => Object.keys(item).length > 0) || {};
}

function displayID(query: QueryFactory): string | null {
  const value = text(query()?.displayID);
  return value || null;
}

function choices(src: Record<string, unknown>) {
  const value = src.choices;
  if (!Array.isArray(value)) return [];
  const out = value
    .map((item): { value: PermissionDecision; label?: string } | null => {
      const row = record(item);
      const val = text(row.value || row.action).toLowerCase();
      if (val !== "approve" && val !== "deny" && val !== "cancel") return null;
      return { value: val as PermissionDecision, label: text(row.label) || undefined };
    })
    .filter((item): item is { value: PermissionDecision; label?: string } => item !== null);
  return out;
}

function defaultAction(src: Record<string, unknown>): PermissionDecision | null {
  const value = text(src.defaultAction).toLowerCase();
  if (value === "approve" || value === "deny" || value === "cancel") return value;
  return null;
}

function ok(value: unknown): boolean {
  if (value === true) return true;
  const src = record(value);
  return src.data === true;
}

export function buildPermissionAskedPayload(input: {
  event: Record<string, unknown>;
  currentClientInfo: CurrentClientInfo;
  instanceWorkspace: InstanceWorkspaceInfo | null;
  query: QueryFactory;
}) {
  const src = nestedSource(input.event);
  const eventID = text(input.event.id || input.event.eventID || input.event.requestID);
  const permissionID = firstString(src, ["permissionID", "id", "requestID"]);
  const sessionID = firstString(src, ["sessionID"]);
  const kind = firstString(src, ["permission", "kind", "type"]);
  const title = firstString(src, ["title", "label", "name", "permission"]);
  if (!permissionID || !sessionID || !kind || !title) return null;
  const description =
    firstString(src, ["description", "message", "reason"]) ||
    firstString(record(src.message), ["text", "content", "description"]) ||
    null;

  return createPermissionAskedPayload({
    permissionID,
    sessionID,
    displayID: displayID(input.query),
    kind,
    title,
    description,
    detail: {
      eventType: text(input.event.type) || "permission.asked",
      event: input.event,
      properties: record(input.event.properties),
    },
    choices: choices(src),
    defaultAction: defaultAction(src),
    requestedAt: readTime(src.requestedAt || src.createdAt || input.event.time),
    expiresAt: text(src.expiresAt) || null,
    supersedesPermissionID: firstString(src, ["supersedesPermissionID", "supersedes"]) || null,
    correlationID: firstString(src, ["correlationID", "correlationId"]) || eventID || null,
    dedupeKey: firstString(src, ["dedupeKey"]) || null,
  });
}

type ResolveArgs = {
  permissionID: string;
  action: PermissionDecision;
  directory: string;
  reason?: string | null;
  actor?: string | null;
  correlationID?: string | null;
};

function replyFromDecision(action: PermissionDecision): "once" | "reject" {
  return action === "approve" ? "once" : "reject";
}

export async function handleResolvePermissionRequest(
  ctx: any,
  payload: Record<string, unknown>,
  resolvePermissionRoute: (permissionID: string) => { sessionID: string } | null,
): Promise<Record<string, unknown>> {
  const req = readResolvePermissionRequestPayload(payload);
  const sessionID = text(record(payload).sessionID);
  if (!req.permissionID) {
    return { ok: false, permissionID: "", action: req.action, error: "permissionID is required" };
  }

  const route = resolvePermissionRoute(req.permissionID);
  const target = await resolveTargetSessionContext(ctx, route?.sessionID || sessionID);
  if (!target?.instanceWorkspaceDirectory) {
    return { ok: false, permissionID: req.permissionID, action: req.action, error: "target permission context not found" };
  }

  try {
    const raw = client(ctx);
    if (!raw || typeof raw.post !== "function") {
      return { ok: false, permissionID: req.permissionID, action: req.action, error: "permission client unavailable" };
    }
    const response = await Promise.resolve(raw.post({
      url: `/permission/${encodeURIComponent(req.permissionID)}/reply`,
      query: { directory: target.instanceWorkspaceDirectory },
      headers: { "Content-Type": "application/json" },
      body: { reply: replyFromDecision(req.action), message: req.reason || undefined },
    }));
    if (!ok(response)) {
      return {
        ok: false,
        permissionID: req.permissionID,
        action: req.action,
        error: "permission reply failed",
      };
    }
    return {
      ok: true,
      permissionID: req.permissionID,
      action: req.action,
    };
  } catch (error) {
    return {
      ok: false,
      permissionID: req.permissionID,
      action: req.action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildPermissionResolvedPayload(input: {
  permissionID: string;
  sessionID?: string | null;
  action: PermissionDecision;
  actor?: string | null;
  reason?: string | null;
  correlationID?: string | null;
  ok: boolean;
  error?: string | null;
}) {
  return createPermissionUpdatedPayload({
    permissionID: input.permissionID,
    sessionID: input.sessionID || null,
    status: input.ok
      ? input.action === "approve"
        ? "approved"
        : input.action === "deny"
          ? "denied"
          : "cancelled"
      : "failed",
    updatedAt: new Date().toISOString(),
    actor: input.actor || null,
    reason: input.reason || null,
    message: input.error || null,
    supersededByPermissionID: null,
    correlationID: input.correlationID || null,
  });
}
