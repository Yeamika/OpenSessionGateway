"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeIcon } from "./home/components/ThemeIcon";
import { BUILD_STAMP } from "./home/constants";
import { useMonitorStream } from "./home/hooks/use-monitor-stream";
import { useUiPreferences } from "./home/hooks/use-ui-preferences";
import type { ClientItem } from "./home/types";
import { cardKey, displayTitle, runtimeKey, sessionLampColor, shortRuntimeLabel, workspaceGroupKey, workspaceKey, workspaceLabel } from "./home/utils";

type RuntimeGroup = {
  runtimeID: string;
  runtimeHost: string | null;
  status: ClientItem["status"];
  clients: ClientItem[];
  workspaces: WorkspaceGroup[];
};

type WorkspaceGroup = {
  groupKey: string;
  runtimeID: string;
  workspace: string;
  label: string;
  clients: ClientItem[];
};

type WorkspaceSummary = {
  groupKey: string;
  runtimeID: string;
  label: string;
  clientCount: number;
  busyCount: number;
  errorCount: number;
  lastActiveTime: string | null;
};

const STATUS_WEIGHT: Record<ClientItem["status"], number> = {
  offline: 0,
  stale: 1,
  online: 2,
};

function groupRuntimeClients(clients: ClientItem[]): RuntimeGroup[] {
  const grouped = new Map<string, {
    runtimeID: string;
    runtimeHost: string | null;
    status: ClientItem["status"];
    clients: ClientItem[];
    workspaces: Map<string, WorkspaceGroup>;
  }>();

  clients.forEach((client) => {
    const runtimeID = runtimeKey(client);
    const runtime = grouped.get(runtimeID) || {
      runtimeID,
      runtimeHost: client.runtimeHost,
      status: client.status,
      clients: [],
      workspaces: new Map<string, WorkspaceGroup>(),
    };

    if (STATUS_WEIGHT[client.status] > STATUS_WEIGHT[runtime.status]) {
      runtime.status = client.status;
    }
    runtime.runtimeHost = runtime.runtimeHost || client.runtimeHost;
    runtime.clients.push(client);

    const groupKey = workspaceGroupKey(client);
    const workspace = runtime.workspaces.get(groupKey) || {
      groupKey,
      runtimeID,
      workspace: workspaceKey(client),
      label: workspaceLabel(client.workspace),
      clients: [],
    };

    workspace.clients.push(client);
    runtime.workspaces.set(groupKey, workspace);
    grouped.set(runtimeID, runtime);
  });

  return [...grouped.values()]
    .sort((a, b) => a.runtimeID.localeCompare(b.runtimeID))
    .map((runtime) => ({
      runtimeID: runtime.runtimeID,
      runtimeHost: runtime.runtimeHost,
      status: runtime.status,
      clients: runtime.clients,
      workspaces: [...runtime.workspaces.values()].sort((a, b) => a.label.localeCompare(b.label)),
    }));
}

function compareActivity(a: ClientItem, b: ClientItem) {
  if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
  return (b.lastActiveTime || "").localeCompare(a.lastActiveTime || "");
}

