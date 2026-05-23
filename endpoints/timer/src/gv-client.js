import { hello, responseEnvelope, timerFiredEnvelope } from "./osgp-wire.js";

export function createGvClient(config) {
  let currentConfig = config;
  let ws = null;
  const state = { status: "disconnected", lastError: "", lastEnvelope: null };

  function connect() {
    if (!currentConfig.gvRouterUrl || ws) return;
    state.status = "connecting";
    ws = new WebSocket(currentConfig.gvRouterUrl);
    ws.addEventListener("open", () => {
      state.status = "connected";
      state.lastError = "";
      ws.send(JSON.stringify(hello(currentConfig)));
    });
    ws.addEventListener("message", (event) => handleMessage(event.data));
    ws.addEventListener("close", () => {
      ws = null;
      state.status = "disconnected";
    });
    ws.addEventListener("error", () => {
      state.lastError = "WebSocket error";
    });
  }

  async function sendTimerFired(timer) {
    const message = timerFiredEnvelope(currentConfig, timer);
    state.lastEnvelope = message;
    if (!ws || state.status !== "connected") {
      throw new Error("GV router is not connected");
    }
    ws.send(JSON.stringify(message));
    return message;
  }

  function sendResponse(request, result, error) {
    if (!ws || state.status !== "connected") return false;
    ws.send(JSON.stringify(responseEnvelope(currentConfig, request, result, error)));
    return true;
  }

  function handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === "ping") ws?.send(JSON.stringify({ type: "pong" }));
    if (msg.type === "envelope") state.lastEnvelope = msg;
  }

  function updateConfig(nextConfig) {
    const oldUrl = currentConfig.gvRouterUrl;
    currentConfig = nextConfig;
    if (ws && oldUrl !== nextConfig.gvRouterUrl) {
      ws.close();
      ws = null;
      state.status = "disconnected";
    }
    if (nextConfig.gvRouterUrl && (!ws || state.status === "disconnected")) connect();
  }

  return {
    connect,
    updateConfig,
    sendTimerFired,
    sendResponse,
    state: () => ({ ...state, enabled: Boolean(currentConfig.gvRouterUrl) }),
  };
}
