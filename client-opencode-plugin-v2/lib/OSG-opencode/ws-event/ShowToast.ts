import { readShowToastPayload } from "protocllibrary/ws-contract/ShowToast.js";

type QueryFactory = () => Record<string, unknown>;

export async function handleShowToast(
  ctx: any,
  query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const toast = readShowToastPayload(payload);
  const title = toast.title;
  const msg = toast.message;
  const subtitle = toast.subtitle || "Server";
  const variant = toast.variant || "info";
  const durationMs = toast.durationMs || 4000;

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

  return { ok: true, subtitle };
}
