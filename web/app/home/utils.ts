import { CARD_MARGIN, GOLDEN_ANGLE, WORKSPACE_LABEL_W, WORKSPACE_MARGIN_X, WORKSPACE_MARGIN_Y, WORLD_MIN_H, WORLD_MIN_W } from "./constants";
import type { CardPosition, ClientItem, Viewport } from "./types";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export function worldSize(viewWidth: number, viewHeight: number, runtimeCount = 1, workspaceCount = 1) {
  const runtimeBoost = Math.min(3.9, 2.2 + Math.max(0, runtimeCount - 1) * 0.18);
  const workspaceBoost = Math.min(1.25, 1 + Math.max(0, workspaceCount - 1) * 0.04);
  return {
    width: Math.max(WORLD_MIN_W, Math.round(viewWidth * runtimeBoost)),
    height: Math.max(WORLD_MIN_H, Math.round(viewHeight * 2.05 * workspaceBoost)),
  };
}

export function clampViewport(viewport: Viewport, viewWidth: number, viewHeight: number, worldWidth: number, worldHeight: number): Viewport {
  const scaledWidth = worldWidth * viewport.scale;
  const scaledHeight = worldHeight * viewport.scale;

  const x = scaledWidth <= viewWidth
    ? (viewWidth - scaledWidth) / 2
    : clamp(viewport.x, viewWidth - scaledWidth, 0);
  const y = scaledHeight <= viewHeight
    ? (viewHeight - scaledHeight) / 2
    : clamp(viewport.y, viewHeight - scaledHeight, 0);

  return { ...viewport, x, y };
}

export function centerViewport(scale: number, viewWidth: number, viewHeight: number, worldWidth: number, worldHeight: number): Viewport {
  return clampViewport(
    {
      x: (viewWidth - worldWidth * scale) / 2,
      y: (viewHeight - worldHeight * scale) / 2,
      scale,
    },
    viewWidth,
    viewHeight,
    worldWidth,
    worldHeight,
  );
}

export function viewportFromWorldRect(
  x: number,
  y: number,
  scale: number,
  viewWidth: number,
  viewHeight: number,
  worldWidth: number,
  worldHeight: number,
) {
  return clampViewport(
    {
      x: -x * scale,
      y: -y * scale,
      scale,
    },
    viewWidth,
    viewHeight,
    worldWidth,
    worldHeight,
  );
}

export function simpleHash(str: string) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return Math.abs(h);
}

