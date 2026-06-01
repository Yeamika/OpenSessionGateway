/**
 * OSGP Envelope builders, type guards, and JSON codec.
 *
 * Envelopes carry all business payloads after the Hello handshake.
 * The wire format uses `camelCase` field names with `linkType` as the
 * canonical type discriminator and `subtype` as the business discriminator.
 */

import type {
  ControlEnvelope,
  ControlSubtype,
  HelloMessage,
  OsgpEnvelope,
  OsgpType,
  Payload,
  RequestEnvelope,
  RequestSubtype,
  ResponseEnvelope,
  ResponseSubtype,
  RouteTarget,
  UploadEnvelope,
  UploadSubtype,
} from "./types.js";
import { isHelloMessage } from "./hello.js";
import { isCanonical, isOsgpType } from "./subtype-registry.js";

export { isOsgpType } from "./subtype-registry.js";

// ── Type guard ───────────────────────────────────────────────────────

/**
 * Type-guard: returns `true` if `value` looks like an OsgpEnvelope.
 *
 * Checks:
 * - `linkType` is a valid `OsgpType`
 * - `subtype` is canonical for that `linkType`
 * - `source` exists
 * - `payload` is a non-null object
 *
 * Does NOT deeply validate `source`/`target` structure or payload shape.
 */
export function isOsgpEnvelope(value: unknown): value is OsgpEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (!isOsgpType(obj["linkType"])) return false;
  if (typeof obj["subtype"] !== "string" || obj["subtype"].length === 0) {
    return false;
  }
  if (!isCanonical(obj["linkType"], obj["subtype"])) return false;
  if (typeof obj["source"] !== "object" || obj["source"] === null) return false;
  if (typeof obj["payload"] !== "object" || obj["payload"] === null) {
    return false;
  }

  return true;
}

/** Type-guard for upload envelopes. */
export function isUploadEnvelope(
  value: unknown,
): value is UploadEnvelope {
  if (!isOsgpEnvelope(value)) return false;
  return value.linkType === "upload" && isCanonical("upload", value.subtype);
}

/** Type-guard for control envelopes. */
export function isControlEnvelope(
  value: unknown,
): value is ControlEnvelope {
  if (!isOsgpEnvelope(value)) return false;
  return value.linkType === "control" && isCanonical("control", value.subtype);
}

/** Type-guard for request envelopes. */
export function isRequestEnvelope(
  value: unknown,
): value is RequestEnvelope {
  if (!isOsgpEnvelope(value)) return false;
  return value.linkType === "request" && isCanonical("request", value.subtype);
}

/** Type-guard for response envelopes. */
export function isResponseEnvelope(
  value: unknown,
): value is ResponseEnvelope {
  if (!isOsgpEnvelope(value)) return false;
  return value.linkType === "response" && isCanonical("response", value.subtype);
}

// ── Shared envelope builder internals ────────────────────────────────

let _seq = 0;

