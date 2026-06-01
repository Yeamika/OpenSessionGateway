import assert from "node:assert/strict";
import {
  CONTROL_SUBTYPES,
  OSGP_TYPES,
  REQUEST_SUBTYPES,
  RESPONSE_SUBTYPES,
  UPLOAD_SUBTYPES,
  canonicalSubtypesFor,
  isCanonical,
  isControlEnvelope,
  isOsgpEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  isUploadEnvelope,
  normalizeSubtype,
  validateCanonical,
} from "../dist/index.js";

const expected = {
  upload: [
    "session_update",
    "requestion_asked",
    "requestion_updated",
    "requestion_resolved",
    "requestion_cancelled",
  ],
  control: [
    "add_prompt",
    "abort_session",
    "compact_session",
    "create_session",
    "rename_session",
    "resume_session",
    "requestion_respond",
  ],
  request: [
    "runtime_workspace_view_snapshot",
    "runtime_requestion_snapshot",
    "runtime_session_view_snapshot",
    "runtime_session_messages",
  ],
};
expected.response = [...expected.request, ...expected.control];

assert.deepEqual(OSGP_TYPES, ["upload", "control", "request", "response"]);
assert.deepEqual(UPLOAD_SUBTYPES, expected.upload);
assert.deepEqual(CONTROL_SUBTYPES, expected.control);
assert.deepEqual(REQUEST_SUBTYPES, expected.request);
assert.deepEqual(RESPONSE_SUBTYPES, expected.response);

for (const [linkType, subtypes] of Object.entries(expected)) {
  assert.deepEqual(canonicalSubtypesFor(linkType), subtypes);
  for (const subtype of subtypes) {
    assert.equal(isCanonical(linkType, subtype), true, `${linkType}/${subtype}`);
    assert.deepEqual(validateCanonical(linkType, subtype), { ok: true });
  }
}

for (const alias of [
  "list_workspaces",
  "read_workspace_info",
  "list_session_messages",
  "session_update_snapshot",
  "requestion_snapshot",
  "session_view_snapshot",
  "session_update_subscribe",
]) {
  assert.equal(isCanonical("request", alias), false, alias);
  assert.equal(isCanonical("response", alias), false, alias);
}

assert.equal(
  normalizeSubtype("request", "list_workspaces"),
  "runtime_workspace_view_snapshot",
);
assert.equal(
  normalizeSubtype("response", "list_session_messages"),
  "runtime_session_messages",
);
assert.equal(normalizeSubtype("control", "list_workspaces"), undefined);
assert.equal(normalizeSubtype("upload", "list_workspaces"), undefined);

const source = { address: { domain: "test" } };
const target = { address: { domain: "test", runtime: "rt" } };
const payload = {};

assert.equal(
  isUploadEnvelope({ linkType: "upload", subtype: "session_update", source, payload }),
  true,
);
assert.equal(
  isControlEnvelope({ linkType: "control", subtype: "add_prompt", source, target, payload }),
  true,
);
assert.equal(
  isRequestEnvelope({ linkType: "request", subtype: "runtime_session_messages", source, target, payload }),
  true,
);
assert.equal(
  isRequestEnvelope({ linkType: "request", subtype: "list_session_messages", source, target, payload }),
  false,
);
assert.equal(
  isResponseEnvelope({ linkType: "response", subtype: "add_prompt", source, target, payload }),
  true,
);
assert.equal(
  isResponseEnvelope({ linkType: "response", subtype: "runtime_session_messages", source, target, payload }),
  true,
);
assert.equal(
  isResponseEnvelope({ linkType: "response", subtype: "session_update", source, target, payload }),
  false,
);
assert.equal(
  isOsgpEnvelope({ linkType: "response", subtype: "unknown_response", source, target, payload }),
  false,
);

console.log("canonical registry runtime check passed");
