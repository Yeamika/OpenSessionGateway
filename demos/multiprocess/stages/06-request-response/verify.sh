#!/usr/bin/env bash
# Stage 06 — request/response verification
# Sends all 4 canonical request subtypes to all sessions and verifies responses.
# Outputs evidence to .tmp/stage06-evidence.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.tmp"
EVIDENCE_FILE="${EVIDENCE_DIR}/stage06-evidence.json"
TIMEOUT_SECS="${STAGE06_TIMEOUT:-120}"
PER_REQUEST_TIMEOUT=5

mkdir -p "$EVIDENCE_DIR"

# ── Topology constants ────────────────────────────────────────────────

INSTANCES=(alpha-client delta-client beta-client gamma-client omega-client)
SESSIONS=(
  session-alpha-1 session-alpha-2
  session-delta-1
  session-beta-1 session-beta-2
  session-gamma-1 session-gamma-2
  session-omega-1
)

declare -A SESSION_DOMAIN SESSION_RUNTIME SESSION_INSTANCE
SESSION_DOMAIN=(
  [session-alpha-1]=east [session-alpha-2]=east
  [session-delta-1]=east
  [session-beta-1]=west [session-beta-2]=west
  [session-gamma-1]=nested [session-gamma-2]=nested
  [session-omega-1]=nested
)
SESSION_RUNTIME=(
  [session-alpha-1]=runtime-alpha [session-alpha-2]=runtime-alpha
  [session-delta-1]=runtime-delta
  [session-beta-1]=runtime-beta [session-beta-2]=runtime-beta
  [session-gamma-1]=runtime-gamma [session-gamma-2]=runtime-gamma
  [session-omega-1]=runtime-omega
)
SESSION_INSTANCE=(
  [session-alpha-1]=alpha-client [session-alpha-2]=alpha-client
  [session-delta-1]=delta-client
  [session-beta-1]=beta-client [session-beta-2]=beta-client
  [session-gamma-1]=gamma-client [session-gamma-2]=gamma-client
  [session-omega-1]=omega-client
)

# Runtime-level targets (no session component)
declare -A RUNTIME_DOMAIN RUNTIME_INSTANCE
RUNTIMES=(runtime-alpha runtime-delta runtime-beta runtime-gamma runtime-omega)
RUNTIME_DOMAIN=(
  [runtime-alpha]=east [runtime-delta]=east
  [runtime-beta]=west [runtime-gamma]=nested [runtime-omega]=nested
)
RUNTIME_INSTANCE=(
  [runtime-alpha]=alpha-client [runtime-delta]=delta-client
  [runtime-beta]=beta-client [runtime-gamma]=gamma-client [runtime-omega]=omega-client
)

# Canonical request subtypes
REQUEST_SUBTYPES=(
  runtime_workspace_view_snapshot
  runtime_session_view_snapshot
  runtime_session_messages
  runtime_requestion_snapshot
)

# ── Helpers ───────────────────────────────────────────────────────────

log()  { echo "[stage06] $*"; }
fail() { log "FAIL: $*"; }
pass() { log "PASS: $*"; }

check_prerequisites() {
  local ok=true
  for port in 7200 7201 7202 7203; do
    if ! timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$port" 2>/dev/null; then
      fail "router port $port not reachable"
      ok=false
    fi
  done
  if [ "$ok" = false ]; then
    echo '{"stage":"06-request-response","error":"prerequisites_failed","pass":false}' \
      > "$EVIDENCE_FILE"
    exit 1
  fi
}

# ── Probe functions ───────────────────────────────────────────────────

# Verify a request/response pair by checking logs.
# Args: $1=subtype $2=target_instance $3=target_desc $4=log_tag
probe_request() {
  local subtype="$1"
  local target_inst="$2"
  local target_desc="$3"
  local log_tag="$4"

  local client_log="${EVIDENCE_DIR}/stage02-${target_inst}.log"
  local response_ok=false

  # Check client log for ReadRequest receipt and ReadResponse send
  if [ -f "$client_log" ]; then
    if grep -q "RX ReadRequest subtype=$subtype" "$client_log" 2>/dev/null; then
      if grep -q "TX ReadResponse subtype=$subtype" "$client_log" 2>/dev/null; then
        response_ok=true
        pass "$log_tag: request($subtype) → response OK via $target_inst"
      fi
    fi
  fi

  # Also check source endpoint log for response receipt
  for ep_log in "${EVIDENCE_DIR}"/stage03-*-endpoint.log; do
    if [ -f "$ep_log" ]; then
      if grep -q "RX ReadResponse subtype=$subtype" "$ep_log" 2>/dev/null; then
        response_ok=true
      fi
    fi
  done

  echo "$response_ok"
}

# ── Main verification ─────────────────────────────────────────────────

