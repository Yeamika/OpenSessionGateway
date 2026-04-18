export type RuntimeDisplayBundle = {
  runtimeID: string;
  displayID: string;
};

export function createRuntimeDisplayBundle(runtimeID: string, displayID: string): RuntimeDisplayBundle {
  return {
    runtimeID: runtimeID.trim(),
    displayID: displayID.trim(),
  };
}

export function hydrateRuntimeDisplayBundle(bundle: RuntimeDisplayBundle): RuntimeDisplayBundle {
  bundle.runtimeID = bundle.runtimeID.trim();
  bundle.displayID = bundle.displayID.trim();
  return bundle;
}
