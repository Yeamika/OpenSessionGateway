export function listSession(payload?: { list?: number; regex?: string; directory?: string }) {
  return {
    meta: {
      matched: 0,
    },
    sessions: [],
  };
}
