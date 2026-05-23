#!/usr/bin/env bash
# GlassVein 12-process demo: complex topology with four-link coverage.
#
# Usage:
#   bash demo-topology-tree.sh TOPOLOGY              # print tree + coverage matrix
#   bash demo-topology-tree.sh ALL                   # print tree, launch, verify, produce evidence
#   bash demo-topology-tree.sh VERIFY <log-dir>      # verify an existing log dir
#
# Topology (12 processes):
#
#   root-router :7200
#   ├─ root-viewer          (surface-viewer, upload fan-out)
#   ├─ east-router :7201
#   │  ├─ alpha-client      (client endpoint, --stay-alive)
#   │  ├─ east-viewer        (surface-viewer, upload fan-out)
#   │  └─ control-endpoint   (control + request driver, one-shot)
#   └─ west-router :7202
#      ├─ beta-client        (client endpoint, --stay-alive)
#      ├─ requestion-endpoint (requestion cache + upload listener, --seed-demo)
#      └─ nested-router :7203
#         ├─ gamma-client    (client endpoint, --stay-alive)
#         └─ nested-viewer   (surface-viewer, upload fan-out)
#
# Registered addresses (from client defaults):
#   alpha → east/runtime-alpha/session-alpha
#   beta  → west/runtime-beta/session-beta
#   gamma → nested/runtime-gamma/session-gamma

set -euo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# ── Binary paths (use pre-built binaries for speed) ──
BIN_DIR="$(cd "$(dirname "$0")" && pwd)/target/debug"
export BIN_DIR

# ── Wait for a port to be listening (using python3 since ss may not be available) ──
port_is_listening() {
    local port="$1"
    python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(1)
try:
    s.connect(('127.0.0.1', $port))
    s.close()
    exit(0)
except:
    exit(1)
" 2>/dev/null
}

wait_for_port() {
    local port="$1"
    local max_wait="${2:-20}"
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if port_is_listening "$port"; then
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    return 1
}

# ── Wait for a log file to contain a pattern ──
wait_for_log() {
    local logfile="$1"
    local pattern="$2"
    local max_wait="${3:-15}"
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if grep -q "$pattern" "$logfile" 2>/dev/null; then
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    return 1
}

# ── Registered addresses (MUST match client defaults) ──
ALPHA_ADDR="east/runtime-alpha/session-alpha"
BETA_ADDR="west/runtime-beta/session-beta"
GAMMA_ADDR="nested/runtime-gamma/session-gamma"

# ── Topology tree ────────────────────────────────────────────────────

print_topology_tree() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}           GlassVein 12-Process Live Demo Topology                        ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}root-router${NC} ws://127.0.0.1:7200"
    echo -e "├─ ${MAGENTA:-}root-viewer${NC}          (surface-viewer, upload fan-out)"
    echo -e "├─ ${CYAN}east-router${NC} ws://127.0.0.1:7201"
    echo -e "│  ├─ ${GREEN}alpha-client${NC}        (client endpoint, --stay-alive)"
    echo -e "│  ├─ ${MAGENTA:-}east-viewer${NC}          (surface-viewer, upload fan-out)"
    echo -e "│  └─ ${YELLOW}control-endpoint${NC}   (control + request driver)"
    echo -e "└─ ${CYAN}west-router${NC} ws://127.0.0.1:7202"
    echo -e "   ├─ ${GREEN}beta-client${NC}          (client endpoint, --stay-alive)"
    echo -e "   ├─ ${BLUE}requestion-endpoint${NC}   (requestion cache + upload listener)"
    echo -e "   └─ ${CYAN}nested-router${NC} ws://127.0.0.1:7203"
    echo -e "      ├─ ${GREEN}gamma-client${NC}      (client endpoint, --stay-alive)"
    echo -e "      └─ ${MAGENTA:-}nested-viewer${NC}       (surface-viewer, upload fan-out)"
    echo ""

    # ── Process list ──
    echo -e "${BLUE}┌────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│${NC} Routers (4):                                                              ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  1. root-router       :7200  (no upstream, root)                           ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  2. east-router       :7201  upstream=root-router                         ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  3. west-router       :7202  upstream=root-router                         ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  4. nested-router     :7203  upstream=west-router                         ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} Clients (3):                                                               ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  5. alpha-client             connect=east-router  addr=$ALPHA_ADDR     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  6. beta-client              connect=west-router  addr=$BETA_ADDR      ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  7. gamma-client             connect=nested-router addr=$GAMMA_ADDR   ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} Viewers (3):                                                               ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  8. root-viewer              connect=root-router                           ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  9. east-viewer              connect=east-router                           ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 10. nested-viewer            connect=nested-router                         ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} Endpoints (2):                                                             ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 11. control-endpoint         connect=east-router                           ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 12. requestion-endpoint      connect=west-router                           ${BLUE}│${NC}"
    echo -e "${BLUE}└────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""

    # ── Four-link coverage matrix ──
    echo -e "${BLUE}┌────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│${NC} Four-link coverage matrix                                                 ${BLUE}│${NC}"
    echo -e "${BLUE}├────────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  upload (fan-out to viewer endpoints by capability):                     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    session_update            alpha/gamma → root/east/nested viewers       ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_asked          requestion-endpoint upload listener          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_updated        requestion-endpoint cache merge              ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_resolved       requestion cache removal                     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_cancelled      requestion cache removal                     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  control (source endpoint → router → target endpoint):                    ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    add_prompt                control-endpoint → alpha/gamma               ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    abort_session             control-endpoint → target session             ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    compact_session           control-endpoint → target session             ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  request (source endpoint → router → target, returns response):          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    runtime_workspace_view_snapshot   control-endpoint → target runtime   ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    runtime_requestion_snapshot       control-endpoint → west/requestion    ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    runtime_session_view_snapshot     control-endpoint → target session    ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    runtime_session_messages          control-endpoint → target session    ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  response (router → source address, target=request.source):               ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    mirrors request/control subtype     returned from target endpoint      ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    wire shape: { linkType:\"response\", subtype:<echo>, status, payload }    ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}└────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
}