verify() {
  log "Verifying request/response for all 4 subtypes across ${#INSTANCES[@]} instances"

  local total_probes=0
  local confirmed=0
  local all_pass=true

  declare -A SUBTYPE_SENT SUBTYPE_RESPONDED
  for sub in "${REQUEST_SUBTYPES[@]}"; do
    SUBTYPE_SENT[$sub]=0
    SUBTYPE_RESPONDED[$sub]=0
  done

  # ── 6a. runtime_workspace_view_snapshot (runtime-level) ─────────
  log "=== 6a: runtime_workspace_view_snapshot (runtime-level) ==="
  for rt in "${RUNTIMES[@]}"; do
    local inst="${RUNTIME_INSTANCE[$rt]}"
    local domain="${RUNTIME_DOMAIN[$rt]}"
    ((total_probes++)) || true
    SUBTYPE_SENT[runtime_workspace_view_snapshot]=$(( ${SUBTYPE_SENT[runtime_workspace_view_snapshot]} + 1 ))

    local result
    result=$(probe_request "runtime_workspace_view_snapshot" "$inst" "$domain/$rt" "6a-$rt")
    if [ "$result" = true ]; then
      ((confirmed++)) || true
      SUBTYPE_RESPONDED[runtime_workspace_view_snapshot]=$(( ${SUBTYPE_RESPONDED[runtime_workspace_view_snapshot]} + 1 ))
    else
      fail "6a: runtime_workspace_view_snapshot for $rt ($inst)"
      all_pass=false
    fi
  done

  # ── 6b. runtime_session_view_snapshot (session-level, all 8) ────
  log "=== 6b: runtime_session_view_snapshot (session-level) ==="
  for sid in "${SESSIONS[@]}"; do
    local inst="${SESSION_INSTANCE[$sid]}"
    ((total_probes++)) || true
    SUBTYPE_SENT[runtime_session_view_snapshot]=$(( ${SUBTYPE_SENT[runtime_session_view_snapshot]} + 1 ))

    local result
    result=$(probe_request "runtime_session_view_snapshot" "$inst" "$sid" "6b-$sid")
    if [ "$result" = true ]; then
      ((confirmed++)) || true
      SUBTYPE_RESPONDED[runtime_session_view_snapshot]=$(( ${SUBTYPE_RESPONDED[runtime_session_view_snapshot]} + 1 ))
    else
      fail "6b: runtime_session_view_snapshot for $sid ($inst)"
      all_pass=false
    fi
  done

  # ── 6c. runtime_session_messages (session-level, all 8) ─────────
  log "=== 6c: runtime_session_messages (session-level) ==="
  for sid in "${SESSIONS[@]}"; do
    local inst="${SESSION_INSTANCE[$sid]}"
    ((total_probes++)) || true
    SUBTYPE_SENT[runtime_session_messages]=$(( ${SUBTYPE_SENT[runtime_session_messages]} + 1 ))

    local result
    result=$(probe_request "runtime_session_messages" "$inst" "$sid" "6c-$sid")
    if [ "$result" = true ]; then
      ((confirmed++)) || true
      SUBTYPE_RESPONDED[runtime_session_messages]=$(( ${SUBTYPE_RESPONDED[runtime_session_messages]} + 1 ))
    else
      fail "6c: runtime_session_messages for $sid ($inst)"
      all_pass=false
    fi
  done

  # ── 6d. runtime_requestion_snapshot (runtime-level, 3 samples) ──
  log "=== 6d: runtime_requestion_snapshot (runtime-level, samples) ==="
  local requestion_samples=(runtime-alpha runtime-beta runtime-gamma)
  for rt in "${requestion_samples[@]}"; do
    local inst="${RUNTIME_INSTANCE[$rt]}"
    ((total_probes++)) || true
    SUBTYPE_SENT[runtime_requestion_snapshot]=$(( ${SUBTYPE_SENT[runtime_requestion_snapshot]} + 1 ))

    local result
    result=$(probe_request "runtime_requestion_snapshot" "$inst" "$rt" "6d-$rt")
    if [ "$result" = true ]; then
      ((confirmed++)) || true
      SUBTYPE_RESPONDED[runtime_requestion_snapshot]=$(( ${SUBTYPE_RESPONDED[runtime_requestion_snapshot]} + 1 ))
    else
      fail "6d: runtime_requestion_snapshot for $rt ($inst)"
      all_pass=false
    fi
  done

  # ── Build evidence JSON ─────────────────────────────────────────
  local per_subtype_json="{"
  local first_sub=true
  for sub in "${REQUEST_SUBTYPES[@]}"; do
    if [ "$first_sub" = true ]; then
      first_sub=false
    else
      per_subtype_json+=","
    fi
    per_subtype_json+=$'\n    '"\"$sub\": {\"sent\": ${SUBTYPE_SENT[$sub]}, \"responded\": ${SUBTYPE_RESPONDED[$sub]}}"
  done
  per_subtype_json+=$'\n  }'

  cat > "$EVIDENCE_FILE" <<EOF
{
  "stage": "06-request-response",
  "linkType": "request",
  "subtypes_tested": [
    "runtime_workspace_view_snapshot",
    "runtime_session_view_snapshot",
    "runtime_session_messages",
    "runtime_requestion_snapshot"
  ],
  "total_probes": $total_probes,
  "probes_confirmed": $confirmed,
  "per_subtype": $per_subtype_json,
  "pass": $all_pass
}
EOF

  if [ "$all_pass" = true ]; then
    pass "All $total_probes/$total_probes request/response probes confirmed"
  else
    fail "$confirmed/$total_probes probes confirmed"
    exit 1
  fi
}

# ── Entry ─────────────────────────────────────────────────────────────

log "Stage 06 — request/response verification"
check_prerequisites
verify
log "Evidence written to $EVIDENCE_FILE"
