export const DEFAULT_CONFIG = Object.freeze({
  mode: "direct-mcp",
  controlEndpoint: "/api/v2/mcp/im_gateway_control",
  chatEndpoint: "/api/v2/mcp/im_gateway_chat",
  osgpEndpoint: "/gv/osgp",
  requestTimeoutMs: 20000,
  executorSessionID: "web-ui",
  executorRuntimeID: "web",
});

const STORAGE_KEY = "gv.imWeb.config.v1";

export function loadConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return normalizeConfig({ ...DEFAULT_CONFIG, ...stored });
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  const clean = normalizeConfig(config);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export function normalizeConfig(config) {
  const mode = config.mode === "osgp" ? "osgp" : "direct-mcp";
  return {
    mode,
    controlEndpoint: cleanPath(config.controlEndpoint, DEFAULT_CONFIG.controlEndpoint),
    chatEndpoint: cleanPath(config.chatEndpoint, DEFAULT_CONFIG.chatEndpoint),
    osgpEndpoint: String(config.osgpEndpoint || "").trim(),
    requestTimeoutMs: DEFAULT_CONFIG.requestTimeoutMs,
    executorSessionID: String(config.executorSessionID || DEFAULT_CONFIG.executorSessionID).trim() || DEFAULT_CONFIG.executorSessionID,
    executorRuntimeID: String(config.executorRuntimeID || DEFAULT_CONFIG.executorRuntimeID).trim(),
  };
}

function cleanPath(value, fallback) {
  const clean = String(value || "").trim();
  return clean || fallback;
}
