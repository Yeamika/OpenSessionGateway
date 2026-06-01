#!/usr/bin/env bash
# Stage 07 — Requestion Flow Smoke
#
# Bounded smoke test for the requestion lifecycle:
#   requestion_asked → requestion_updated → requestion_resolved → requestion_cancelled
#   + control/requestion_respond via web API
#
# Prerequisites: routers + alpha-client running (stages 01–02).
# Does NOT start routers. Kills requestion-endpoint on exit.
#
# Usage: bash run.sh [--timeout 60]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE_ROOT="$(cd "$DEMO_ROOT/../.." && pwd)"
EVIDENCE_DIR="$WORKSPACE_ROOT/.tmp"
EVIDENCE_FILE="$EVIDENCE_DIR/stage-07-evidence.json"

TIMEOUT=60
REQUESTION_PORT=7318
REQUESTION_API="http://127.0.0.1:${REQUESTION_PORT}"
EAST_ROUTER="ws://127.0.0.1:7201"
WEST_ROUTER="ws://127.0.0.1:7202"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

mkdir -p "$EVIDENCE_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────

PIDS=()

cleanup() {
  echo "[cleanup] Killing background processes..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  echo "[cleanup] Done."
}

trap cleanup EXIT

log() { echo "[stage-07] $(date +%H:%M:%S) $*"; }

start_requestion_endpoint() {
  log "Starting requestion-endpoint..."
  cargo run -p requestion-endpoint -- \
    --config "$SCRIPT_DIR/configs/requestion-west.json" \
    > "$EVIDENCE_DIR/stage-07-requestion-endpoint.log" 2>&1 &
  PIDS+=($!)
  log "requestion-endpoint PID=${PIDS[-1]}"

  # Wait for HTTP readiness
  for i in $(seq 1 30); do
    if curl -sf "$REQUESTION_API/api/config" > /dev/null 2>&1; then
      log "requestion-endpoint ready."
      return 0
    fi
    sleep 1
  done
  log "ERROR: requestion-endpoint did not become ready in 30s"
  return 1
}

send_requestion_upload() {
  local subtype="$1"
  local request_id="$2"
  local title="$3"
  local payload="{\"sessionID\":\"session-alpha-1\",\"requestID\":\"${request_id}\",\"title\":\"${title}\"}"

  log "Sending $subtype (requestID=$request_id)..."
  # Use a one-shot node script to send a single typed_envelope to east-router
  node -e "
    const ws = new WebSocket('${EAST_ROUTER}');
    ws.on('open', () => {
      ws.send(JSON.stringify({
        nodeId: 'stage07-sender',
        role: 'endpoint',
        addresses: [{ domain: 'east', runtime: 'runtime-alpha', session: 'session-alpha-1' }],
        capabilities: []
      }));
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'typed_envelope',
          messageId: crypto.randomUUID(),
          source: { address: { domain: 'east', runtime: 'runtime-alpha', session: 'session-alpha-1' } },
          target: { address: { domain: 'domain-a', runtime: 'requestion-endpoint', session: 'requestion-endpoint' } },
          linkType: 'upload',
          subtype: '${subtype}',
          payload: { text: ${payload} },
          routeHops: []
        }));
        setTimeout(() => ws.close(), 500);
      }, 200);
    });
    ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
  "
}

query_requestions() {
  curl -sf "$REQUESTION_API/api/requestions" 2>/dev/null || echo '{"requestions":[]}'
}

respond_requestion() {
  local request_id="$1"
  local decision="$2"
  log "Responding to $request_id with decision=$decision..."
  curl -sf -X POST "$REQUESTION_API/api/respond" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":\"session-alpha-1\",\"requestId\":\"${request_id}\",\"decision\":\"${decision}\"}" \
    > /dev/null 2>&1
}

# ── Scenario tracking ────────────────────────────────────────────────────

declare -A SCENARIO_STATUS
declare -A SCENARIO_DETAIL

