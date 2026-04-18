import type { MonitorClient } from "@/lib/monitor-contract";

export type ClientItem = MonitorClient & {
  synthetic?: boolean;
};

export type CardPosition = {
  x: number;
  y: number;
};

export type Velocity = {
  x: number;
  y: number;
};

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type MainView = "nancy" | "clients" | "status";
export type UiMode = "dark" | "light" | "system";
