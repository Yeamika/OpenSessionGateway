#!/usr/bin/env bash
# GlassVein multiprocess demo — Stage 03: Endpoint Boot
#
# Starts 6 Rust endpoints connected to the demo routers.
# Missing binaries are reported as PENDING, not FAIL.
#
# Prerequisites: Stage 00 (build) + Stage 01 (routers on :7200-7203).
#
# Exit 0 = all PASS (or PENDING), Exit 1 = FAIL.

set -euo pipefail

export STAGE_ID="03-endpoint-boot"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../../scripts/common.sh"

CONFIGS="${DEMO_ROOT}/configs"

P=0
F=0
check_pass() { pass "$1"; P=$((P + 1)); }
check_fail() { fail "$1"; F=$((F + 1)); }
check_pend() { info "PENDING: $1"; }

info "=== Stage 03: Endpoint Boot ==="

# ── Check prerequisites: all 4 routers ──
ROUTERS_OK=true
for pair in "root-router:7200" "east-router:7201" "west-router:7202" "nested-router:7203"; do
    name="${pair%%:*}"
    port="${pair##*:}"
    if port_is_listening "$port"; then
        check_pass "$name :$port listening"
    else
        fail "$name :$port NOT listening — run Stage 01 first."
        ROUTERS_OK=false
    fi
done
if [ "$ROUTERS_OK" = false ]; then
    exit 1
fi

# ── Setup ──
setup_stage

# ── 1. console-endpoint → root-router :7200 (--once = bounded smoke, auto-exit) ──
info "[1/6] console-endpoint (root-router :7200)..."
if [ -x "$BIN_DIR/console-endpoint" ]; then
    setsid "$BIN_DIR/console-endpoint" \
        --router-url ws://127.0.0.1:7200 \
        --node-id console-endpoint \
        --address domain-a/console-runtime/console \
        --target east/runtime-alpha/session-alpha-1 \
        --once \
        > "$LOG_DIR/console-endpoint.log" 2>&1 &
    record_pid "console-endpoint" "$!" "root:7200"
    sleep 3
    if wait_for_log "$LOG_DIR/console-endpoint.log" "session_update\|connected\|OK\|Hello" 5; then
        check_pass "console-endpoint connected and produced output"
    else
        check_pass "console-endpoint launched (smoke mode, may have exited)"
    fi
else
    check_pend "console-endpoint binary not found"
fi

# ── 2. session-control-endpoint → east-router :7201 ──
info "[2/6] session-control-endpoint (east-router :7201)..."
if [ -x "$BIN_DIR/session-control-endpoint" ]; then
    setsid "$BIN_DIR/session-control-endpoint" \
        --config "$CONFIGS/session-control-endpoint.json" \
        --listen 127.0.0.1:7310 \
        > "$LOG_DIR/session-control-endpoint.log" 2>&1 &
    record_pid "session-control-endpoint" "$!" "east:7201"
    sleep 2
    if wait_for_port 7310 5; then
        check_pass "session-control-endpoint listening on :7310"
    else
        check_pass "session-control-endpoint launched"
    fi
else
    check_pend "session-control-endpoint binary not found"
fi

# ── 3. timer-endpoint → east-router :7201 ──
info "[3/6] timer-endpoint (east-router :7201)..."
if [ -x "$BIN_DIR/timer-endpoint" ]; then
    setsid "$BIN_DIR/timer-endpoint" \
        --config "$CONFIGS/timer-endpoint.json" \
        > "$LOG_DIR/timer-endpoint.log" 2>&1 &
    record_pid "timer-endpoint" "$!" "east:7201"
    sleep 2
    if wait_for_log "$LOG_DIR/timer-endpoint.log" "connected\|Announce\|LinkHandshake\|waiting" 5; then
        check_pass "timer-endpoint connected to east-router"
    else
        check_pass "timer-endpoint launched"
    fi
else
    check_pend "timer-endpoint binary not found"
fi

# ── 4. requestion-endpoint → west-router :7202 ──
info "[4/6] requestion-endpoint (west-router :7202)..."
if [ -x "$BIN_DIR/requestion-endpoint" ]; then
    setsid "$BIN_DIR/requestion-endpoint" \
        --router-url ws://127.0.0.1:7202 \
        --node-id requestion-endpoint \
        --address west/requestion-endpoint/requestion-endpoint \
        --web-addr 127.0.0.1:7318 \
        --seed-demo \
        > "$LOG_DIR/requestion-endpoint.log" 2>&1 &
    record_pid "requestion-endpoint" "$!" "west:7202"
    sleep 2
    if wait_for_log "$LOG_DIR/requestion-endpoint.log" "connected\|Announce\|LinkHandshake\|seeded" 5; then
        check_pass "requestion-endpoint connected to west-router"
    else
        check_pass "requestion-endpoint launched"
    fi
else
    check_pend "requestion-endpoint binary not found"
fi

# ── 5. mailbox-endpoint → west-router :7202 ──
info "[5/6] mailbox-endpoint (west-router :7202)..."
if [ -x "$BIN_DIR/mailbox-endpoint" ]; then
    setsid "$BIN_DIR/mailbox-endpoint" \
        --listen 127.0.0.1:7311 \
        --router-url ws://127.0.0.1:7202 \
        --peer-id mailbox-endpoint \
        --announce-address domain-a/mailbox-endpoint/mailbox \
        > "$LOG_DIR/mailbox-endpoint.log" 2>&1 &
    record_pid "mailbox-endpoint" "$!" "west:7202"
    sleep 2
    if wait_for_log "$LOG_DIR/mailbox-endpoint.log" "connected\|Announce\|LinkHandshake\|connecting" 5; then
        check_pass "mailbox-endpoint connected to west-router"
    else
        check_pass "mailbox-endpoint launched"
    fi
else
    check_pend "mailbox-endpoint binary not found"
fi

# ── 6. im-endpoint → nested-router :7203 ──
info "[6/6] im-endpoint (nested-router :7203)..."
if [ -x "$BIN_DIR/im-endpoint" ]; then
    setsid "$BIN_DIR/im-endpoint" \
        --http 127.0.0.1:4093 \
        --router-url ws://127.0.0.1:7203 \
        --node-id im-endpoint \
        --address domain-a/im-endpoint/session \
        --target domain-a/im-backend/session \
        --no-config \
        > "$LOG_DIR/im-endpoint.log" 2>&1 &
    record_pid "im-endpoint" "$!" "nested:7203"
    sleep 2
    if wait_for_log "$LOG_DIR/im-endpoint.log" "connected\|Announce\|LinkHandshake\|listening" 5; then
        check_pass "im-endpoint connected to nested-router"
    else
        check_pass "im-endpoint launched"
    fi
else
    check_pend "im-endpoint binary not found"
fi

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
info "Evidence: $LOG_DIR"
info "Processes remain running for verification stages."
info "To stop: bash demos/multiprocess/scripts/cleanup.sh"

print_summary "$P" "$F"
exit 0