function freshMessageId(): string {
  _seq += 1;
  // Pseudo-UUID in standard 8-4-4-4-12 format matching RFC 4122 layout.
  const ts = Date.now().toString(16).padStart(16, "0");
  const seq = _seq.toString(16).padStart(8, "0");
  // Group layout: 8 - 4 - 4 - 4 - 12
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-4000-8000-${ts.slice(12, 16)}${seq}`;
}

interface EnvelopeBase {
  readonly source: RouteTarget;
  readonly target?: RouteTarget;
  readonly messageId?: string;
  readonly ttl?: number;
  readonly routeHops?: readonly string[];
  readonly originSurface?: string;
}

// ── Builders ─────────────────────────────────────────────────────────

/**
 * Create a generic OSGP envelope.
 *
 * Prefer the typed builders (`createUpload`, `createControl`, etc.)
 * for better type narrowing.
 */
export function createEnvelope<T extends Payload = Payload>(
  linkType: OsgpType,
  subtype: string,
  source: RouteTarget,
  payload: T,
  options?: EnvelopeBase,
): OsgpEnvelope<T> {
  const env: OsgpEnvelope<T> = {
    linkType,
    subtype,
    source: options?.source ?? source,
    payload,
    messageId: options?.messageId ?? freshMessageId(),
  };

  if (options?.target) {
    (env as { target?: RouteTarget }).target = options.target;
  }
  if (options?.ttl !== undefined) {
    (env as { ttl?: number }).ttl = options.ttl;
  }
  if (options?.routeHops) {
    (env as { routeHops?: readonly string[] }).routeHops = options.routeHops;
  }
  if (options?.originSurface) {
    (env as { originSurface?: string }).originSurface = options.originSurface;
  }

  return env;
}

/**
 * Create an **upload** envelope.
 *
 * Uploads are fan-out events; they typically have no explicit target
 * (the router broadcasts to observers).
 */
export function createUpload<T extends Payload = Payload>(
  subtype: UploadSubtype,
  source: RouteTarget,
  payload: T,
  options?: Omit<EnvelopeBase, "target">,
): UploadEnvelope<T> {
  return createEnvelope("upload", subtype, source, payload, options) as UploadEnvelope<T>;
}

/**
 * Create a **control** envelope (surface → router command).
 *
 * Control messages **require** a target.
 */
export function createControl<T extends Payload = Payload>(
  subtype: ControlSubtype,
  source: RouteTarget,
  target: RouteTarget,
  payload: T,
  options?: Omit<EnvelopeBase, "source" | "target">,
): ControlEnvelope<T> {
  return createEnvelope("control", subtype, source, payload, {
    ...options,
    source,
    target,
  }) as ControlEnvelope<T>;
}

/**
 * Create a **request** envelope (surface → router read/query).
 *
 * Request messages **require** a target.
 */
export function createRequest<T extends Payload = Payload>(
  subtype: RequestSubtype,
  source: RouteTarget,
  target: RouteTarget,
  payload: T,
  options?: Omit<EnvelopeBase, "source" | "target">,
): RequestEnvelope<T> {
  return createEnvelope("request", subtype, source, payload, {
    ...options,
    source,
    target,
  }) as RequestEnvelope<T>;
}

/**
 * Create a **response** envelope (router → surface reply).
 */
export function createResponse<T extends Payload = Payload>(
  subtype: ResponseSubtype,
  source: RouteTarget,
  target: RouteTarget,
  payload: T,
  options?: Omit<EnvelopeBase, "source" | "target">,
): ResponseEnvelope<T> {
  return createEnvelope("response", subtype, source, payload, {
    ...options,
    source,
    target,
  }) as ResponseEnvelope<T>;
}

// ── JSON codec ───────────────────────────────────────────────────────

/**
 * Encode an OSGP frame (Hello or Envelope) to a JSON string.
 *
 * Uses `JSON.stringify` with no replacer. Consumers that need
 * custom serialization should pre-process the object.
 */
export function encodeOsgpFrame(value: HelloMessage | OsgpEnvelope): string {
  return JSON.stringify(value);
}

/**
 * Decode a text frame into a typed OSGP value.
 *
 * Returns:
 * - `{ kind: "hello", value: HelloMessage }` for Hello frames
 * - `{ kind: "envelope", value: OsgpEnvelope }` for Envelope frames
 * - `{ kind: "error", error: unknown }` for unparseable frames
 */
export function decodeOsgpFrame(
  text: string,
):
  | { readonly kind: "hello"; readonly value: HelloMessage }
  | { readonly kind: "envelope"; readonly value: OsgpEnvelope }
  | { readonly kind: "error"; readonly error: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { kind: "error", error: err };
  }

  if (isHelloMessage(parsed)) {
    return { kind: "hello", value: parsed };
  }

  if (isOsgpEnvelope(parsed)) {
    return { kind: "envelope", value: parsed };
  }

  return {
    kind: "error",
    error: new Error("frame is neither a valid HelloMessage nor OsgpEnvelope"),
  };
}
