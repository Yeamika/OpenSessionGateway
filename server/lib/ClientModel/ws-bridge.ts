function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const clean = value.trim();
  return clean ? clean : null;
}

export type RuntimeWsBridge = {
  connected: boolean;
  hostName: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
};

export function createRuntimeWsBridge(): RuntimeWsBridge {
  return {
    connected: false,
    hostName: null,
    connectedAt: null,
    lastSeenAt: null,
  };
}

export function hydrateRuntimeWsBridge(value: unknown): RuntimeWsBridge {
  if (!value || typeof value !== "object") {
    return createRuntimeWsBridge();
  }
  const row = value as Partial<RuntimeWsBridge>;
  return {
    connected: row.connected === true,
    hostName: normalizeOptionalString(row.hostName),
    connectedAt: normalizeOptionalString(row.connectedAt),
    lastSeenAt: normalizeOptionalString(row.lastSeenAt),
  };
}
