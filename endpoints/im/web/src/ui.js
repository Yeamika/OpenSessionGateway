import { formDataObject, parseJsonObject } from "./im-tools.js";
import { saveConfig } from "./config.js";
import { selectedRoute } from "./state.js";

export function bindUi({ store, client }) {
  const $ = (id) => document.getElementById(id);
  const configForm = $("configForm");
  fillConfig(configForm, store.get().config);
  window.__imExecutorSessionID = store.get().config.executorSessionID;
  window.__imExecutorRuntimeID = store.get().config.executorRuntimeID;
  store.subscribe((state) => render(state, $));

  configForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextConfig = saveConfig(formDataObject(configForm));
    window.__imExecutorSessionID = nextConfig.executorSessionID;
    window.__imExecutorRuntimeID = nextConfig.executorRuntimeID;
    store.patch({ config: nextConfig });
    store.log("Configuration updated.");
  });
  $("refreshAll").addEventListener("click", () => refreshAll(store, client));
  document.body.addEventListener("click", (event) => handleActionClick(event, store, client));
  bindForms(store, client, $);
  render(store.get(), $);
}

export async function refreshAll(store, client) {
  await safe(store, "refresh all", async () => {
    const [gatewayInfo, providers, accounts, bindings, routes] = await Promise.all([
      client.getGatewayInfo(), client.listProviders(), client.listAccounts(), client.listSessionBindings(), client.listRoutes(),
    ]);
    store.patch({ gatewayInfo, providers, accounts, bindings, routes });
  });
}

function bindForms(store, client, $) {
  $("accountForm").addEventListener("submit", submit(store, async (form) => {
    const input = formDataObject(form);
    await client.upsertAccount({ ...input, config: parseJsonObject(input.config) });
    await refreshAll(store, client);
  }));
  $("chatLookupForm").addEventListener("submit", submit(store, async (form) => {
    store.patch({ chats: await client.listAccountChats(formDataObject(form)) });
  }));
  $("membersForm").addEventListener("submit", submit(store, async (form) => {
    store.patch({ members: await client.listAccountChatMembers(formDataObject(form)) });
  }));
  $("bindingForm").addEventListener("submit", submit(store, async (form) => {
    await client.upsertSessionBinding(formDataObject(form));
    await refreshAll(store, client);
  }));
  $("routeForm").addEventListener("submit", submit(store, async (form) => {
    const route = await client.upsertRoute(formDataObject(form));
    store.patch({ activeRouteID: route.routeID || store.get().activeRouteID });
    await refreshAll(store, client);
  }));
  $("messageForm").addEventListener("submit", submit(store, async (form) => {
    const route = selectedRoute(store.get());
    if (!route) throw new Error("Select a route first.");
    await client.sendRouteTextMessage(route.routeID, formDataObject(form).text);
    form.reset();
    store.patch({ messages: await client.listRouteMessages(route.routeID) });
  }));
}

async function handleActionClick(event, store, client) {
  const button = event.target.closest("button[data-action], .selectable .item");
  if (!button) return;
  const action = button.dataset.action;
  if (button.dataset.routeId) {
    store.patch({ activeRouteID: button.dataset.routeId, messages: [] });
    return;
  }
  if (action === "refresh-control") return refreshAll(store, client);
  if (action === "refresh-messages") return refreshMessages(store, client);
  if (action === "request-upload-image") return requestUpload(store, client, "image");
  if (action === "request-upload-file") return requestUpload(store, client, "file");
}

async function refreshMessages(store, client) {
  await safe(store, "refresh messages", async () => {
    const route = selectedRoute(store.get());
    if (!route) throw new Error("Select a route first.");
    store.patch({ messages: await client.listRouteMessages(route.routeID) });
  });
}

async function requestUpload(store, client, type) {
  await safe(store, `request ${type} upload`, async () => {
    const route = selectedRoute(store.get());
    const uploadInfo = await client.requestUpload(type, route?.routeID || "");
    store.patch({ uploadInfo });
  });
}

function submit(store, fn) {
  return async (event) => {
    event.preventDefault();
    await safe(store, "submit", () => fn(event.currentTarget));
  };
}

async function safe(store, label, fn) {
  try {
    await fn();
    store.log(`${label}: ok`);
  } catch (error) {
    store.log(`${label}: ${error.message || String(error)}`, "error");
  }
}

function render(state, $) {
  $("summaryCards").innerHTML = cards(state);
  $("accountsList").innerHTML = list(state.accounts, accountTitle);
  $("chatsList").innerHTML = list(state.chats, (x) => [x.name || x.chatID, x.chatID]);
  $("membersList").innerHTML = list(state.members, (x) => [x.name || x.memberID, x.memberIDType]);
  $("bindingsList").innerHTML = list(state.bindings, (x) => [x.sessionBindingID, `${x.runtimeID || "-"}/${x.sessionID || "-"}`]);
  $("routesList").innerHTML = routeList(state.routes, state.activeRouteID);
  $("messagesList").innerHTML = messages(state.messages);
  $("activeRoute").textContent = state.activeRouteID || "No route selected";
  $("uploadInfo").textContent = state.uploadInfo ? JSON.stringify(state.uploadInfo, null, 2) : "";
  $("statusLog").innerHTML = state.log.map((x) => `<span class="${x.level === "error" ? "error" : ""}">[${x.time}] ${escapeHtml(x.message)}</span>`).join("\n");
}

function cards(state) {
  const info = state.gatewayInfo || {};
  const rows = [["Providers", state.providers.length || info.providers?.length || 0], ["Accounts", state.accounts.length], ["Bindings", state.bindings.length], ["Routes", state.routes.length]];
  return rows.map(([label, value]) => `<div class="card"><strong>${value}</strong>${label}</div>`).join("");
}

function list(items, titleOf) {
  if (!items.length) return `<p class="hint">No items.</p>`;
  return items.map((item) => {
    const [title, detail] = titleOf(item);
    return `<div class="item"><b>${escapeHtml(title || "-")}</b><small>${escapeHtml(detail || "")}</small></div>`;
  }).join("");
}

function routeList(routes, activeRouteID) {
  if (!routes.length) return `<p class="hint">No routes.</p>`;
  return routes.map((route) => `<button class="item ${route.routeID === activeRouteID ? "active" : ""}" data-route-id="${escapeAttr(route.routeID)}"><b>${escapeHtml(route.chatName || route.chatID)}</b><small>${escapeHtml(route.routeID)} · ${escapeHtml(route.sessionBindingID || "no binding")}</small></button>`).join("");
}

function messages(items) {
  if (!items.length) return `<p class="hint">No messages loaded.</p>`;
  return items.map((item) => `<article class="message"><b>${escapeHtml(item.senderID || item.senderType || "message")}</b><small>${escapeHtml(item.messageID || "")}</small><div class="preview">${escapeHtml(item.preview || item.content || "")}</div></article>`).join("");
}

function accountTitle(item) { return [item.displayName || item.accountID, `${item.provider}/${item.accountID}`]; }
function fillConfig(form, config) { for (const [key, value] of Object.entries(config)) if (form.elements[key]) form.elements[key].value = value; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])); }
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }
