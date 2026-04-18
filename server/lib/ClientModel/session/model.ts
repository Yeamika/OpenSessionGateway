export type RuntimeSessionBundle = {
  runtimeID: string;
  sessionID: string;
  displayID: string | null;
  title: string | null;
  status: "idle" | "busy" | "error" | null;
  lastActiveTime: string | null;
  activeCount: number;
};

export function createRuntimeSessionBundle(
  runtimeID: string,
  sessionID: string,
): RuntimeSessionBundle {
  return {
    runtimeID,
    sessionID,
    displayID: null,
    title: null,
    status: null,
    lastActiveTime: null,
    activeCount: 0,
  };
}

export function hydrateRuntimeSessionBundle(bundle: RuntimeSessionBundle): RuntimeSessionBundle {
  bundle.displayID = typeof bundle.displayID === "string" && bundle.displayID.trim() ? bundle.displayID.trim() : null;
  bundle.title = typeof bundle.title === "string" && bundle.title.trim() ? bundle.title.trim() : null;
  bundle.status = bundle.status === "idle" || bundle.status === "busy" || bundle.status === "error" ? bundle.status : null;
  bundle.lastActiveTime = typeof bundle.lastActiveTime === "string" && bundle.lastActiveTime.trim() ? bundle.lastActiveTime.trim() : null;
  bundle.activeCount = Number.isFinite(bundle.activeCount) && bundle.activeCount > 0 ? Math.floor(bundle.activeCount) : 0;
  return bundle;
}
