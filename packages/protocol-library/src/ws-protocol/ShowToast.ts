export type ShowToastVariant = "info" | "success" | "error";

export type ShowToastPayload = {
  displayID: string;
  title: string;
  message: string;
  subtitle?: string;
  variant?: ShowToastVariant;
  durationMs?: number;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createShowToastPayload(payload: {
  displayID?: string;
  title?: string;
  message?: string;
  subtitle?: string;
  variant?: string;
  durationMs?: number;
}): ShowToastPayload {
  const variantRaw = normalizeString(payload.variant).toLowerCase();
  const variant: ShowToastVariant =
    variantRaw === "success" || variantRaw === "error" ? variantRaw : "info";

  const durationRaw = Number(payload.durationMs);
  return {
    displayID: normalizeString(payload.displayID),
    title: normalizeString(payload.title),
    message: typeof payload.message === "string" ? payload.message : "",
    subtitle: normalizeString(payload.subtitle) || undefined,
    variant,
    durationMs: Number.isFinite(durationRaw) && durationRaw > 0 ? Math.floor(durationRaw) : undefined,
  };
}

export function readShowToastPayload(payload: unknown): Required<Pick<ShowToastPayload, "title" | "message">> & ShowToastPayload {
  const src = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const normalized = createShowToastPayload({
    title: typeof src.title === "string" ? src.title : undefined,
    displayID: typeof src.displayID === "string" ? src.displayID : undefined,
    message: typeof src.message === "string" ? src.message : undefined,
    subtitle: typeof src.subtitle === "string" ? src.subtitle : undefined,
    variant: typeof src.variant === "string" ? src.variant : undefined,
    durationMs: typeof src.durationMs === "number" ? src.durationMs : undefined,
  });
  return {
    ...normalized,
    displayID: normalized.displayID,
    title: normalized.title || "Timer",
    message: normalized.message,
    subtitle: normalized.subtitle,
    variant: normalized.variant,
    durationMs: normalized.durationMs,
  };
}