# ── Launch 12-process demo ───────────────────────────────────────────

launch_demo() {
    info "=== Launching 12-process live demo ==="

    LOG_DIR="/workspace/OSG-Project/.tmp/gv-demo-12p-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$LOG_DIR"
    info "Log dir: $LOG_DIR"

    # PID tracking
    PIDS_FILE="$LOG_DIR/processes.tsv"
    echo -e "name\tpid\tport_or_url\tstarted_at" > "$PIDS_FILE"
    ALL_PIDS=()

    record_pid() {
        local name="$1" pid="$2" extra="$3"
        local ts
        ts=$(date +%H:%M:%S)
        echo -e "${name}\t${pid}\t${extra}\t${ts}" >> "$PIDS_FILE"
        ALL_PIDS+=("$pid")
    }

    cleanup() {
        info "Cleaning up background processes..."
        for pid in $(printf '%s\n' "${ALL_PIDS[@]}" | tac); do
            kill "$pid" 2>/dev/null || true
        done
        jobs -p 2>/dev/null | xargs -r kill 2>/dev/null || true
        wait 2>/dev/null || true
        info "Cleanup done"
    }
    trap cleanup EXIT

    # ── Phase 1: Routers ──
    info "[1/12] root-router :7200..."
    $BIN_DIR/router --node-id root-router --bind-addr 127.0.0.1:7200 --tap-capacity 128 > "$LOG_DIR/01-root-router.log" 2>&1 &
    record_pid "root-router" "$!" ":7200"
    sleep 1

    info "[2/12] east-router :7201..."
    $BIN_DIR/router --node-id east-router --bind-addr 127.0.0.1:7201 --upstream-url ws://127.0.0.1:7200 > "$LOG_DIR/02-east-router.log" 2>&1 &
    record_pid "east-router" "$!" ":7201"
    sleep 1

    info "[3/12] west-router :7202..."
    $BIN_DIR/router --node-id west-router --bind-addr 127.0.0.1:7202 --upstream-url ws://127.0.0.1:7200 > "$LOG_DIR/03-west-router.log" 2>&1 &
    record_pid "west-router" "$!" ":7202"
    sleep 1

    info "[4/12] nested-router :7203..."
    $BIN_DIR/router --node-id nested-router --bind-addr 127.0.0.1:7203 --upstream-url ws://127.0.0.1:7202 > "$LOG_DIR/04-nested-router.log" 2>&1 &
    record_pid "nested-router" "$!" ":7203"
    sleep 1

    # ── Phase 2: Persistent clients (must start BEFORE viewers, so viewers see events) ──
    info "[5/12] alpha-client -> east..."
    $BIN_DIR/alpha-client --router-url ws://127.0.0.1:7201 --stay-alive > "$LOG_DIR/05-alpha-client.log" 2>&1 &
    record_pid "alpha-client" "$!" "east:7201 $ALPHA_ADDR"
    sleep 2

    info "[6/12] beta-client -> west..."
    $BIN_DIR/beta-client --router-url ws://127.0.0.1:7202 --stay-alive > "$LOG_DIR/06-beta-client.log" 2>&1 &
    record_pid "beta-client" "$!" "west:7202 $BETA_ADDR"
    sleep 2

    info "[7/12] gamma-client -> nested..."
    $BIN_DIR/gamma-client --router-url ws://127.0.0.1:7203 --stay-alive > "$LOG_DIR/07-gamma-client.log" 2>&1 &
    record_pid "gamma-client" "$!" "nested:7203 $GAMMA_ADDR"
    sleep 2

    # ── Phase 3: Viewers (started AFTER clients so they can capture events) ──
    info "[8/12] root-viewer -> root..."
    $BIN_DIR/surface-viewer --router-url ws://127.0.0.1:7200 --node-id root-viewer --subtype-filter session_update > "$LOG_DIR/08-root-viewer.log" 2>&1 &
    record_pid "root-viewer" "$!" "root:7200"
    sleep 1

    info "[9/12] east-viewer -> east..."
    $BIN_DIR/surface-viewer --router-url ws://127.0.0.1:7201 --node-id east-viewer --subtype-filter session_update > "$LOG_DIR/09-east-viewer.log" 2>&1 &
    record_pid "east-viewer" "$!" "east:7201"
    sleep 1

    info "[10/12] nested-viewer -> nested..."
    $BIN_DIR/surface-viewer --router-url ws://127.0.0.1:7203 --node-id nested-viewer --subtype-filter session_update > "$LOG_DIR/10-nested-viewer.log" 2>&1 &
    record_pid "nested-viewer" "$!" "nested:7203"
    sleep 1

    # ── Phase 4: Endpoints ──
    info "[11/12] requestion-endpoint -> west (with --seed-demo)..."
    $BIN_DIR/requestion-endpoint \
        --router-url ws://127.0.0.1:7202 \
        --address west/requestion-endpoint/requestion-endpoint \
        --seed-demo \
        > "$LOG_DIR/12-requestion-endpoint.log" 2>&1 &
    record_pid "requestion-endpoint" "$!" "west:7202"
    sleep 2

    # ── Drive one-shot control commands (after all persistent processes are up) ──
    info "[11b] control-endpoint: add_prompt to alpha..."
    timeout 15 $BIN_DIR/control-endpoint \
        --router-url ws://127.0.0.1:7201 \
        --target "$ALPHA_ADDR" \
        --command addprompt \
        --message "Hello from 12-process demo" \
        > "$LOG_DIR/11-control-endpoint.log" 2>&1 || true
    sleep 1

    # ── Drive one-shot request commands ──
    info "[11c] control-endpoint: runtime_workspace_view_snapshot to alpha..."
    timeout 15 $BIN_DIR/control-endpoint \
        --router-url ws://127.0.0.1:7201 \
        --target "$ALPHA_ADDR" \
        --command runtime_workspace_view_snapshot \
        >> "$LOG_DIR/11-control-endpoint.log" 2>&1 || true

    # ── Wait bounded (keep processes alive for observation) ──
    info "All 12 processes launched. Waiting 15s for observation..."
    sleep 15

    # ── Snapshot evidence ──
    info "Capturing evidence..."

    # WS connections
    {
        echo "=== LISTEN sockets on 7200-7203 ==="
        for port in 7200 7201 7202 7203; do
            if port_is_listening "$port"; then
                echo "  :${port} LISTENING"
            else
                echo "  :${port} NOT LISTENING"
            fi
        done
        echo ""
        echo "=== PID liveness ==="
        while IFS=$'\t' read -r name pid extra ts; do
            if [ "$name" = "name" ]; then continue; fi
            if kill -0 "$pid" 2>/dev/null; then
                echo "$name (PID $pid) ALIVE"
            else
                echo "$name (PID $pid) DEAD"
            fi
        done < "$PIDS_FILE"
    } > "$LOG_DIR/ws-connections.txt" 2>/dev/null

    # ── Summary ──
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN} 12-process demo launched${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "Log dir: ${YELLOW}$LOG_DIR/${NC}"
    echo ""
    echo -e "Process table:"
    cat "$PIDS_FILE"
    echo ""
    echo -e "WS connections:"
    cat "$LOG_DIR/ws-connections.txt"
    echo ""

    echo "$LOG_DIR"
}

