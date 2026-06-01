#!/usr/bin/env bash
# Stage 04 — session_update broadcast verification
# Runs against already-running infrastructure (stages 01–03).
# Outputs evidence to .tmp/stage04-evidence.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.tmp"
EVIDENCE_FILE="${EVIDENCE_DIR}/stage04-evidence.json"
TIMEOUT_SECS="${STAGE04_TIMEOUT:-30}"

mkdir -p "$EVIDENCE_DIR"

# ── Topology constants ────────────────────────────────────────────────
# 5 instances, 8 sessions — must match PLAN.md coverage matrix
declare -A SESSION_DOMAIN SESSION_RUNTIME SESSION_INSTANCE
INSTANCES=(alpha-client delta-client beta-client gamma-client omega-client)
SESSIONS=(
  session-alpha-1 session-alpha-2
  session-delta-1
  session-beta-1 session-beta-2
  session-gamma-1 session-gamma-2
  session-omega-1
)

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

# ── Helpers ───────────────────────────────────────────────────────────

log()  { echo "[stage04] $*"; }
fail() { log "FAIL: $*"; }
pass() { log "PASS: $*"; }

check_prerequisites() {
  local ok=true
  # Check routers are listening (best-effort, non-destructive)
  for port in 7200 7201 7202 7203; do
    if ! timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$port" 2>/dev/null; then
      fail "router port $port not reachable"
      ok=false
    fi
  done
  if [ "$ok" = false ]; then
    echo '{"stage":"04-session-update-broadcast","error":"prerequisites_failed","pass":false}' \
      > "$EVIDENCE_FILE"
    exit 1
  fi
}

# ── Main verification ─────────────────────────────────────────────────

verify() {
  log "Verifying session_update broadcast for ${#SESSIONS[@]} sessions across ${#INSTANCES[@]} instances"
  log "Timeout: ${TIMEOUT_SECS}s"

  local total=${#SESSIONS[@]}
  local observed=0
  local details="[]"
  local all_pass=true

  # The bash-clientdummy instances send session_update automatically at startup.
  # This verification checks:
  #   1. Each instance's stdout/log confirms session_update was sent.
  #   2. Observer endpoints received the updates (via log grep or MCP query).
  #
  # In a full run, the orchestration script captures stdout from all instances
  # into .tmp/stage02-*.log files. We parse those here.

  for sid in "${SESSIONS[@]}"; do
    local inst="${SESSION_INSTANCE[$sid]}"
    local domain="${SESSION_DOMAIN[$sid]}"
    local runtime="${SESSION_RUNTIME[$sid]}"
    local log_pattern="session_update sent for ${sid}"
    local instance_log="${EVIDENCE_DIR}/stage02-${inst}.log"
    local found=false

    # Check sender log
    if [ -f "$instance_log" ]; then
      if grep -q "$log_pattern" "$instance_log" 2>/dev/null; then
        found=true
        pass "$sid: session_update sent (from $inst log)"
      fi
    fi

    # Check observer log (console-endpoint or session-control-endpoint)
    for obs_log in "${EVIDENCE_DIR}"/stage03-*-endpoint.log; do
      if [ -f "$obs_log" ]; then
        if grep -q "session_update" "$obs_log" 2>/dev/null \
           && grep -q "$sid" "$obs_log" 2>/dev/null; then
          found=true
        fi
      fi
    done

    if [ "$found" = true ]; then
      ((observed++)) || true
    else
      fail "$sid: session_update not confirmed ($inst@$domain/$runtime)"
      all_pass=false
    fi
  done

  # Write evidence
  cat > "$EVIDENCE_FILE" <<EOF
{
  "stage": "04-session-update-broadcast",
  "linkType": "upload",
  "subtype": "session_update",
  "total_sessions": $total,
  "sessions_observed": $observed,
  "instance_count": ${#INSTANCES[@]},
  "pass": $all_pass
}
EOF

  if [ "$all_pass" = true ]; then
    pass "All $total/$total session_update broadcasts confirmed"
  else
    fail "$observed/$total sessions confirmed"
    exit 1
  fi
}

# ── Entry ─────────────────────────────────────────────────────────────

log "Stage 04 — session_update broadcast verification"
check_prerequisites
verify
log "Evidence written to $EVIDENCE_FILE"