record() {
  local id="$1" name="$2" status="$3" detail="$4"
  SCENARIO_STATUS["$id"]="$status"
  SCENARIO_DETAIL["$id"]="$detail"
  log "$id ($name): $status — $detail"
}

# ── Main ─────────────────────────────────────────────────────────────────

log "=== Stage 07: Requestion Flow ==="
log "Timeout: ${TIMEOUT}s"

# Deadline
DEADLINE=$((SECONDS + TIMEOUT))

# [1] Start requestion-endpoint
start_requestion_endpoint

# [2] S07-1: requestion_asked
send_requestion_upload "requestion_asked" "req-001" "demo permission"
sleep 2
RESULT=$(query_requestions)
if echo "$RESULT" | grep -q "req-001"; then
  record "S07-1" "requestion_asked" "pass" "req-001 found in cache"
else
  record "S07-1" "requestion_asked" "fail" "req-001 NOT in cache"
fi

# [3] S07-2: requestion_updated
send_requestion_upload "requestion_updated" "req-001" "updated title"
sleep 2
RESULT=$(query_requestions)
if echo "$RESULT" | grep -q "updated title"; then
  record "S07-2" "requestion_updated" "pass" "title updated in cache"
else
  record "S07-2" "requestion_updated" "fail" "title NOT updated"
fi

# [4] S07-3: requestion_resolved
send_requestion_upload "requestion_resolved" "req-001" ""
sleep 2
RESULT=$(query_requestions)
if echo "$RESULT" | grep -q "req-001"; then
  record "S07-3" "requestion_resolved" "fail" "req-001 still in cache"
else
  record "S07-3" "requestion_resolved" "pass" "req-001 removed from cache"
fi

# [5] S07-4: requestion_asked + requestion_cancelled
send_requestion_upload "requestion_asked" "req-002" "will cancel"
sleep 2
send_requestion_upload "requestion_cancelled" "req-002" ""
sleep 2
RESULT=$(query_requestions)
if echo "$RESULT" | grep -q "req-002"; then
  record "S07-4" "requestion_cancelled" "fail" "req-002 still in cache"
else
  record "S07-4" "requestion_cancelled" "pass" "req-002 removed from cache"
fi

# [6] S07-5: requestion_respond via web API
# First re-ask so we have something to respond to
send_requestion_upload "requestion_asked" "req-003" "respond target"
sleep 2
respond_requestion "req-003" "approve"
sleep 2
RESULT=$(query_requestions)
# After respond, the endpoint should emit requestion_resolved
if echo "$RESULT" | grep -q "req-003"; then
  record "S07-5" "requestion_respond" "fail" "req-003 still pending after respond"
else
  record "S07-5" "requestion_respond" "pass" "req-003 resolved after respond"
fi

# [7] Write evidence
log "Writing evidence to $EVIDENCE_FILE"
OVERALL="pass"
SCENARIOS_JSON="["
FIRST=true
for id in S07-1 S07-2 S07-3 S07-4 S07-5; do
  name=""
  case "$id" in
    S07-1) name="requestion_asked" ;;
    S07-2) name="requestion_updated" ;;
    S07-3) name="requestion_resolved" ;;
    S07-4) name="requestion_cancelled" ;;
    S07-5) name="requestion_respond" ;;
  esac
  status="${SCENARIO_STATUS[$id]:-unknown}"
  detail="${SCENARIO_DETAIL[$id]:-no data}"
  if [[ "$status" == "fail" ]]; then OVERALL="fail"; fi
  if $FIRST; then FIRST=false; else SCENARIOS_JSON+=","; fi
  SCENARIOS_JSON+="{\"id\":\"$id\",\"name\":\"$name\",\"status\":\"$status\",\"detail\":\"$detail\"}"
done
SCENARIOS_JSON+="]"

cat > "$EVIDENCE_FILE" <<EOF
{
  "stage": "07-requestion-flow",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "scenarios": $SCENARIOS_JSON,
  "overall": "$OVERALL"
}
EOF

log "=== Stage 07 complete: $OVERALL ==="
[[ "$OVERALL" == "pass" ]]