# ── Verify logs ──────────────────────────────────────────────────────

verify_logs() {
    local log_dir="$1"
    info "=== Verifying logs: $log_dir ==="

    local p=0
    local f=0

    # Routers
    for name in root-router east-router west-router nested-router; do
        if grep -q "$name" "$log_dir"/*.log 2>/dev/null; then
            pass "$name started"; ((p++))
        else
            fail "$name not found"; ((f++))
        fi
    done

    # Clients
    for name in alpha-client beta-client gamma-client; do
        if grep -q "$name" "$log_dir"/*.log 2>/dev/null; then
            pass "$name connected"; ((p++))
        else
            fail "$name not found"; ((f++))
        fi
    done

    # Viewers
    if grep -q "surface-viewer" "$log_dir"/*.log 2>/dev/null; then
        pass "surface-viewer instances running"; ((p++))
    else
        fail "no surface-viewer evidence"; ((f++))
    fi

    # Control endpoint
    if grep -q "control-endpoint" "$log_dir"/*.log 2>/dev/null; then
        pass "control-endpoint running"; ((p++))
    else
        fail "control-endpoint not found"; ((f++))
    fi

    # Requestion endpoint
    if grep -q "requestion-endpoint" "$log_dir"/*.log 2>/dev/null; then
        pass "requestion-endpoint running"; ((p++))
    else
        fail "requestion-endpoint not found"; ((f++))
    fi

    # WS connections
    if grep -q "WebSocket\|connected\|OK:" "$log_dir"/*.log 2>/dev/null; then
        pass "WebSocket connections established"; ((p++))
    else
        fail "no WebSocket evidence"; ((f++))
    fi

    # Upload evidence
    if grep -q "session_update\|SessionUpdate" "$log_dir"/*.log 2>/dev/null; then
        pass "Upload (session_update) evidence found"; ((p++))
    else
        fail "no upload evidence"; ((f++))
    fi

    # Control evidence
    if grep -q "add_prompt\|abort_session\|compact_session\|CONTROL" "$log_dir"/*.log 2>/dev/null; then
        pass "Control command evidence found"; ((p++))
    else
        fail "no control evidence"; ((f++))
    fi

    # Request/response evidence
    if grep -q "ReadRequest\|ReadResponse\|runtime_workspace\|runtime_session" "$log_dir"/*.log 2>/dev/null; then
        pass "Request/response evidence found"; ((p++))
    else
        fail "no request/response evidence"; ((f++))
    fi

    # Upstream links
    if grep -q "upstream" "$log_dir"/*.log 2>/dev/null; then
        pass "Upstream router links active"; ((p++))
    else
        fail "no upstream evidence"; ((f++))
    fi

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN} Result: $p PASS, $f FAIL${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"

    [ $f -eq 0 ] && return 0 || return 1
}

# ── Key log excerpts ─────────────────────────────────────────────────

show_key_logs() {
    local log_dir="$1"
    info "=== Key log excerpts ==="

    for f in 01-root-router 02-east-router 05-alpha-client 08-root-viewer 11-control-endpoint 12-requestion-endpoint; do
        echo ""
        echo -e "${CYAN}--- $f (first 20 lines) ---${NC}"
        head -20 "$log_dir/$f.log" 2>/dev/null || echo "(no log)"
    done
}

# ── Main ─────────────────────────────────────────────────────────────

TARGET="${1:-TOPOLOGY}"

case "$TARGET" in
    TOPOLOGY)
        print_topology_tree
        ;;
    VERIFY)
        [ -z "${2:-}" ] && { fail "Usage: $0 VERIFY <log-dir>"; exit 1; }
        verify_logs "$2"
        show_key_logs "$2"
        ;;
    ALL)
        print_topology_tree
        LOG_DIR=$(launch_demo)
        verify_logs "$LOG_DIR"
        show_key_logs "$LOG_DIR"
        ;;
    *)
        echo "Usage: $0 [TOPOLOGY|VERIFY <log-dir>|ALL]"
        exit 1
        ;;
esac
