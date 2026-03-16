import { createGetSessionMsgRequest, type GetSessionMsgItem, type GetSessionMsgResponse } from "protocllibrary/ws-contract/GetSessionMsg.js";

type QueryFactory = () => Record<string, unknown>;

function readRegexArg(src: Record<string, unknown>): RegExp | null {
  const text = typeof src.regex === "string" ? src.regex.trim() : "";
  if (!text) return null;
  try {
    return new RegExp(text);
  } catch {
    return null;
  }
}

function statusLabel(raw: unknown): "busy" | "idle" | "interrupted" {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (text === "busy") return "busy";
  if (text === "retry" || text === "interrupted") return "interrupted";
  return "idle";
}

function messageContent(msg: Record<string, unknown>): string {
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  const out: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    const part = p as Record<string, unknown>;
    const text = typeof part.text === "string" ? part.text.trim() : "";
    if (text) out.push(text);
  }
  if (out.length > 0) return out.join("\n");

  const direct = typeof msg.content === "string" ? msg.content.trim() : "";
  if (direct) return direct;
  return "";
}

export async function handleGetSessionMsg(
  ctx: any,
  query: QueryFactory,
  runtimeID: string,
  payload: Record<string, unknown>,
): Promise<GetSessionMsgResponse | (GetSessionMsgResponse & { error: string })> {
  const { sessionID, size } = createGetSessionMsgRequest(payload);
  const regex = readRegexArg(payload);
  if (!sessionID) {
    return {
      runtimeID,
      sessionID: "",
      realsize: 0,
      list: [],
      status: "interrupted",
      error: "sessionID is required",
    };
  }

  const runtimeQuery = query() || {};
  const [messagesResult, statusResult] = await Promise.all([
    ctx?.client?.session?.messages?.({
      path: { id: sessionID },
      query: { ...runtimeQuery, limit: Math.max(size * 5, size) },
    }).catch(() => null),
    ctx?.client?.session?.status?.({ query: runtimeQuery }).catch(() => null),
  ]);

  const statusMap = statusResult && !statusResult.error && statusResult.data && typeof statusResult.data === "object"
    ? (statusResult.data as Record<string, unknown>)
    : {};
  const status = statusLabel(statusMap[sessionID]);

  const source = messagesResult && !messagesResult.error && Array.isArray(messagesResult.data)
    ? messagesResult.data
    : [];
  const matched: GetSessionMsgItem[] = [];
  for (const raw of source) {
    if (!raw || typeof raw !== "object") continue;
    const msg = raw as Record<string, unknown>;
    const content = messageContent(msg);
    if (regex && !regex.test(content)) continue;
    const info = msg.info && typeof msg.info === "object" ? (msg.info as Record<string, unknown>) : {};
    matched.push({
      id: typeof msg.id === "string" ? msg.id : "",
      role: typeof info.role === "string" ? info.role : "",
      content,
      time:
        (typeof msg.createdAt === "string" && msg.createdAt) ||
        (typeof msg.updatedAt === "string" && msg.updatedAt) ||
        "",
    });
  }

  const list = matched.slice(-size);
  return {
    runtimeID,
    sessionID,
    realsize: matched.length,
    list,
    status,
  };
}
