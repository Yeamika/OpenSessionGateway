#!/usr/bin/env bash
# GlassVein multiprocess demo — Stage 02: bash-clientdummy Announce
#
# Starts 5 bash-clientdummy instances (8 sessions total).
# Each dummy announces all its sessions and sends initial session_update.
#
# Prerequisite: Stage 01 (routers running on 7200-7203).
# Dependency: bash-clientdummy binary (GVW6-BashClientDummy-Worker-MIMO).
#
# Exit 0 = all PASS (or PENDING if binary missing), Exit 1 = FAIL.

set -euo pipefail

export STAGE_ID="02-clientdummy-announce"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../../scripts/common.sh"

P=0
F=0
check_pass() { pass "$1"; P=$((P + 1)); }
check_fail() { fail "$1"; F=$((F + 1)); }

info "=== Stage 02: bash-clientdummy Announce ==="

# ── Check prerequisite: routers ──
for port in 7200 7201 7202 7203; do
    if ! port_is_listening "$port"; then
        fail "Router port :$port not listening — run Stage 01 first."
        exit 1
    fi
done
check_pass "All 4 router ports listening"

# ── Check bash-clientdummy binary ──
if [ ! -x "$BIN_DIR/bash-clientdummy" ]; then
    info ""
    info "PENDING: bash-clientdummy binary not found at $BIN_DIR/bash-clientdummy"
    info "  Dependency: GVW6-BashClientDummy-Worker-MIMO must complete first."
    info "  This stage will be retried once the binary is available."
    info ""
    print_summary 0 0
    exit 0
fi
check_pass "bash-clientdummy binary found"

# ── Setup ──
setup_stage

# ── Dummy instance definitions ──
# Format: node-id|router-port|domain|runtime|session1,session2,...
INSTANCES=(
    "alpha-client|7201|east|runtime-alpha|session-alpha-1,session-alpha-2"
    "delta-client|7201|east|runtime-delta|session-delta-1"
    "beta-client|7202|west|runtime-beta|session-beta-1,session-beta-2"
    "gamma-client|7203|nested|runtime-gamma|session-gamma-1,session-gamma-2"
    "omega-client|7203|nested|runtime-omega|session-omega-1"
)

# ── Launch instances ──
for def in "${INSTANCES[@]}"; do
    IFS='|' read -r node_id router_port domain runtime sessions_csv <<< "$def"
    IFS=',' read -ra sessions <<< "$sessions_csv"

    CMD=("$BIN_DIR/bash-clientdummy"
         "--router-url" "ws://127.0.0.1:${router_port}"
         "--node-id" "$node_id"
         "--domain" "$domain"
         "--runtime" "$runtime"
         "--stay-alive")
    for s in "${sessions[@]}"; do
        CMD+=("--session" "$s")
    done

    logfile="$LOG_DIR/${node_id}.log"
    info "Starting $node_id -> :${router_port} (${#sessions[@]} sessions)..."
    setsid "${CMD[@]}" > "$logfile" 2>&1 &
    record_pid "$node_id" "$!" "${domain}/${runtime}"
    sleep 2
done

echo ""

# ── Verify announce evidence ──
info "Checking announce evidence in logs..."
announce_ok=0
for def in "${INSTANCES[@]}"; do
    IFS='|' read -r node_id _ _ _ _ <<< "$def"
    logfile="$LOG_DIR/${node_id}.log"
    if grep -q "Announce\|announce" "$logfile" 2>/dev/null; then
        check_pass "$node_id announced sessions"
        announce_ok=$((announce_ok + 1))
    else
        check_fail "$node_id no announce evidence in log"
    fi
done

# ── PID liveness ──
echo ""
info "PID liveness:"
while IFS=$'\t' read -r name pid extra ts; do
    if [ "$name" = "name" ]; then continue; fi
    if kill -0 "$pid" 2>/dev/null; then
        echo "  $name (PID $pid) ALIVE"
    else
        echo "  $name (PID $pid) DEAD"
    fi
done < "$PIDS_FILE"

echo ""
if [ $announce_ok -eq 5 ]; then
    check_pass "All 5 dummy instances announced (8 sessions total)"
else
    check_fail "Only $announce_ok/5 instances announced"
fi

info "Evidence: $LOG_DIR"
info "Processes remain running for downstream stages."
info "To stop: bash demos/multiprocess/scripts/cleanup.sh"

print_summary "$P" "$F"
exit 0
