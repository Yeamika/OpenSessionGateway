export type RuntimeMcpState = {
  callerKeys: Set<string>;
};

export function createRuntimeMcpState(): RuntimeMcpState {
  return { callerKeys: new Set<string>() };
}

export function hydrateRuntimeMcpState(value: unknown): RuntimeMcpState {
  if (!value || typeof value !== "object") {
    return createRuntimeMcpState();
  }
  const row = value as Partial<RuntimeMcpState>;
  if (!(row.callerKeys instanceof Set)) {
    return createRuntimeMcpState();
  }
  return { callerKeys: row.callerKeys };
}
