import { readShowToastPayload } from "@opensessiongateway/protocol-library/ws-protocol/ShowToast.js";

type QueryFactory = () => Record<string, unknown>;

export async function handleShowToast(
  ctx: any,
  query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const toast = readShowToastPayload(payload);
  const displayID = toast.displayID;
  const title = toast.title;
  const msg = toast.message;
  const subtitle = toast.subtitle || "Server";
  const variant = toast.variant || "info";
  const durationMs = toast.durationMs || 4000;

  if (!displayID) return { ok: false, error: "displayID is required" };

  if (msg) {
    await ctx?.client?.tui?.showToast?.({
      body: {
        title,
        message: msg,
        variant,
        duration: durationMs,
      },
      query: query(),
    }).catch(() => {});
  }

  return { ok: true, subtitle, displayID };
}
