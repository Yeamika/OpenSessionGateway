/**
 * @opensessiongateway/osgp — OSGP protocol types, builders, and codec.
 *
 * This is a **protocol-only** package. It defines the OSGP wire format
 * types and provides lightweight builders, type guards, and JSON
 * encode/decode helpers. No transport (WebSocket, HTTP, etc.) types
 * are exported from this package.
 *
 * ## Quick start
 *
 * ```ts
 * import {
 *   createHello,
 *   createUpload,
 *   createControl,
 *   encodeOsgpFrame,
 *   decodeOsgpFrame,
 * } from "@opensessiongateway/osgp";
 *
 * // Build a Hello
 * const hello = createHello({
 *   nodeId: "my-endpoint",
 *   role: "endpoint",
 *   capabilities: ["surface_viewer"],
 * });
 *
 * // Encode and send
 * const frame = encodeOsgpFrame(hello);
 * // ... send over WebSocket ...
 *
 * // Decode received frame
 * const decoded = decodeOsgpFrame(rawText);
 * if (decoded.kind === "envelope") {
 *   console.log(decoded.value.linkType, decoded.value.subtype);
 * }
 * ```
 */

// ── Types ────────────────────────────────────────────────────────────

export type {
  OsgpType,
  UploadSubtype,
  ControlSubtype,
  RequestSubtype,
  ResponseSubtype,
  OsgpSubtype,
  SessionAddress,
  RouteTarget,
  Role,
  Capability,
  HelloMessage,
  OsgpEnvelope,
  Payload,
  UploadEnvelope,
  ControlEnvelope,
  RequestEnvelope,
  ResponseEnvelope,
  OsgpFrame,
  OsgpPing,
  OsgpPong,
  Domain,
  RuntimeId,
  SessionId,
  NodeId,
  Uuid,
} from "./types.js";

export type {
  RouterSessionAddress,
  RouterSessionEnvelope,
  LinkMessage,
  RouterHelloMessage,
} from "./router-wire.js";

export {
  UPLOAD_SUBTYPES,
  CONTROL_SUBTYPES,
  REQUEST_SUBTYPES,
} from "./types.js";

// ── Hello ────────────────────────────────────────────────────────────

export { createHello, isHelloMessage } from "./hello.js";
export type { HelloOptions } from "./hello.js";

// ── Envelope ─────────────────────────────────────────────────────────

export {
  isOsgpType,
  isOsgpEnvelope,
  isUploadEnvelope,
  isControlEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  createEnvelope,
  createUpload,
  createControl,
  createRequest,
  createResponse,
  encodeOsgpFrame,
  decodeOsgpFrame,
} from "./envelope.js";
