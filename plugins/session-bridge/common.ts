import type { NextRequest } from "next/server.js";

export function normalizeInitParams(payload: unknown, req: NextRequest): { runtimeID: string } {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const runtimeIDRaw =
    typeof obj.runtimeID === "string"
      ? obj.runtimeID
      : typeof req.nextUrl.searchParams.get("runtimeID") === "string"
        ? String(req.nextUrl.searchParams.get("runtimeID"))
        : "";
  return {
    runtimeID: runtimeIDRaw.trim(),
  };
}

export function runtimeIDFromQuery(req: NextRequest): string {
  const fromRuntime = req.nextUrl.searchParams.get("runtimeID");
  if (typeof fromRuntime === "string" && fromRuntime.trim()) return fromRuntime.trim();
  return "";
}

export function normalizeList(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export function normalizeRegex(value: unknown): RegExp | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source) return null;
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

export function normalizeStringArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function busyLabel(value: string | null): "idle" | "busy" {
  const text = (value || "").trim().toLowerCase();
  return text === "busy" ? "busy" : "idle";
}

export function readLastActiveTime(value: { lastActiveTime?: string | null } | null | undefined): string {
  return typeof value?.lastActiveTime === "string" ? value.lastActiveTime : "";
}

export function readActiveCount(value: { activeCount?: number } | null | undefined): number {
  const count = Number(value?.activeCount);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function textResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
