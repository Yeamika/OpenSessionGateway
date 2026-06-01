#!/usr/bin/env bash
# GlassVein multiprocess demo — Stage 01: Router Boot
#
# Starts the 4 demo routers (root/east/west/nested) with bounded waits,
# verifies all ports are listening, then performs automatic cleanup.
#
# Router topology:
#   root-router   :7200  (no upstream)
#   east-router   :7201  upstream=ws://127.0.0.1:7200
#   west-router   :7202  upstream=ws://127.0.0.1:7200
#   nested-router :7203  upstream=ws://127.0.0.1:7202
#
# State files are copied from demos/ templates into the runtime log dir.
# Grants are NOT modified — they come from the templates as-is.
# If templates are missing, the stage reports a dependency failure.
#
# Usage:
#   bash demos/multiprocess/stages/01-router-boot/run.sh [--keep-alive SECONDS]
#
# Options:
#   --keep-alive N   Keep routers alive for N seconds after boot (default: 10).
#                    Processes are always cleaned up on exit regardless.
#
# Exit 0 = all PASS, Exit 1 = at least one FAIL.

set -euo pipefail

export STAGE_ID="01-router-boot"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../../scripts/common.sh"

# ── Parse options ──
KEEP_ALIVE=10
while [ $# -gt 0 ]; do
    case "$1" in
        --keep-alive)
            KEEP_ALIVE="${2:?--keep-alive requires a value}"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ── Setup ──
require_binary "router"
setup_stage  # creates LOG_DIR, init_pid_tracking
cleanup_on_failure  # kill processes only if stage fails

STATE_DIR="$LOG_DIR/state"
mkdir -p "$STATE_DIR"

P=0
F=0
check_pass() { pass "$1"; P=$((P + 1)); }
check_fail() { fail "$1"; F=$((F + 1)); }

info "=== Stage 01: Router Boot ==="
info "KEEP_ALIVE: ${KEEP_ALIVE}s"
echo ""

# ── Copy state-file templates ──
# Templates live in demos/ and are maintained by the Topology/State worker.
# We copy them as-is; grants are not modified here.
info "Copying state-file templates from demos/ ..."
for name in root east west nested; do
    copy_state_template "$name" "$STATE_DIR"
done
check_pass "State templates copied to $STATE_DIR"
echo ""

# ── Define router configurations ──
# Format: name node-id bind-port [upstream-url]
declare -A ROUTER_CONFIG
ROUTER_CONFIG[root]="root-router|127.0.0.1:7200|"
ROUTER_CONFIG[east]="east-router|127.0.0.1:7201|ws://127.0.0.1:7200"
ROUTER_CONFIG[west]="west-router|127.0.0.1:7202|ws://127.0.0.1:7200"
ROUTER_CONFIG[nested]="nested-router|127.0.0.1:7203|ws://127.0.0.1:7202"

ROUTER_ORDER=("root" "east" "west" "nested")
declare -A ROUTER_PORT
ROUTER_PORT[root]=7200
ROUTER_PORT[east]=7201
ROUTER_PORT[west]=7202
ROUTER_PORT[nested]=7203

# ── Start routers in dependency order ──
for name in "${ROUTER_ORDER[@]}"; do
    IFS='|' read -r node_id bind_addr upstream_url <<< "${ROUTER_CONFIG[$name]}"
    port="${ROUTER_PORT[$name]}"
    logfile="$LOG_DIR/${name}-router.log"
    statefile="$STATE_DIR/demo-state-${name}.json"

    # Build router command
    CMD=("$BIN_DIR/router"
         "--node-id" "$node_id"
         "--bind-addr" "$bind_addr"
         "--state-file" "$statefile"
         "--tap-capacity" "128")

    if [ -n "$upstream_url" ]; then
        CMD+=("--upstream-url" "$upstream_url")
    fi

    info "Starting ${name}-router (${node_id}) on :${port} ..."
    setsid "${CMD[@]}" > "$logfile" 2>&1 &
    pid=$!
    record_pid "${name}-router" "$pid" ":${port}"

    # Wait for port to become available
    if wait_for_port "$port" 20; then
        check_pass "${name}-router :${port} listening"
    else
        check_fail "${name}-router :${port} not listening after 20s"
        # If root fails, downstream routers can't connect; abort early
        if [ "$name" = "root" ]; then
            fail "root-router failed — cannot start downstream routers"
            print_summary "$P" "$F"
            exit 1
        fi
    fi

    # Brief pause between router starts for upstream to stabilize
    sleep 1
done

echo ""

# ── Verify router logs ──
info "Verifying router log contents ..."
for name in "${ROUTER_ORDER[@]}"; do
    logfile="$LOG_DIR/${name}-router.log"
    node_id="${ROUTER_CONFIG[$name]%%|*}"

    if wait_for_log "$logfile" "listening" 10; then
        check_pass "${name}-router log contains 'listening'"
    else
        check_fail "${name}-router log missing 'listening' message"
    fi
done

echo ""

# ── Verify all 4 ports simultaneously ──
info "Final port verification (all 4 routers) ..."
ALL_UP=true
for name in "${ROUTER_ORDER[@]}"; do
    port="${ROUTER_PORT[$name]}"
    if port_is_listening "$port"; then
        check_pass "Port :${port} (${name}-router) LISTENING"
    else
        check_fail "Port :${port} (${name}-router) NOT LISTENING"
        ALL_UP=false
    fi
done

echo ""

# ── Keep alive for observation (bounded) ──
if [ "$ALL_UP" = true ] && [ "$KEEP_ALIVE" -gt 0 ]; then
    info "All routers up. Keeping alive for ${KEEP_ALIVE}s for observation ..."
    info "(PIDs tracked in $PIDS_FILE)"
    sleep "$KEEP_ALIVE"
fi

# ── Capture final evidence ──
info "Capturing evidence snapshot ..."
{
    echo "=== Stage 01 Router Boot Evidence ==="
    echo "Timestamp: $(date -Iseconds)"
    echo ""
    echo "=== PID table ==="
    cat "$PIDS_FILE"
    echo ""
    echo "=== Port status ==="
    for name in "${ROUTER_ORDER[@]}"; do
        port="${ROUTER_PORT[$name]}"
        if port_is_listening "$port"; then
            echo "  :${port} ${name}-router LISTENING"
        else
            echo "  :${port} ${name}-router NOT LISTENING"
        fi
    done
    echo ""
    echo "=== Router log tails ==="
    for name in "${ROUTER_ORDER[@]}"; do
        echo "--- ${name}-router (last 10 lines) ---"
        tail -10 "$LOG_DIR/${name}-router.log" 2>/dev/null || echo "(no log)"
        echo ""
    done
} > "$LOG_DIR/evidence.txt" 2>&1

info "Evidence written to $LOG_DIR/evidence.txt"
echo ""

# ── Done ──
info "Stage 01 complete. Routers left running for downstream stages."
info "To stop: bash demos/multiprocess/scripts/cleanup.sh"

print_summary "$P" "$F"
# Exit 0 = success, processes stay alive (setsid detached them)
exit 0
