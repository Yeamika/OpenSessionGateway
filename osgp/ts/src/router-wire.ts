/**
 * Router bridge wire types used by GlassVein router integrations.
 *
 * These are not WebSocket/HTTP transport types; they describe the JSON wire
 * shape exchanged between opencode plugin clients and the GlassVein router.
 */

import type { OsgpType, Role, SessionAddress } from "./types.js";

/** Router session address shape (same fields as OSGP SessionAddress). */
export type RouterSessionAddress = SessionAddress;

/** Router session envelope used by the GlassVein router wire.
 *
 * Must match Rust `SessionEnvelope` with `#[serde(rename_all = "camelCase")]`:
 *   id, source, target, kind, linkType, subtype, payload, ttl, routeHops, originSurface
 *
 * Note: `target` is required (Rust SessionEnvelope does not use Option).
 * For fan-out/upload events, set target = source.
 */
export interface RouterSessionEnvelope {
  readonly id: string;
  readonly source: RouterSessionAddress;
  readonly target: RouterSessionAddress;
  readonly kind: string;
  readonly linkType: OsgpType | string;
  readonly subtype: string;
  readonly payload: unknown;
  readonly ttl: number;
  readonly routeHops: readonly string[];
  readonly originSurface?: string | null; // compat: not canonical; use source/target addresses
}

/** Top-level router LinkMessage wrapper.
 *
 * Must match Rust `LinkMessage` with `#[serde(tag = "type", rename_all = "snake_case")]`:
 * fields are flat at the top level, NOT wrapped in a `data` key.
 */
export type LinkMessage =
  | { readonly type: "announce"; readonly address: RouterSessionAddress; readonly distance: number }
  | { readonly type: "envelope" } & RouterSessionEnvelope
  | { readonly type: "read_request"; readonly data: unknown }
  | { readonly type: "read_response"; readonly data: unknown }
  | { readonly type: "ping" }
  | { readonly type: "pong" };

/** Router Hello message for the outer connection handshake. */
export interface RouterHelloMessage {
  readonly nodeId: string;
  readonly role: Role;
  readonly addresses: readonly RouterSessionAddress[];
  readonly capabilities?: readonly string[];
}
