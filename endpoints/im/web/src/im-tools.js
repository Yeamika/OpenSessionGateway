import { itemsOf } from "./state.js";

export function createImGatewayClient(transport) {
  const withExecutor = (args = {}) => ({ ExecutorSessionID: window.__imExecutorSessionID || "web-ui", ExecutorRuntimeID: window.__imExecutorRuntimeID || "web", ...args });
  const control = (tool, args) => transport.call("control", tool, withExecutor(args));
  const chat = (tool, args) => transport.call("chat", tool, withExecutor(args));
  return {
    getGatewayInfo: () => control("GetGatewayInfo", {}),
    listProviders: () => control("ListProviders", {}),
    listAccounts: async () => itemsOf(await control("ListAccounts", {})),
    upsertAccount: (input) => control("UpsertAccount", input),
    listAccountChats: async (input) => itemsOf(await control("ListAccountChats", { ...input, limit: 30, refresh: true })),
    listAccountChatMembers: async (input) => itemsOf(await control("ListAccountChatMembers", { ...input, limit: 100 })),
    listSessionBindings: async () => itemsOf(await control("ListSessionBindings", {})),
    upsertSessionBinding: (input) => control("UpsertSessionBinding", input),
    listRoutes: async () => itemsOf(await control("ListRoutes", {})),
    upsertRoute: (input) => control("UpsertRoute", input),
    listRouteMessages: async (routeID) => itemsOf(await chat("ListRouteMessages", { routeID, limit: 30, refresh: true })),
    sendRouteTextMessage: (routeID, text) => chat("SendRouteTextMessage", { routeID, text }),
    requestUpload: (type, routeID) => chat("RequestUpload", { type, routeID }),
  };
}

export function parseJsonObject(text) {
  const clean = String(text || "").trim();
  if (!clean) return {};
  const value = JSON.parse(clean);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON config must be an object");
  return value;
}

export function formDataObject(form) {
  const data = new FormData(form);
  const out = {};
  for (const [key, value] of data.entries()) out[key] = typeof value === "string" ? value.trim() : value;
  for (const input of form.querySelectorAll('input[type="checkbox"]')) out[input.name] = input.checked;
  return out;
}
