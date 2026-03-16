import type { ClientStatus } from "@prisma/client";

export function resolveStatus(lastHeartbeatAt: Date | null): ClientStatus {
  if (!lastHeartbeatAt) {
    return "offline";
  }

  const elapsedSec = Math.floor((Date.now() - lastHeartbeatAt.getTime()) / 1000);

  if (elapsedSec <= 60) {
    return "online";
  }

  if (elapsedSec <= 120) {
    return "stale";
  }

  return "offline";
}
