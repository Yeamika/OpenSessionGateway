"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { UiMode } from "../types";

const PREFS_EVENT = "nancy-preferences-change";

function readUiMode(): UiMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("nancy-ui-mode");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}

function readCanvasScale() {
  if (typeof window === "undefined") return 1;
  const raw = Number(window.localStorage.getItem("nancy-canvas-scale") || "1");
  return Number.isFinite(raw) ? Math.max(0.25, Math.min(1.25, raw)) : 1;
}

function subscribePrefs(onChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === "nancy-ui-mode" || event.key === "nancy-canvas-scale") {
      onChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(PREFS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PREFS_EVENT, onChange);
  };
}

function subscribeSystemDark(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useUiPreferences() {
  const uiMode = useSyncExternalStore(subscribePrefs, readUiMode, () => "dark");
  const canvasScale = useSyncExternalStore(subscribePrefs, readCanvasScale, () => 1);
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    () => (typeof window === "undefined" ? false : window.matchMedia("(prefers-color-scheme: dark)").matches),
    () => false,
  );

  const setUiMode = useCallback((next: UiMode) => {
    window.localStorage.setItem("nancy-ui-mode", next);
    window.dispatchEvent(new Event(PREFS_EVENT));
  }, []);

  const setCanvasScale = useCallback((next: number) => {
    const value = Math.max(0.25, Math.min(1.25, next));
    window.localStorage.setItem("nancy-canvas-scale", String(value));
    window.dispatchEvent(new Event(PREFS_EVENT));
  }, []);

  return {
    canvasScale,
    setCanvasScale,
    systemDark,
    uiMode,
    setUiMode,
  };
}
