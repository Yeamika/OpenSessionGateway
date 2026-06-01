/**
 * Canonical subtype registry for OSGP business messages.
 *
 * This module is the TypeScript single source of truth for allowed
 * `(linkType, subtype)` pairs, mirroring Rust `osgp::subtype_registry`.
 *
 * ## Design
 *
 * - Each `OsgpType` has a fixed set of canonical subtypes.
 * - Response subtypes mirror request + control subtypes; no new subtypes
 *   are defined for responses.
 * - Compat aliases map old request names to canonical subtypes; they are NOT
 *   accepted as canonical — callers must normalize explicitly first.
 */

// ── Canonical link type / subtype lists (mirrors Rust) ────────────────

/** All four canonical OSGP business link types. */
export const OSGP_TYPES = [
  "upload",
  "control",
  "request",
  "response",
] as const;

/** Canonical OSGP type discriminator; maps directly to wire `linkType`. */
export type OsgpType = (typeof OSGP_TYPES)[number];

/** Upload subtypes (business state pushed from endpoint to viewers). */
export const UPLOAD_SUBTYPES = [
  "session_update",
  "requestion_asked",
  "requestion_updated",
  "requestion_resolved",
  "requestion_cancelled",
] as const;

/** Upload subtypes — fan-out events from router to observers. */
export type UploadSubtype = (typeof UPLOAD_SUBTYPES)[number];

/** Control subtypes (commands from endpoint to runtime). */
export const CONTROL_SUBTYPES = [
  "add_prompt",
  "abort_session",
  "compact_session",
  "create_session",
  "rename_session",
  "resume_session",
  "requestion_respond",
] as const;

/** Control subtypes — commands from surface to router. */
export type ControlSubtype = (typeof CONTROL_SUBTYPES)[number];

/** Request subtypes (queries from endpoint to runtime). */
export const REQUEST_SUBTYPES = [
  "runtime_workspace_view_snapshot",
  "runtime_requestion_snapshot",
  "runtime_session_view_snapshot",
  "runtime_session_messages",
] as const;

/** Request subtypes — read/query operations from surface to router. */
export type RequestSubtype = (typeof REQUEST_SUBTYPES)[number];

/** Response subtypes mirror request + control subtypes. */
export type ResponseSubtype = RequestSubtype | ControlSubtype;

/** Response subtypes = union of request + control (mirror). */
export const RESPONSE_SUBTYPES = [
  ...REQUEST_SUBTYPES,
  ...CONTROL_SUBTYPES,
] as const satisfies readonly ResponseSubtype[];

/** Union of all canonical subtypes. */
export type OsgpSubtype =
  | UploadSubtype
  | ControlSubtype
  | RequestSubtype
  | ResponseSubtype;

// ── Lookup registry ───────────────────────────────────────────────────

const EMPTY_SUBTYPES: readonly string[] = [];

const CANONICAL_SUBTYPES_BY_LINK_TYPE = {
  upload: UPLOAD_SUBTYPES,
  control: CONTROL_SUBTYPES,
  request: REQUEST_SUBTYPES,
  response: RESPONSE_SUBTYPES,
} as const satisfies Record<OsgpType, readonly string[]>;

const OSGP_TYPE_SET: ReadonlySet<string> = new Set(OSGP_TYPES);
const UPLOAD_SET: ReadonlySet<string> = new Set(UPLOAD_SUBTYPES);
const CONTROL_SET: ReadonlySet<string> = new Set(CONTROL_SUBTYPES);
const REQUEST_SET: ReadonlySet<string> = new Set(REQUEST_SUBTYPES);
const RESPONSE_SET: ReadonlySet<string> = new Set(RESPONSE_SUBTYPES);

const CANONICAL_SUBTYPE_SETS: Readonly<Record<OsgpType, ReadonlySet<string>>> = {
  upload: UPLOAD_SET,
  control: CONTROL_SET,
  request: REQUEST_SET,
  response: RESPONSE_SET,
};

// ── Compat aliases (explicit normalize only, NOT canonical) ───────────

/**
 * Map from legacy/deprecated request subtype names to canonical equivalents.
 *
 * These aliases are never accepted by `isCanonical()` / `validateCanonical()`.
 * Use `normalizeSubtype(linkType, subtype)` when decoding legacy frames.
 */
