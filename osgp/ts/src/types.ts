/**
 * OSGP core protocol types.
 *
 * These types mirror the GlassVein Rust `osgp` (osgp/rust) wire format.
 * This is a **protocol package** — no transport (WebSocket, HTTP, etc.)
 * types belong here.
 *
 * ## Wire format conventions
 *
 * - JSON over text frames (WebSocket) or equivalent byte streams.
 * - `camelCase` field names on the wire.
 * - `linkType` is the canonical type discriminator (`upload` / `control` /
 *   `request` / `response`).
 * - `subtype` is the canonical business-level discriminator within each type.
 */

// ── Primitive aliases ────────────────────────────────────────────────

/** A domain string (e.g. `"domain-a"`). */
export type Domain = string;

/** A runtime identifier within a domain. */
export type RuntimeId = string;

/** A session identifier within a runtime. */
export type SessionId = string;

/** A node identifier (router or endpoint). */
export type NodeId = string;

/** UUID v4 string used as message/correlation IDs. */
export type Uuid = string;

// ── OSGP type / subtype ──────────────────────────────────────────────

/**
 * Canonical OSGP type discriminator.
 *
 * Maps directly to `linkType` on the wire.
 */
export type OsgpType = "upload" | "control" | "request" | "response";

/** Upload subtypes — fan-out events from router to observers. */
export type UploadSubtype =
  | "session_update"
  | "requestion_asked"
  | "requestion_resolved"
  | "requestion_updated"
  | "requestion_cancelled";

/** Control subtypes — commands from surface to router. */
export type ControlSubtype =
  | "add_prompt"
  | "abort_session"
  | "compact_session"
  | "create_session"
  | "rename_session"
  | "resume_session"
  | "requestion_respond";

/** Request subtypes — read/query operations from surface to router (canonical P-request). */
export type RequestSubtype =
  | "runtime_workspace_view_snapshot"
  | "runtime_requestion_snapshot"
  | "runtime_session_view_snapshot"
  | "runtime_session_messages";

/**
 * Response subtypes mirror the request/control subtype they answer.
 * Represented as string to allow arbitrary response echoes.
 */
export type ResponseSubtype = string;

/** Union of all canonical subtypes. */
export type OsgpSubtype = UploadSubtype | ControlSubtype | RequestSubtype | ResponseSubtype;

/** Complete subtype list for runtime lookup. */
export const UPLOAD_SUBTYPES: readonly UploadSubtype[] = [
  "session_update",
  "requestion_asked",
  "requestion_resolved",
  "requestion_updated",
  "requestion_cancelled",
];

export const CONTROL_SUBTYPES: readonly ControlSubtype[] = [
  "add_prompt",
  "abort_session",
  "compact_session",
  "create_session",
  "rename_session",
  "resume_session",
  "requestion_respond",
];

export const REQUEST_SUBTYPES: readonly RequestSubtype[] = [
  "runtime_workspace_view_snapshot",
  "runtime_requestion_snapshot",
  "runtime_session_view_snapshot",
  "runtime_session_messages",
];

// ── Session address ──────────────────────────────────────────────────

/**
 * Three-level address: `domain[/runtime[/session]]`.
 *
 * Wire fields: `domain`, `runtime?`, `session?`.
 */
export interface SessionAddress {
  readonly domain: Domain;
  readonly runtime?: RuntimeId;
  readonly session?: SessionId;
}

// ── Route target ─────────────────────────────────────────────────────

/**
 * Route target — either an address or a node reference.
 *
 * Wire format uses a tagged union:
 * - `{ "address": SessionAddress }`
 * - `{ "node": NodeId }`
 * - `{ "node": NodeId, "session": SessionId }`
 */
export type RouteTarget =
  | { readonly address: SessionAddress }
  | { readonly node: NodeId }
  | { readonly node: NodeId; readonly session: SessionId };

// ── Role ─────────────────────────────────────────────────────────────

/**
 * Peer role declared during Hello handshake.
 *
 * - `endpoint`: generic connected node (client, surface, etc.)
 * - `router`: participates in route propagation
 */
export type Role = "endpoint" | "router";

/**
 * Well-known capability strings.
 *
 * Endpoints declare these in the Hello `capabilities` array;
 * routers use them for fan-out routing decisions.
 */
export type Capability =
  | "surface_viewer"
  | "surface_control"
  | "session_host";

// ── Hello message ────────────────────────────────────────────────────

/**
 * OSGP Hello message — first frame exchanged after connection.
 *
 * Wire fields use `camelCase`.
 */
export interface HelloMessage {
  readonly nodeId: NodeId;
  readonly role: Role;
  readonly addresses?: readonly SessionAddress[];
  readonly capabilities?: readonly Capability[];
}

// ── Envelope ─────────────────────────────────────────────────────────

/**
 * Generic OSGP envelope.
 *
 * `T` narrows the payload type. The wire has these mandatory fields:
 * - `linkType`: OSGP type discriminator
 * - `subtype`: business-level discriminator
 * - `source`: origin `RouteTarget`
 * - `target`: destination `RouteTarget` (upload fan-out may omit)
 * - `payload`: arbitrary JSON body
 *
 * Optional fields:
 * - `messageId`: UUID for correlation
 * - `ttl`: time-to-live hop count
 * - `routeHops`: accumulated router hops
 * - `originSurface`: surface that created the envelope
 */
export interface OsgpEnvelope<T extends Payload = Payload> {
  readonly linkType: OsgpType;
  readonly subtype: string;
  readonly source: RouteTarget;
  readonly target?: RouteTarget;
  readonly payload: T;
  readonly messageId?: Uuid;
  readonly ttl?: number;
  readonly routeHops?: readonly string[];
  readonly originSurface?: string;
}

/**
 * Opaque payload. Consumers narrow via `linkType` + `subtype`.
 */
export type Payload = Record<string, unknown>;

// ── Typed envelope helpers ───────────────────────────────────────────

/** Upload envelope — fan-out, typically no explicit target. */
export interface UploadEnvelope<T extends Payload = Payload>
  extends OsgpEnvelope<T> {
  readonly linkType: "upload";
  readonly subtype: UploadSubtype;
}

/** Control envelope — surface → router command. Requires target. */
export interface ControlEnvelope<T extends Payload = Payload>
  extends OsgpEnvelope<T> {
  readonly linkType: "control";
  readonly subtype: ControlSubtype;
  readonly target: RouteTarget;
}

/** Request envelope — surface → router read/query. Requires target. */
export interface RequestEnvelope<T extends Payload = Payload>
  extends OsgpEnvelope<T> {
  readonly linkType: "request";
  readonly subtype: RequestSubtype;
  readonly target: RouteTarget;
}

/** Response envelope — router → surface reply. */
export interface ResponseEnvelope<T extends Payload = Payload>
  extends OsgpEnvelope<T> {
  readonly linkType: "response";
  readonly subtype: ResponseSubtype;
}

// ── Wire-level message union ─────────────────────────────────────────

/**
 * Top-level OSGP frame: either a Hello handshake or an Envelope.
 */
export type OsgpFrame = HelloMessage | OsgpEnvelope;

// ── Ping/Pong (wire-level keep-alive, optional) ──────────────────────

export interface OsgpPing {
  readonly type: "ping";
}

export interface OsgpPong {
  readonly type: "pong";
}
