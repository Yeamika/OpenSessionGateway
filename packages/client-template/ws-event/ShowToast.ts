import { readShowToastPayload } from "@opensessiongateway/protocol-library/ws-protocol/ShowToast.js";

type WriteLog = (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => void | Promise<void>;

export async function showToast(
  payload: Record<string, unknown>,
  writeLog?: WriteLog,
): Promise<Record<string, unknown>> {
  const normalized = readShowToastPayload(payload);
  if (writeLog) {
    await Promise.resolve(
      writeLog("info", "server toast", {
        title: normalized.title,
        message: normalized.message,
        subtitle: normalized.subtitle || undefined,
        variant: normalized.variant,
      }),
    ).catch(() => {});
  }
  return {
    accepted: true,
    shown: true,
    title: normalized.title,
    message: normalized.message,
    variant: normalized.variant,
  };
}
