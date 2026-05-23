/**
 * OSGP Hello message builders and type guards.
 *
 * The Hello message is the first frame exchanged after a connection
 * is established. It declares identity, role, addresses, and capabilities.
 */

import type {
  Capability,
  HelloMessage,
  NodeId,
  Role,
  SessionAddress,
} from "./types.js";

// ── Builder ──────────────────────────────────────────────────────────

export interface HelloOptions {
  readonly nodeId: NodeId;
  readonly role: Role;
  readonly addresses?: readonly SessionAddress[];
  readonly capabilities?: readonly Capability[];
}

/**
 * Create a well-formed Hello message.
 *
 * ```ts
 * const hello = createHello({
 *   nodeId: "my-endpoint",
 *   role: "endpoint",
 *   capabilities: ["surface_viewer"],
 * });
 * ```
 */
export function createHello(options: HelloOptions): HelloMessage {
  const msg: HelloMessage = {
    nodeId: options.nodeId,
    role: options.role,
  };

  if (options.addresses && options.addresses.length > 0) {
    (msg as { addresses: readonly SessionAddress[] }).addresses =
      options.addresses;
  }

  if (options.capabilities && options.capabilities.length > 0) {
    (msg as { capabilities: readonly Capability[] }).capabilities =
      options.capabilities;
  }

  return msg;
}

// ── Type guard ───────────────────────────────────────────────────────

const VALID_ROLES: readonly string[] = ["endpoint", "router"];

/**
 * Type-guard: returns `true` if `value` looks like a HelloMessage.
 *
 * Checks for required `nodeId` (string) and `role` (valid Role).
 * Does NOT deeply validate `addresses` or `capabilities`.
 */
export function isHelloMessage(value: unknown): value is HelloMessage {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj["nodeId"] !== "string" || obj["nodeId"].length === 0) {
    return false;
  }

  if (typeof obj["role"] !== "string" || !VALID_ROLES.includes(obj["role"])) {
    return false;
  }

  return true;
}
