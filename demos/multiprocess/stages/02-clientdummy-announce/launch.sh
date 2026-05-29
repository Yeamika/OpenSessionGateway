#!/usr/bin/env bash
# Stage 02: Launch all bash-clientdummy instances and verify announce.
#
# Prerequisites: Stage 01 routers must be running (7200-7203).
# Output: .tmp/gv-stage02-<timestamp>/
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GV_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BIN_DIR="${GV_ROOT}/target/debug"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="/workspace/OSG-Project/.tmp/gv-stage02-${TS}"
mkdir -p "$LOG_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

info "Stage 02 log dir: $LOG_DIR"

# ── Check prerequisites ──
info "Checking router prerequisites..."
for port in 7201 7202 7203; do
    if python3 -c "
import socket; s = socket.socket(); s.settimeout(2)
try: s.connect(('127.0.0.1', $port)); s.close(); exit(0)
except: exit(1)
" 2>/dev/null; then
        pass "Router on :${port} is listening"
    else
        fail "Router on :${port} not listening — run stage 01 first"
        exit 1
    fi
done

# ── Check binary ──
if [ ! -x "$BIN_DIR/bash-clientdummy" ]; then
    fail "Binary not found: $BIN_DIR/bash-clientdummy"
    info "Run: cargo build -p bash-clientdummy"
    exit 1
fi
pass "Binary found: $BIN_DIR/bash-clientdummy"

# ── Client definitions ──
declare -A CLIENT_ARGS=(
    ["alpha-client"]="--router-url ws://127.0.0.1:7201 --node-id alpha-client --domain east --runtime runtime-alpha --session session-alpha-1 --session session-alpha-2"
    ["delta-client"]="--router-url ws://127.0.0.1:7201 --node-id delta-client --domain east --runtime runtime-delta --session session-delta-1"
    ["beta-client"]="--router-url ws://127.0.0.1:7202 --node-id beta-client --domain west --runtime runtime-beta --session session-beta-1 --session session-beta-2"
    ["gamma-client"]="--router-url ws://127.0.0.1:7203 --node-id gamma-client --domain nested --runtime runtime-gamma --session session-gamma-1 --session session-gamma-2"
    ["omega-client"]="--router-url ws://127.0.0.1:7203 --node-id omega-client --domain nested --runtime runtime-omega --session session-omega-1"
)

declare -A EXPECTED_SESSIONS=(
    ["alpha-client"]="session-alpha-1 session-alpha-2"
    ["delta-client"]="session-delta-1"
    ["beta-client"]="session-beta-1 session-beta-2"
    ["gamma-client"]="session-gamma-1 session-gamma-2"
    ["omega-client"]="session-omega-1"
)

# ── Launch all instances (non-interactive, 30s listen) ──
PIDS_FILE="$LOG_DIR/processes.tsv"
echo -e "name\tpid\tstarted_at" > "$PIDS_FILE"
ALL_PIDS=()

cleanup() {
    info "Cleaning up stage 02 processes..."
    for pid in "${ALL_PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    info "Cleanup done"
}
trap cleanup EXIT

for client in alpha-client delta-client beta-client gamma-client omega-client; do
    info "Launching ${client}..."
    $BIN_DIR/bash-clientdummy ${CLIENT_ARGS[$client]} --listen-seconds 30 \
        > "$LOG_DIR/${client}.log" 2>&1 &
    pid=$!
    ALL_PIDS+=("$pid")
    echo -e "${client}\t${pid}\t$(date +%H:%M:%S)" >> "$PIDS_FILE"
    info "  PID: $pid"
    sleep 1
done

info "All 5 instances launched. Waiting 8s for startup..."
sleep 8

# ── Verify ──
info "=== Verifying stage 02 ==="
P=0
F=0

for client in alpha-client delta-client beta-client gamma-client omega-client; do
    logfile="$LOG_DIR/${client}.log"

    # Check connection
    if grep -q "WebSocket connected" "$logfile" 2>/dev/null; then
        pass "${client}: WebSocket connected"; ((P++))
    else
        fail "${client}: no WebSocket connected evidence"; ((F++))
    fi

    # Check LinkHandshake sent
    if grep -q "LinkHandshake sent" "$logfile" 2>/dev/null; then
        pass "${client}: LinkHandshake sent"; ((P++))
    else
        fail "${client}: no LinkHandshake evidence"; ((F++))
    fi

    # Check Announce for each session
    for session in ${EXPECTED_SESSIONS[$client]}; do
        if grep -q "Announce.*${session}" "$logfile" 2>/dev/null; then
            pass "${client}: Announce for ${session}"; ((P++))
        else
            fail "${client}: no Announce for ${session}"; ((F++))
        fi
    done

    # Check session_update sent for each session
    for session in ${EXPECTED_SESSIONS[$client]}; do
        if grep -q "session_update sent.*${session}" "$logfile" 2>/dev/null; then
            pass "${client}: session_update for ${session}"; ((P++))
        else
            fail "${client}: no session_update for ${session}"; ((F++))
        fi
    done

    # Check node_id in log
    if grep -q "node_id.*=$client" "$logfile" 2>/dev/null; then
        pass "${client}: node_id confirmed"; ((P++))
    else
        fail "${client}: node_id not in log"; ((F++))
    fi
done

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN} Stage 02 result: $P PASS, $F FAIL${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Log dir: $LOG_DIR"

# Write summary to evidence file
{
    echo "Stage 02: clientdummy-announce"
    echo "Timestamp: $TS"
    echo "Result: $P PASS, $F FAIL"
    echo "Log dir: $LOG_DIR"
    echo ""
    echo "Clients launched:"
    cat "$PIDS_FILE"
} > "$LOG_DIR/summary.txt"

[ "$F" -eq 0 ] && exit 0 || exit 1