export const REQUEST_COMPAT_ALIASES: ReadonlyMap<string, RequestSubtype> =
  new Map<string, RequestSubtype>([
    ["list_workspaces", "runtime_workspace_view_snapshot"],
    ["read_workspace_info", "runtime_workspace_view_snapshot"],
    ["list_session_messages", "runtime_session_messages"],
    ["session_update_snapshot", "runtime_session_view_snapshot"],
    ["requestion_snapshot", "runtime_requestion_snapshot"],
    ["session_view_snapshot", "runtime_session_view_snapshot"],
    ["session_update_subscribe", "runtime_session_view_snapshot"],
  ]);

// ── Public API ────────────────────────────────────────────────────────

/** Type-guard: returns `true` if `value` is a canonical OSGP `linkType`. */
export function isOsgpType(value: unknown): value is OsgpType {
  return typeof value === "string" && OSGP_TYPE_SET.has(value);
}

export function canonicalSubtypesFor(
  linkType: "upload",
): typeof UPLOAD_SUBTYPES;
export function canonicalSubtypesFor(
  linkType: "control",
): typeof CONTROL_SUBTYPES;
export function canonicalSubtypesFor(
  linkType: "request",
): typeof REQUEST_SUBTYPES;
export function canonicalSubtypesFor(
  linkType: "response",
): typeof RESPONSE_SUBTYPES;
export function canonicalSubtypesFor(linkType: string): readonly string[];
/**
 * Return the canonical subtypes for a given link type.
 *
 * For `"response"`, returns the union of request + control subtypes.
 * For unknown link types, returns an empty array.
 */
export function canonicalSubtypesFor(linkType: string): readonly string[] {
  if (!isOsgpType(linkType)) return EMPTY_SUBTYPES;
  return CANONICAL_SUBTYPES_BY_LINK_TYPE[linkType];
}

/**
 * Check whether a `(linkType, subtype)` pair is in the canonical registry.
 *
 * Returns `true` only for known canonical pairs. Compat aliases return
 * `false` — use `normalizeSubtype(linkType, subtype)` if alias support is needed.
 */
export function isCanonical(linkType: string, subtype: string): boolean {
  if (!isOsgpType(linkType)) return false;
  return CANONICAL_SUBTYPE_SETS[linkType].has(subtype);
}

/**
 * Validate that a `(linkType, subtype)` pair is canonical.
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, error }` with a
 * descriptive message on failure.
 */
export function validateCanonical(
  linkType: string,
  subtype: string,
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (isCanonical(linkType, subtype)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `unknown subtype "${subtype}" for linkType "${linkType}"`,
  };
}

export function normalizeSubtype(
  linkType: "upload",
  subtype: string,
): UploadSubtype | undefined;
export function normalizeSubtype(
  linkType: "control",
  subtype: string,
): ControlSubtype | undefined;
export function normalizeSubtype(
  linkType: "request",
  subtype: string,
): RequestSubtype | undefined;
export function normalizeSubtype(
  linkType: "response",
  subtype: string,
): ResponseSubtype | undefined;
export function normalizeSubtype(
  linkType: string,
  subtype: string,
): OsgpSubtype | undefined;
/**
 * Normalize a subtype for a specific link type.
 *
 * Returns the canonical subtype when the input is already canonical, resolves
 * known request compat aliases for `request` and `response` frames, or returns
 * `undefined` when no canonical subtype exists for the pair.
 */
export function normalizeSubtype(
  linkType: string,
  subtype: string,
): OsgpSubtype | undefined {
  if (isCanonical(linkType, subtype)) return subtype as OsgpSubtype;

  if (linkType === "request" || linkType === "response") {
    const alias = REQUEST_COMPAT_ALIASES.get(subtype);
    if (alias && isCanonical(linkType, alias)) return alias;
  }

  return undefined;
}

// ── Type-level classifiers ────────────────────────────────────────────

/** Check whether a subtype string is a known upload subtype. */
export function isUploadSubtype(subtype: string): subtype is UploadSubtype {
  return UPLOAD_SET.has(subtype);
}

/** Check whether a subtype string is a known control subtype. */
export function isControlSubtype(subtype: string): subtype is ControlSubtype {
  return CONTROL_SET.has(subtype);
}

/** Check whether a subtype string is a known request subtype. */
export function isRequestSubtype(subtype: string): subtype is RequestSubtype {
  return REQUEST_SET.has(subtype);
}

/**
 * Check whether a subtype string is a valid response subtype.
 *
 * Response subtypes are the union of request + control subtypes.
 */
export function isResponseSubtype(
  subtype: string,
): subtype is ResponseSubtype {
  return RESPONSE_SET.has(subtype);
}

// Backward-compatible export name for alias lookup.
export { REQUEST_COMPAT_ALIASES as compatAliases };
