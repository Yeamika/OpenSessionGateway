import type {
  GatewayChatSummary,
  GatewayMemberIDType,
  GatewayResourceType,
  GatewayUserIDType,
} from "../../src/types.js";

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean === "1" || clean === "true" || clean === "yes" || clean === "on") return true;
    if (clean === "0" || clean === "false" || clean === "no" || clean === "off") return false;
  }
  return fallback;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function json(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export async function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve());
    req.on("error", reject);
  });
  return Buffer.concat(chunks);
}

export async function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (!body.length) return {};
  const parsed = JSON.parse(body.toString("utf8"));
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

export function previewFromContent(msgType: string, content: string): string {
  if (msgType === "text") {
    try {
      const parsed = JSON.parse(content) as { text?: unknown };
      if (typeof parsed.text === "string") return parsed.text.trim();
    } catch {
      // fall through
    }
  }
  if (msgType === "image") return "[image]";
  if (msgType === "file") return "[file]";
  if (msgType === "audio") return "[audio]";
  if (msgType === "media") return "[media]";
  return content.trim();
}

export function normalizeResourceType(value: unknown): GatewayResourceType | "" {
  const clean = asString(value);
  if (clean === "image" || clean === "file" || clean === "audio" || clean === "media") return clean;
  return "";
}

export function normalizeUserIDType(value: unknown): GatewayUserIDType {
  if (value === "user_id" || value === "union_id" || value === "open_id") return value;
  return "open_id";
}

export function normalizeMemberIDType(value: unknown): GatewayMemberIDType {
  if (value === "user_id" || value === "union_id" || value === "open_id" || value === "app_id") return value;
  return "open_id";
}

export function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => asString(item)).filter(Boolean))];
}

export function emptyChat(chatID: string, name: string): GatewayChatSummary {
  return {
    chatID,
    name: name || chatID,
    description: "Local diagnostic IM chat",
    avatar: "",
    chatStatus: "active",
    chatType: "group",
    chatMode: "group",
    ownerID: "local-owner",
    ownerIDType: "open_id",
    tenantKey: "local",
    external: false,
    userCount: 0,
    botCount: 1,
    lastMessageTime: null,
    lastMessageType: null,
    lastMessagePreview: "",
    detailError: "",
    updatedAt: nowIso(),
  };
}
