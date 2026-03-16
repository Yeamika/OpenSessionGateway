"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Moon, Pin, PinOff, Sun } from "lucide-react";

type ClientItem = {
  runtimeID: string;
  sessionID: string | null;
  runtimeHost: string | null;
  port: number | null;
  workspace: string | null;
  title: string | null;
  status: "online" | "stale" | "offline";
  lastHeartbeatAt: string | null;
};

type CardPosition = {
  x: number;
  y: number;
};

type MainView = "nancy" | "clients" | "status";
type UiMode = "dark" | "light" | "system";
const BUILD_STAMP = "build-20260314-06";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function lampColor(status: ClientItem["status"]) {
  if (status === "online") return "#41ff99";
  if (status === "stale") return "#ffbf47";
  return "#ff5f56";
}

function statusLabel(status: ClientItem["status"]) {
  if (status === "online") return "online";
  if (status === "stale") return "stale";
  return "offline";
}

function findFreeCardSpot(
  used: CardPosition[],
  width: number,
  height: number,
  cardW: number,
  cardH: number,
): CardPosition {
  const centerX = (width - cardW) / 2;
  const centerY = (height - cardH) / 2;
  const stepX = 340;
  const stepY = 200;

  const maxRing = 8;
  for (let ring = 0; ring <= maxRing; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = clamp(centerX + dx * stepX, 10, Math.max(10, width - cardW - 10));
        const y = clamp(centerY + dy * stepY, 10, Math.max(10, height - cardH - 10));
        const blocked = used.some((p) => Math.abs(p.x - x) < cardW * 0.72 && Math.abs(p.y - y) < cardH * 0.72);
        if (!blocked) {
          return { x, y };
        }
      }
    }
  }

  return {
    x: clamp(centerX, 10, Math.max(10, width - cardW - 10)),
    y: clamp(centerY, 10, Math.max(10, height - cardH - 10)),
  };
}

function displayTitle(client: ClientItem) {
  const title = client.title?.trim();
  if (title) return title;
  if (client.sessionID?.trim()) return client.sessionID;
  return "Untitled Client";
}

function ThemeIcon({ mode }: { mode: UiMode }) {
  if (mode === "light") {
    return <Sun size={15} strokeWidth={2} />;
  }

  if (mode === "dark") {
    return <Moon size={15} strokeWidth={2} />;
  }

  return <Monitor size={15} strokeWidth={2} />;
}