function formatRelativeTime(value: string | null) {
  if (!value) return "no recent activity";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "no recent activity";

  const deltaMs = Date.now() - timestamp;
  const deltaSeconds = Math.max(0, Math.floor(deltaMs / 1000));
  if (deltaSeconds < 45) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

function statusClass(status: string | null) {
  if (!status) return "is-muted";
  if (status === "online" || status === "busy") return "is-online";
  if (status === "idle") return "is-idle";
  if (status === "error") return "is-error";
  if (status === "stale") return "is-stale";
  return "is-offline";
}

export default function Page() {
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const { clients, connected } = useMonitorStream();
  const { systemDark, uiMode, setUiMode } = useUiPreferences();
  const [themeOpen, setThemeOpen] = useState(false);

  const runtimeSummaries = useMemo(() => groupRuntimeClients(clients), [clients]);
  const workspaceSummaries = useMemo<WorkspaceSummary[]>(() => {
    return runtimeSummaries
      .flatMap((runtime) => runtime.workspaces)
      .map((workspace) => {
        const sorted = [...workspace.clients].sort(compareActivity);
        return {
          groupKey: workspace.groupKey,
          runtimeID: workspace.runtimeID,
          label: workspace.label,
          clientCount: workspace.clients.length,
          busyCount: workspace.clients.filter((client) => client.sessionStatus === "busy").length,
          errorCount: workspace.clients.filter((client) => client.sessionStatus === "error").length,
          lastActiveTime: sorted[0]?.lastActiveTime || null,
        };
      })
      .sort((a, b) => {
        if (a.clientCount !== b.clientCount) return b.clientCount - a.clientCount;
        return (b.lastActiveTime || "").localeCompare(a.lastActiveTime || "");
      });
  }, [runtimeSummaries]);

  const sessionStats = useMemo(() => {
    const online = clients.filter((client) => client.status === "online").length;
    const stale = clients.filter((client) => client.status === "stale").length;
    const offline = clients.filter((client) => client.status === "offline").length;
    const busy = clients.filter((client) => client.sessionStatus === "busy").length;
    const idle = clients.filter((client) => client.sessionStatus === "idle").length;
    const error = clients.filter((client) => client.sessionStatus === "error").length;

    return {
      online,
      stale,
      offline,
      busy,
      idle,
      error,
      runtimes: runtimeSummaries.length,
      workspaces: workspaceSummaries.length,
      sessions: clients.length,
    };
  }, [clients, runtimeSummaries.length, workspaceSummaries.length]);

  const recentClients = useMemo(() => [...clients].sort(compareActivity).slice(0, 6), [clients]);
  const registryClients = useMemo(() => [...clients].sort(compareActivity), [clients]);

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

  const effectiveDark = uiMode === "system" ? systemDark : uiMode === "dark";

  return (
    <main className={`nancy-monitor-root ${effectiveDark ? "is-dark" : "is-light"}`}>
      <header className="nancy-acrylic-nav">
        <div className="nancy-nav-left">
          <div className="nancy-logo" aria-hidden>
            O
          </div>
          <div>
            <div className="nancy-brand">OSG Monitor Dashboard</div>
            <div className="nancy-hero-subcopy">Live runtime, workspace, and session health for the current gateway surface.</div>
          </div>
        </div>
        <div className="nancy-nav-right">
          <div className={`nancy-nav-pill ${connected ? "is-online" : "is-offline"}`}>{connected ? "stream connected" : "stream disconnected"}</div>
          <div className="nancy-nav-pill">{sessionStats.sessions} sessions</div>
          <div className="nancy-nav-pill">{sessionStats.busy} busy</div>
          <div ref={themeMenuRef} className="nancy-theme-menu">
            <button type="button" className="nancy-theme-toggle" onClick={() => setThemeOpen((value) => !value)} title="theme">
              <span className="nancy-theme-icon" aria-hidden>{uiMode === "system" ? <ThemeIcon mode="system" /> : <ThemeIcon mode={effectiveDark ? "dark" : "light"} />}</span>
            </button>
            {themeOpen && (
              <div className="nancy-theme-dropdown">
                <button type="button" onClick={() => { setUiMode("light"); setThemeOpen(false); }} className={`nancy-theme-item ${uiMode === "light" ? "is-active" : ""}`}>
                  <ThemeIcon mode="light" />
                  <span>Light</span>
                </button>
                <button type="button" onClick={() => { setUiMode("dark"); setThemeOpen(false); }} className={`nancy-theme-item ${uiMode === "dark" ? "is-active" : ""}`}>
                  <ThemeIcon mode="dark" />
                  <span>Dark</span>
                </button>
                <button type="button" onClick={() => { setUiMode("system"); setThemeOpen(false); }} className={`nancy-theme-item ${uiMode === "system" ? "is-active" : ""}`}>
                  <ThemeIcon mode="system" />
                  <span>System</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="nancy-panel-wrap nancy-dashboard-top">
        <div className="nancy-dashboard-grid">
          <div className="nancy-panel nancy-hero-panel">
            <div className="nancy-panel-title">Gateway overview</div>
            <div className="nancy-hero-title">Homepage redesigned as an operational dashboard.</div>
            <div className="nancy-hero-copy">The fish shoal scene is removed from the landing page. This view now prioritizes runtime health, active workspaces, and live session triage.</div>
            <div className="nancy-metric-grid">
              <div className="nancy-metric-card">
                <div className="nancy-stat-label">Live sessions</div>
                <div className="nancy-stat-value">{sessionStats.sessions}</div>
              </div>
              <div className="nancy-metric-card">
                <div className="nancy-stat-label">Runtime groups</div>
                <div className="nancy-stat-value">{sessionStats.runtimes}</div>
              </div>
              <div className="nancy-metric-card">
                <div className="nancy-stat-label">Workspaces</div>
                <div className="nancy-stat-value">{sessionStats.workspaces}</div>
              </div>
              <div className="nancy-metric-card">
                <div className="nancy-stat-label">Errors</div>
                <div className="nancy-stat-value">{sessionStats.error}</div>
              </div>
            </div>
          </div>

          <div className="nancy-panel">
            <div className="nancy-panel-title">Recent activity</div>
            <div className="nancy-activity-list">
              {recentClients.length === 0 && <div className="nancy-empty-state">No live sessions are reporting yet.</div>}
              {recentClients.map((client) => (
                <div key={cardKey(client)} className="nancy-activity-row">
                  <span className="nancy-dot" style={{ backgroundColor: sessionLampColor(client.sessionStatus, client.status) }} />
                  <div className="nancy-activity-copy">
                    <div className="nancy-activity-title">{displayTitle(client)}</div>
                    <div className="nancy-activity-meta">{workspaceLabel(client.workspace)} · {shortRuntimeLabel(client.runtimeID)}</div>
                  </div>
                  <div className="nancy-activity-side">
                    <span className={`nancy-inline-pill ${statusClass(client.sessionStatus || client.status)}`}>{client.sessionStatus || client.status}</span>
                    <span className="nancy-activity-time">{formatRelativeTime(client.lastActiveTime)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="nancy-panel-wrap nancy-dashboard-tight">
        <div className="nancy-panel nancy-status-grid nancy-status-grid-wide">
          <div className="nancy-stat-box">
            <div className="nancy-stat-label">Connection</div>
            <div className="nancy-stat-value">{connected ? "Connected" : "Disconnected"}</div>
          </div>
          <div className="nancy-stat-box">
            <div className="nancy-stat-label">Online</div>
            <div className="nancy-stat-value">{sessionStats.online}</div>
          </div>
          <div className="nancy-stat-box">
            <div className="nancy-stat-label">Busy</div>
            <div className="nancy-stat-value">{sessionStats.busy}</div>
          </div>
          <div className="nancy-stat-box">
            <div className="nancy-stat-label">Idle</div>
            <div className="nancy-stat-value">{sessionStats.idle}</div>
          </div>
          <div className="nancy-stat-box">
            <div className="nancy-stat-label">Errors</div>
            <div className="nancy-stat-value">{sessionStats.error}</div>
          </div>
          <div className="nancy-stat-box">
            <div className="nancy-stat-label">Stale / Offline</div>
            <div className="nancy-stat-value">{sessionStats.stale + sessionStats.offline}</div>
          </div>
        </div>
      </section>

      <section className="nancy-panel-wrap nancy-dashboard-tight">
        <div className="nancy-panel">
          <div className="nancy-panel-title">Runtime overview</div>
          <div className="nancy-runtime-grid">
            {runtimeSummaries.length === 0 && <div className="nancy-empty-state">No runtimes connected.</div>}
            {runtimeSummaries.map((runtime) => {
              const busiest = [...runtime.clients].sort(compareActivity)[0] || null;
              const busyCount = runtime.clients.filter((client) => client.sessionStatus === "busy").length;
              const errorCount = runtime.clients.filter((client) => client.sessionStatus === "error").length;

              return (
                <article key={runtime.runtimeID} className="nancy-runtime-card">
                  <div className="nancy-runtime-card-head">
                    <div>
                      <div className="nancy-runtime-card-title">{shortRuntimeLabel(runtime.runtimeID)}</div>
                      <div className="nancy-runtime-card-meta">{runtime.runtimeHost || "unknown host"}</div>
                    </div>
                    <span className={`nancy-inline-pill ${statusClass(runtime.status)}`}>{runtime.status}</span>
                  </div>

                  <div className="nancy-runtime-card-stats">
                    <div><span>sessions</span><strong>{runtime.clients.length}</strong></div>
                    <div><span>workspaces</span><strong>{runtime.workspaces.length}</strong></div>
                    <div><span>busy</span><strong>{busyCount}</strong></div>
                    <div><span>errors</span><strong>{errorCount}</strong></div>
                  </div>

                  <div className="nancy-runtime-card-list">
                    {runtime.workspaces.slice(0, 4).map((workspace) => (
                      <div key={workspace.groupKey} className="nancy-runtime-card-row">
                        <span>{workspace.label}</span>
                        <strong>{workspace.clients.length}</strong>
                      </div>
                    ))}
                    {runtime.workspaces.length > 4 && <div className="nancy-runtime-card-row is-muted">+{runtime.workspaces.length - 4} more workspaces</div>}
                  </div>

                  <div className="nancy-runtime-card-footer">latest activity {formatRelativeTime(busiest?.lastActiveTime || null)}</div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="nancy-panel-wrap nancy-dashboard-tight">
        <div className="nancy-panel">
          <div className="nancy-panel-title">Workspace overview</div>
          <div className="nancy-table">
            <div className="nancy-tr nancy-th nancy-tr-workspace">
              <span>Workspace</span>
              <span>Runtime</span>
              <span>Sessions</span>
              <span>Busy</span>
              <span>Errors</span>
              <span>Last active</span>
            </div>
            {workspaceSummaries.map((workspace) => (
              <div key={workspace.groupKey} className="nancy-tr nancy-tr-workspace">
                <span>{workspace.label}</span>
                <span className="nancy-mono">{shortRuntimeLabel(workspace.runtimeID)}</span>
                <span>{workspace.clientCount}</span>
                <span>{workspace.busyCount}</span>
                <span>{workspace.errorCount}</span>
                <span>{formatRelativeTime(workspace.lastActiveTime)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="nancy-panel-wrap nancy-dashboard-tight">
        <div className="nancy-panel">
          <div className="nancy-panel-title">Session registry</div>
          <div className="nancy-table">
            <div className="nancy-tr nancy-th nancy-tr-session">
              <span>State</span>
              <span>Title</span>
              <span>Session</span>
              <span>Runtime</span>
              <span>Workspace</span>
              <span>Activity</span>
            </div>
            {registryClients.map((client) => (
              <div key={cardKey(client)} className="nancy-tr nancy-tr-session">
                <span className="nancy-state-cell">
                  <span className="nancy-dot" style={{ backgroundColor: sessionLampColor(client.sessionStatus, client.status) }} />
                  <span className={`nancy-inline-pill ${statusClass(client.sessionStatus || client.status)}`}>{client.sessionStatus || client.status}</span>
                </span>
                <span>{displayTitle(client)}{client.synthetic ? " · template" : ""}</span>
                <span className="nancy-mono">{client.sessionID ?? "null"}</span>
                <span className="nancy-mono">{shortRuntimeLabel(client.runtimeID)}</span>
                <span>{workspaceLabel(client.workspace)}</span>
                <span>{client.activeCount} · {formatRelativeTime(client.lastActiveTime)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="nancy-build-stamp">{BUILD_STAMP}</div>
    </main>
  );
}
