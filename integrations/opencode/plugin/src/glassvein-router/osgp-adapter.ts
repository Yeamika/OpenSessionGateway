/**
 * OSGP Adapter — bridges the @opensessiongateway/osgp SDK types
 * with the GlassVein Rust router wire format.
 *
 * The Rust router uses `LinkMessage` with `#[serde(tag = "type", rename_all = "snake_case")]`:
 *   { type: "envelope", id: "...", source: {...}, target: {...}, ... }  (flat, no `data` wrapper)
 *   { type: "announce", address: {...}, distance: 0 }                   (flat, no `data` wrapper)
 *   { type: "ping" } / { type: "pong" }
 *
 * The inner SessionEnvelope uses `type`/`subtype` fields (camelCase).
 * The SDK use `linkType`/`subtype` with `RouteTarget` source/target.
 *
 * This adapter provides:
 * - Conversions between SDK RouteTarget ↔ router SessionAddress
 * - Conversions between SDK OsgpEnvelope ↔ router SessionEnvelope
 * - Builder helpers that produce flat LinkMessage frames matching Rust serde.
 */

import type {
  SessionAddress as OsgpSessionAddress,
  RouteTarget,
  OsgpEnvelope,
  OsgpType,
  UploadSubtype,
  HelloMessage as OsgpHelloMessage,
  RouterSessionAddress,
  RouterSessionEnvelope,
  LinkMessage,
  RouterHelloMessage,
} from "@opensessiongateway/osgp"
import { createUpload, createHello } from "@opensessiongateway/osgp"

export type {
  RouterSessionAddress,
  RouterSessionEnvelope,
  LinkMessage,
  RouterHelloMessage,
} from "@opensessiongateway/osgp"

// ── RouteTarget ↔ RouterSessionAddress ────────────────────────────────

/**
 * Convert SDK RouteTarget to router SessionAddress.
 * Handles both `{ address: SessionAddress }` and `{ node, session? }` forms.
 */
export function routeTargetToRouterAddress(target: RouteTarget): RouterSessionAddress {
  if ("address" in target) {
    return {
      domain: target.address.domain,
      ...(target.address.runtime ? { runtime: target.address.runtime } : {}),
      ...(target.address.session ? { session: target.address.session } : {}),
    }
  }
  // { node: NodeId, session?: SessionId } → synthetic address
  const session = "session" in target ? target.session : undefined
  return {
    domain: target.node,
    ...(session ? { session } : {}),
  }
}

/**
 * Convert router SessionAddress to SDK SessionAddress.
 */
export function routerAddressToOsgp(address: RouterSessionAddress): OsgpSessionAddress {
  return {
    domain: address.domain,
    ...(address.runtime ? { runtime: address.runtime } : {}),
    ...(address.session ? { session: address.session } : {}),
  }
}

/**
 * Convert router SessionAddress to SDK RouteTarget.
 */
export function routerAddressToRouteTarget(address: RouterSessionAddress): RouteTarget {
  return { address: routerAddressToOsgp(address) }
}

// ── OsgpEnvelope ↔ RouterSessionEnvelope ───────────────────────────────

/**
 * Convert SDK OsgpEnvelope to router SessionEnvelope.
 * Produces flat fields matching Rust `#[serde(rename_all = "camelCase")]`.
 * Rust SessionEnvelope requires `target` (not optional), so we default to
 * source when no explicit target is set (fan-out/upload semantics).
 */
export function osgpEnvelopeToRouter(env: OsgpEnvelope): RouterSessionEnvelope {
  const linkType = env.linkType
  const sourceAddr = routeTargetToRouterAddress(env.source)
  const targetAddr = env.target
    ? routeTargetToRouterAddress(env.target)
    : sourceAddr // default target = source for fan-out events
  return {
    id: env.messageId ?? crypto.randomUUID(),
    source: sourceAddr,
    target: targetAddr,
    kind: linkType,
    linkType,
    subtype: env.subtype,
    payload: env.payload,
    ttl: env.ttl ?? 32,
    routeHops: env.routeHops ? [...env.routeHops] : [],
    ...(env.originSurface ? { originSurface: env.originSurface } : {}),
  }
}

/**
 * Convert router SessionEnvelope to SDK OsgpEnvelope (partial).
 */
export function routerEnvelopeToOsgp(env: RouterSessionEnvelope): OsgpEnvelope {
  return {
    linkType: env.linkType as OsgpType,
    subtype: env.subtype,
    source: routerAddressToRouteTarget(env.source),
    ...(env.target ? { target: routerAddressToRouteTarget(env.target) } : {}),
    payload: (env.payload ?? {}) as Record<string, unknown>,
    messageId: env.id,
    ...(env.ttl ? { ttl: env.ttl } : {}),
    ...(env.routeHops ? { routeHops: env.routeHops } : {}),
    ...(env.originSurface ? { originSurface: env.originSurface } : {}),
  }
}

// ── Builder helpers ───────────────────────────────────────────────────

/**
 * Create a flat LinkMessage upload envelope matching Rust serde format.
 * No `data` wrapper — fields are spread at the top level.
 */
export function createUploadLinkMessage(
  subtype: UploadSubtype,
  sourceAddress: RouterSessionAddress,
  payload: Record<string, unknown>,
  options?: { ttl?: number; routeHops?: string[] },
): LinkMessage {
  const source = routerAddressToRouteTarget(sourceAddress)
  const envelope = createUpload(subtype, source, payload)
  const routerEnv = osgpEnvelopeToRouter(envelope)
  return {
    type: "envelope",
    ...routerEnv,
  }
}

/**
 * Create a router-compatible Hello message from an SDK Hello.
 */
export function createRouterHello(
  nodeId: string,
  role: "endpoint" | "router",
  addresses: RouterSessionAddress[],
  capabilities?: string[],
): RouterHelloMessage {
  const hello = createHello({
    nodeId,
    role,
    addresses: addresses.map(routerAddressToOsgp),
    capabilities: capabilities as readonly import("@opensessiongateway/osgp").Capability[],
  })
  return {
    nodeId: hello.nodeId,
    role: hello.role,
    addresses,
    ...(hello.capabilities ? { capabilities: hello.capabilities ? [...hello.capabilities] as string[] : undefined } : {}),
  }
}

/**
 * Create a flat LinkMessage announce matching Rust serde format.
 * No `data` wrapper — fields are spread at the top level.
 */
export function createAnnounceLinkMessage(
  address: RouterSessionAddress,
  distance: number,
): LinkMessage {
  return {
    type: "announce",
    address,
    distance,
  }
}