export default function Page() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [positions, setPositions] = useState<Record<string, CardPosition>>({});
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<MainView>("nancy");
  const [uiMode, setUiMode] = useState<UiMode>("system");
  const [systemDark, setSystemDark] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const [draggingRuntimeID, setDraggingRuntimeID] = useState<string>("");

  const dragRef = useRef<{
    runtimeID: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const dragPendingRef = useRef<{ runtimeID: string; x: number; y: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("nancy-ui-mode");
    if (stored === "light" || stored === "dark" || stored === "system") {
      setUiMode(stored);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSystemDark(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!themeMenuRef.current) return;
      if (!themeMenuRef.current.contains(event.target as Node)) {
        setThemeOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("nancy-ui-mode", uiMode);
  }, [uiMode]);

  useEffect(() => {
    const eventSource = new EventSource("/api/nancymonitor/stream");
    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!Array.isArray(payload?.data)) return;
        setClients(payload.data as ClientItem[]);
      } catch {
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    const width = canvasRef.current?.clientWidth ?? 1200;
    const height = canvasRef.current?.clientHeight ?? 720;

    setPositions((current) => {
      const next = { ...current };
      const cardW = 320;
      const cardH = 180;

      const centerSpot = {
        x: clamp((width - cardW) / 2, 10, Math.max(10, width - cardW - 10)),
        y: clamp((height - cardH) / 2, 10, Math.max(10, height - cardH - 10)),
      };

      const newRuntimeIDs: string[] = [];

      clients.forEach((client) => {
        if (next[client.runtimeID]) return;
        next[client.runtimeID] = centerSpot;
        newRuntimeIDs.push(client.runtimeID);
      });

      Object.keys(next).forEach((runtimeID) => {
        if (!clients.some((client) => client.runtimeID === runtimeID)) {
          delete next[runtimeID];
        }
      });

      if (newRuntimeIDs.length) {
        const used: CardPosition[] = clients
          .map((c) => c.runtimeID)
          .filter((runtimeID) => !newRuntimeIDs.includes(runtimeID))
          .map((runtimeID) => next[runtimeID])
          .filter(Boolean);

        const targets: Record<string, CardPosition> = {};
        newRuntimeIDs.forEach((runtimeID) => {
          const spot = findFreeCardSpot(used, width, height, cardW, cardH);
          targets[runtimeID] = spot;
          used.push(spot);
        });

        window.setTimeout(() => {
          setPositions((latest) => {
            const merged = { ...latest };
            newRuntimeIDs.forEach((runtimeID) => {
              if (merged[runtimeID]) {
                merged[runtimeID] = targets[runtimeID];
              }
            });
            return merged;
          });
        }, 40);
      }

      return next;
    });
  }, [clients]);

  useEffect(() => {
      const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const root = canvasRef.current;
      if (!drag || !root) return;

      const rect = root.getBoundingClientRect();
      const cardW = 320;
      const cardH = 180;
      const nextX = clamp(event.clientX - rect.left - drag.offsetX, 10, rect.width - cardW - 10);
      const nextY = clamp(event.clientY - rect.top - drag.offsetY, 10, rect.height - cardH - 10);

      dragPendingRef.current = { runtimeID: drag.runtimeID, x: nextX, y: nextY };
      if (dragRafRef.current !== null) return;
      dragRafRef.current = window.requestAnimationFrame(() => {
        const pending = dragPendingRef.current;
        dragRafRef.current = null;
        if (!pending) return;
        setPositions((current) => ({
          ...current,
          [pending.runtimeID]: { x: pending.x, y: pending.y },
        }));
      });
    };

    const onPointerUp = () => {
      dragRef.current = null;
      dragPendingRef.current = null;
      setDraggingRuntimeID("");
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, []);

  const statusSummary = useMemo(() => {
    const online = clients.filter((client) => client.status === "online").length;
    const stale = clients.filter((client) => client.status === "stale").length;
    const offline = clients.filter((client) => client.status === "offline").length;
    return { online, stale, offline };
  }, [clients]);

  const effectiveDark = uiMode === "system" ? systemDark : uiMode === "dark";

  return (
    <main className={`nancy-monitor-root ${effectiveDark ? "is-dark" : "is-light"}`}>
      <header className="nancy-acrylic-nav">
        <div className="nancy-nav-left">
          <div className="nancy-logo" aria-hidden>
            N
          </div>
          <div className="nancy-brand">NancyMonitor</div>
          <nav className="nancy-nav-tabs">
            <button
              type="button"
              onClick={() => setView("nancy")}
              className={`nancy-tab ${view === "nancy" ? "is-active" : ""}`}
            >
              监控
            </button>
            <button
              type="button"
              onClick={() => setView("clients")}
              className={`nancy-tab ${view === "clients" ? "is-active" : ""}`}
            >
              Clients
            </button>
            <button
              type="button"
              onClick={() => setView("status")}
              className={`nancy-tab ${view === "status" ? "is-active" : ""}`}
            >
              状态
            </button>
          </nav>
        </div>
        <div className="nancy-nav-right">
          <div ref={themeMenuRef} className="nancy-theme-menu">
            <button
              type="button"
              className="nancy-theme-toggle"
              onClick={() => setThemeOpen((v) => !v)}
              title="风格切换"
            >
              <span className="nancy-theme-icon" aria-hidden>{uiMode === "system" ? <ThemeIcon mode="system" /> : <ThemeIcon mode={effectiveDark ? "dark" : "light"} />}</span>
            </button>
            {themeOpen && (
              <div className="nancy-theme-dropdown">
                <button
                  type="button"
                  onClick={() => {
                    setUiMode("light");
                    setThemeOpen(false);
                  }}
                  className={`nancy-theme-item ${uiMode === "light" ? "is-active" : ""}`}
                >
                  <ThemeIcon mode="light" />
                  <span>浅色</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUiMode("dark");
                    setThemeOpen(false);
                  }}
                  className={`nancy-theme-item ${uiMode === "dark" ? "is-active" : ""}`}
                >
                  <ThemeIcon mode="dark" />
                  <span>暗色</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUiMode("system");
                    setThemeOpen(false);
                  }}
                  className={`nancy-theme-item ${uiMode === "system" ? "is-active" : ""}`}
                >
                  <ThemeIcon mode="system" />
                  <span>跟随系统</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {view === "nancy" && (
        <section ref={canvasRef} className="nancy-canvas">
          {clients.length === 0 && (
            <div className="nancy-empty">Waiting for clients...</div>
          )}

          {clients.map((client) => {
            const pos = positions[client.runtimeID] || { x: 24, y: 24 };
            return (
              <article
                key={client.runtimeID}
                className={`nancy-client-card ${draggingRuntimeID === client.runtimeID ? "is-dragging" : ""}`}
                style={{ left: pos.x, top: pos.y }}
              >
                <div
                className="nancy-card-bar"
                onPointerDown={(event) => {
                  if (pinned[client.runtimeID]) return;
                  const card = event.currentTarget.parentElement;
                  const root = canvasRef.current;
                  if (!card || !root) return;
                    const cardRect = card.getBoundingClientRect();
                  dragRef.current = {
                    runtimeID: client.runtimeID,
                    offsetX: event.clientX - cardRect.left,
                    offsetY: event.clientY - cardRect.top,
                  };
                  setDraggingRuntimeID(client.runtimeID);
                }}
              >
                  <div className="nancy-lamp-wrap">
                    <span
                    className="nancy-lamp"
                      style={{ backgroundColor: lampColor(client.status) }}
                    />
                    <div className="nancy-lamp-tip">
                      <div>status: {statusLabel(client.status)}</div>
                      <div>runtimeID: {client.runtimeID}</div>
                      <div>title: {displayTitle(client)}</div>
                      <div>sessionID: {client.sessionID ?? "null"}</div>
                      <div>workspace: {client.workspace ?? "null"}</div>
                      <div>host: {client.runtimeHost ?? "null"}</div>
                      <div>port: {client.port ?? "null"}</div>
                      <div>heartbeat: {client.lastHeartbeatAt ?? "null"}</div>
                    </div>
                  </div>
                  <div className="nancy-card-title">{displayTitle(client)}</div>
                  <button
                    type="button"
                    className={`nancy-pin ${pinned[client.runtimeID] ? "is-pinned" : ""}`}
                    title={pinned[client.runtimeID] ? "取消固定" : "固定卡片"}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={() => {
                      setPinned((current) => ({
                        ...current,
                        [client.runtimeID]: !current[client.runtimeID],
                      }));
                    }}
                  >
                    {pinned[client.runtimeID] ? <Pin size={13} strokeWidth={2} /> : <PinOff size={13} strokeWidth={2} />}
                  </button>
                </div>

                <div className="nancy-card-body">
                </div>
              </article>
            );
          })}
        </section>
      )}

      {view === "clients" && (
        <section className="nancy-panel-wrap">
          <div className="nancy-panel">
            <div className="nancy-panel-title">Client 列表</div>
            <div className="nancy-table">
              <div className="nancy-tr nancy-th">
                <span>状态</span>
                <span>标题</span>
                <span>runtimeID</span>
                <span>工作目录</span>
              </div>
              {clients.map((client) => (
                <div key={client.runtimeID} className="nancy-tr">
                  <span className="nancy-dot" style={{ backgroundColor: lampColor(client.status) }} />
                  <span>{displayTitle(client)}</span>
                  <span className="nancy-mono">{client.runtimeID}</span>
                  <span>{client.workspace ?? "null"}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {view === "status" && (
        <section className="nancy-panel-wrap">
          <div className="nancy-panel nancy-status-grid">
            <div className="nancy-stat-box">
              <div className="nancy-stat-label">连接状态</div>
              <div className="nancy-stat-value">{connected ? "Connected" : "Disconnected"}</div>
            </div>
            <div className="nancy-stat-box">
              <div className="nancy-stat-label">在线</div>
              <div className="nancy-stat-value">{statusSummary.online}</div>
            </div>
            <div className="nancy-stat-box">
              <div className="nancy-stat-label">卡顿</div>
              <div className="nancy-stat-value">{statusSummary.stale}</div>
            </div>
            <div className="nancy-stat-box">
              <div className="nancy-stat-label">离线</div>
              <div className="nancy-stat-value">{statusSummary.offline}</div>
            </div>
          </div>
        </section>
      )}

      <div className="nancy-build-stamp">{BUILD_STAMP}</div>
    </main>
  );
}
