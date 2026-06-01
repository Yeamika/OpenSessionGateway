export interface LinkHandshake {
  type: 'link_handshake';
  protocol_version: number;
  peer_id: string;
  metadata: Record<string, unknown>;
}

export const PROTOCOL_VERSION = 1;

export function createLinkHandshake(
  peerId: string,
  metadata?: Record<string, unknown>
): LinkHandshake {
  return {
    type: 'link_handshake',
    protocol_version: PROTOCOL_VERSION,
    peer_id: peerId,
    metadata: metadata ?? {},
  };
}

export function validateLinkHandshake(msg: unknown): msg is LinkHandshake {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'link_handshake' &&
    typeof m.protocol_version === 'number' &&
    typeof m.peer_id === 'string' &&
    (m.metadata === undefined || typeof m.metadata === 'object')
  );
}