export function pseudoRandom(seed: number, step: number) {
  const x = Math.sin(seed * 0.001 + step * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function sessionLampColor(state: ClientItem["sessionState"], runtime: ClientItem["status"]) {
  if (runtime === "offline") return "#7f8a9a";
  if (state === "stopped") return "#ff5f56";
  if (state === "waiting") return "#ffbf47";
  if (state === "busy") return "#4da6ff";
  if (state === "idle") return "#41ff99";
  if (runtime === "stale") return "#ffbf47";
  return "#7f8a9a";
}

export function statusLabel(status: ClientItem["status"]) {
  if (status === "online") return "online";
  if (status === "stale") return "stale";
  return "offline";
}

export function workspaceKey(client: ClientItem) {
  const workspace = client.workspace?.trim();
  return workspace || "No Workspace";
}

export function runtimeKey(client: ClientItem) {
  const runtimeID = client.runtimeID?.trim();
  return runtimeID || "Unknown Runtime";
}

export function workspaceGroupKey(client: ClientItem) {
  return `${runtimeKey(client)}::${workspaceKey(client)}`;
}

export function workspaceLabel(value: string | null | undefined) {
  const clean = value?.trim();
  if (!clean) return "No Workspace";
  if (clean === "No Workspace") return clean;
  const normalized = clean.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || clean;
}

export function shortRuntimeLabel(runtimeID: string) {
  const clean = runtimeID.trim();
  if (clean.length <= 16) return clean;
  return `${clean.slice(0, 8)}...${clean.slice(-6)}`;
}

export function clientSize(client: ClientItem) {
  if (!client.displayID) {
    return client.synthetic
      ? { width: 132, height: 88 }
      : { width: 148, height: 104 };
  }
  return client.synthetic
    ? { width: 238, height: 144 }
    : { width: 300, height: 172 };
}

export function centerOf(position: CardPosition, width: number, height: number) {
  return {
    x: position.x + width / 2,
    y: position.y + height / 2,
  };
}

export function positionFromCenter(x: number, y: number, width: number, height: number) {
  return {
    x: x - width / 2,
    y: y - height / 2,
  };
}

export function clampCardPosition(position: CardPosition, width: number, height: number, areaWidth: number, areaHeight: number) {
  const minX = CARD_MARGIN;
  const minY = 78;
  const maxX = Math.max(minX, areaWidth - width - CARD_MARGIN);
  const maxY = Math.max(minY, areaHeight - height - CARD_MARGIN);
  return {
    x: clamp(position.x, minX, maxX),
    y: clamp(position.y, minY, maxY),
  };
}

export function workspaceTarget(workspace: string, index: number, total: number, width: number, height: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const minX = 72;
  const maxX = Math.max(minX, width - WORKSPACE_MARGIN_X);
  const minY = WORKSPACE_MARGIN_Y;
  const maxY = Math.max(minY, height - WORKSPACE_MARGIN_X);
  const seed = simpleHash(workspace || `workspace-${index}`);

  if (total <= 1) {
    return {
      x: clamp(centerX + (pseudoRandom(seed, 11) - 0.5) * Math.min(width * 0.2, 260), minX, maxX),
      y: clamp(centerY + (pseudoRandom(seed, 12) - 0.5) * Math.min(height * 0.16, 180), minY, maxY),
    };
  }

  const ringSize = 6;
  const ring = Math.floor(index / ringSize);
  const ringIndex = index % ringSize;
  const countInRing = Math.min(ringSize, total - ring * ringSize);
  const angleOffset = pseudoRandom(seed, 1) * Math.PI * 2;
  const angleJitter = (pseudoRandom(seed, 2) - 0.5) * (Math.PI / 6);
  const angle = angleOffset + (ringIndex / Math.max(1, countInRing)) * Math.PI * 2 + angleJitter;
  const spreadBaseX = Math.max(180, width * (0.22 + ring * 0.08));
  const spreadBaseY = Math.max(140, height * (0.18 + ring * 0.06));
  const spreadX = spreadBaseX * (0.85 + pseudoRandom(seed, 3) * 0.32);
  const spreadY = spreadBaseY * (0.85 + pseudoRandom(seed, 4) * 0.28);

  return {
    x: clamp(centerX + Math.cos(angle) * spreadX, minX, maxX),
    y: clamp(centerY + Math.sin(angle) * spreadY, minY, maxY),
  };
}

export function runtimeTarget(runtimeID: string, index: number, total: number, width: number, height: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const seed = simpleHash(runtimeID || `runtime-${index}`);
  const minX = 180;
  const maxX = Math.max(minX, width - 180);
  const minY = 150;
  const maxY = Math.max(minY, height - 150);

  if (total <= 1) {
    return {
      x: clamp(centerX + (pseudoRandom(seed, 31) - 0.5) * Math.min(width * 0.16, 220), minX, maxX),
      y: clamp(centerY + (pseudoRandom(seed, 32) - 0.5) * Math.min(height * 0.14, 180), minY, maxY),
    };
  }

  const ringSize = 5;
  const ring = Math.floor(index / ringSize);
  const ringIndex = index % ringSize;
  const countInRing = Math.min(ringSize, total - ring * ringSize);
  const angle = pseudoRandom(seed, 41) * Math.PI * 2 + (ringIndex / Math.max(1, countInRing)) * Math.PI * 2;
  const radiusX = Math.max(260, width * (0.19 + ring * 0.07));
  const radiusY = Math.max(180, height * (0.14 + ring * 0.05));

  return {
    x: clamp(centerX + Math.cos(angle) * radiusX, minX, maxX),
    y: clamp(centerY + Math.sin(angle) * radiusY, minY, maxY),
  };
}

export function workspaceTargetInRuntime(
  workspace: string,
  runtimeID: string,
  runtimeAnchor: CardPosition,
  index: number,
  total: number,
  width: number,
  height: number,
) {
  const seed = simpleHash(`${runtimeID}:${workspace}`);
  const angle = pseudoRandom(seed, 51) * Math.PI * 2 + (index / Math.max(1, total)) * Math.PI * 2;
  const radiusBase = 96 + Math.floor(index / 6) * 54 + pseudoRandom(seed, 52) * 18;
  return clampWorkspaceAnchor(
    {
      x: runtimeAnchor.x + Math.cos(angle) * radiusBase * 1.15,
      y: runtimeAnchor.y + Math.sin(angle) * radiusBase * 0.78,
    },
    width,
    height,
  );
}

export function clampRuntimeAnchor(anchor: CardPosition, width: number, height: number) {
  return {
    x: clamp(anchor.x, 180, Math.max(180, width - 180)),
    y: clamp(anchor.y, 150, Math.max(150, height - 150)),
  };
}

export function initialCardPosition(
  anchor: CardPosition,
  width: number,
  height: number,
  areaWidth: number,
  areaHeight: number,
  index: number,
  seed: number,
) {
  const angle = index * GOLDEN_ANGLE + pseudoRandom(seed, 1) * 0.8;
  const radius = 56 + Math.floor(index / 5) * 42 + pseudoRandom(seed, 2) * 20;
  return clampCardPosition(
    positionFromCenter(
      anchor.x + Math.cos(angle) * radius,
      anchor.y + Math.sin(angle) * radius * 0.76,
      width,
      height,
    ),
    width,
    height,
    areaWidth,
    areaHeight,
  );
}

export function clampWorkspaceAnchor(anchor: CardPosition, width: number, height: number) {
  return {
    x: clamp(anchor.x, 72, Math.max(72, width - WORKSPACE_LABEL_W - WORKSPACE_MARGIN_X)),
    y: clamp(anchor.y, WORKSPACE_MARGIN_Y, Math.max(WORKSPACE_MARGIN_Y, height - WORKSPACE_MARGIN_X)),
  };
}

export function displayTitle(client: ClientItem) {
  const title = client.title?.trim();
  if (title) return title;
  if (client.sessionID?.trim()) return client.sessionID;
  return "Untitled Client";
}

export function cardKey(client: ClientItem) {
  return client.key || `${client.runtimeID}:${client.sessionID || "runtime"}`;
}

export function sessionStatusLabel(state: ClientItem["sessionState"], reason?: ClientItem["sessionReason"]) {
  if (!state) return "-";
  if (!reason) return state;
  return `${state}.${reason}`;
}

export function sessionBucket(state: ClientItem["sessionState"]): "idle" | "busy" | "error" | null {
  if (state === "idle") return "idle";
  if (state === "busy") return "busy";
  if (state === "waiting" || state === "stopped") return "error";
  return null;
}

export function promptClass(state: ClientItem["sessionState"], runtime: ClientItem["status"]) {
  if (runtime === "offline") return "is-offline";
  if (state === "stopped" || state === "waiting") return "is-error";
  if (state === "busy") return "is-busy";
  if (state === "idle") return "is-idle";
  return "is-offline";
}

function record(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function compact(value: string, max = 160) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

export function sessionSubtitle(client: ClientItem) {
  if (client.sessionReason === "compacting") return "";
  const meta = record(client.sessionMeta);
  const direct = text(meta.subtitle);
  if (direct && client.sessionReason !== "tool") return compact(direct);
  return "";
}

export function sessionContext(client: ClientItem) {
  if (client.sessionReason === "compacting") return "";
  const meta = record(client.sessionMeta);
  const direct = text(meta.context);
  if (direct) return compact(direct);
  return "";
}

export function sessionEventLabel(client: ClientItem) {
  if (client.sessionReason === "tool") return "tool";
  if (client.sessionReason === "reasoning") return "think";
  if (client.sessionReason === "compacting") return "compacting";
  if (client.sessionReason === "permission") return "permission";
  if (client.sessionReason === "question") return "question";
  return "";
}

export function cardClass(client: ClientItem) {
  return client.displayID ? "is-bound" : "is-unbound";
}
