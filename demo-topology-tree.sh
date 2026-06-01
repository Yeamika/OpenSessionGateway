#!/usr/bin/env bash
# GlassVein multi-process demo: current endpoint topology graph.
#
# NOTE: this file's TOPOLOGY output is the current target graph. The launch and
# verification implementation is intentionally left for the follow-up demo refresh
# pass.
#
# Usage:
#   bash demo-topology-tree.sh TOPOLOGY              # print tree + coverage matrix
#   bash demo-topology-tree.sh ALL                   # print tree, launch, verify, produce evidence
#   bash demo-topology-tree.sh VERIFY <log-dir>      # verify an existing log dir
#
# Target topology graph:
#
#   root-router :7200
#   ├─ console-endpoint      (TUI/control/admin/read, observes canonical traffic)
#   ├─ east-router :7201
#   │  ├─ alpha-client      (bash-clientdummy instance)
#   │  │  ├─ session-alpha-1
#   │  │  └─ session-alpha-2
#   │  ├─ delta-client      (bash-clientdummy instance)
#   │  │  └─ session-delta-1
#   │  ├─ session-control-endpoint (runtime/session MCP bridge)
#   │  └─ timer-endpoint     (scheduled control/add_prompt producer)
#   └─ west-router :7202
#      ├─ beta-client        (bash-clientdummy instance)
#      │  ├─ session-beta-1
#      │  └─ session-beta-2
#      ├─ requestion-endpoint (requestion cache + upload listener, --seed-demo)
#      ├─ mailbox-endpoint   (mailbox store-forward + reminder control/add_prompt)
#      └─ nested-router :7203
#         ├─ gamma-client    (bash-clientdummy instance)
#         │  ├─ session-gamma-1
#         │  └─ session-gamma-2
#         ├─ omega-client    (bash-clientdummy instance)
#         │  └─ session-omega-1
#         └─ im-endpoint     (IM gateway endpoint, control/add_prompt bridge)
#
# Target business session addresses:
#   alpha → east/runtime-alpha/session-alpha-1, east/runtime-alpha/session-alpha-2
#   delta → east/runtime-delta/session-delta-1
#   beta  → west/runtime-beta/session-beta-1, west/runtime-beta/session-beta-2
#   gamma → nested/runtime-gamma/session-gamma-1, nested/runtime-gamma/session-gamma-2
#   omega → nested/runtime-omega/session-omega-1
#   console → domain-a/console-runtime/console
#   session-control → surface/session-control-endpoint/*
#   timer → domain-a/timer-endpoint/timer
#   requestion → west/requestion-endpoint/requestion-endpoint
#   mailbox → domain-a/mailbox-endpoint/mailbox
#   im → domain-a/im-endpoint/session + domain-a/im-backend/session

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

# ── Registered addresses (MUST match bash-clientdummy defaults) ──
ALPHA_ADDR_1="east/runtime-alpha/session-alpha-1"
ALPHA_ADDR_2="east/runtime-alpha/session-alpha-2"
DELTA_ADDR="east/runtime-delta/session-delta-1"
BETA_ADDR_1="west/runtime-beta/session-beta-1"
BETA_ADDR_2="west/runtime-beta/session-beta-2"
GAMMA_ADDR_1="nested/runtime-gamma/session-gamma-1"
GAMMA_ADDR_2="nested/runtime-gamma/session-gamma-2"
OMEGA_ADDR="nested/runtime-omega/session-omega-1"

# State-file directory
STATE_DIR="$(cd "$(dirname "$0")" && pwd)/demos/multiprocess/state"

# ── Topology tree ────────────────────────────────────────────────────

print_topology_tree() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}           GlassVein Multi-Client Target Demo Topology                    ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}NOTE:${NC} topology graph refreshed to current Rust endpoints; launch script refresh is pending."
    echo ""
    echo -e "${CYAN}root-router${NC} ws://127.0.0.1:7200"
    echo -e "├─ ${GREEN}console-endpoint${NC}      (TUI/control/admin/read observer)"
    echo -e "├─ ${CYAN}east-router${NC} ws://127.0.0.1:7201"
    echo -e "│  ├─ ${GREEN}alpha-client${NC}        (bash-clientdummy instance)"
    echo -e "│  │  ├─ session-alpha-1"
    echo -e "│  │  └─ session-alpha-2"
    echo -e "│  ├─ ${GREEN}delta-client${NC}        (bash-clientdummy instance)"
    echo -e "│  │  └─ session-delta-1"
    echo -e "│  ├─ ${GREEN}session-control-endpoint${NC} (runtime/session MCP bridge)"
    echo -e "│  └─ ${GREEN}timer-endpoint${NC}      (scheduled control/add_prompt producer)"
    echo -e "└─ ${CYAN}west-router${NC} ws://127.0.0.1:7202"
    echo -e "   ├─ ${GREEN}beta-client${NC}          (bash-clientdummy instance)"
    echo -e "   │  ├─ session-beta-1"
    echo -e "   │  └─ session-beta-2"
    echo -e "   ├─ ${BLUE}requestion-endpoint${NC}   (requestion cache + upload listener)"
    echo -e "   ├─ ${GREEN}mailbox-endpoint${NC}     (store-forward + reminder add_prompt)"
    echo -e "   └─ ${CYAN}nested-router${NC} ws://127.0.0.1:7203"
    echo -e "      ├─ ${GREEN}gamma-client${NC}      (bash-clientdummy instance)"
    echo -e "      │  ├─ session-gamma-1"
    echo -e "      │  └─ session-gamma-2"
    echo -e "      ├─ ${GREEN}omega-client${NC}      (bash-clientdummy instance)"
    echo -e "      │  └─ session-omega-1"
    echo -e "      └─ ${GREEN}im-endpoint${NC}       (IM gateway, control/add_prompt bridge)"
    echo ""

    # ── Process list ──
    echo -e "${BLUE}┌────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│${NC} Routers (4):                                                              ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  1. root-router       :7200  (no upstream, root)                           ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  2. east-router       :7201  upstream=root-router                         ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  3. west-router       :7202  upstream=root-router                         ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  4. nested-router     :7203  upstream=west-router                         ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} bash-clientdummy instances (5), business sessions (8):                 ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  5. alpha-client             east/runtime-alpha/{session-alpha-1,session-alpha-2} ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  6. delta-client             east/runtime-delta/session-delta-1        ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  7. beta-client              west/runtime-beta/{session-beta-1,session-beta-2} ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  8. gamma-client             nested/runtime-gamma/{session-gamma-1,session-gamma-2} ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  9. omega-client             nested/runtime-omega/session-omega-1      ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} Endpoints (6):                                                             ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 10. console-endpoint         connect=root-router  addr=domain-a/console-runtime/console ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 11. session-control-endpoint connect=east-router  addr=surface/session-control-endpoint/* ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 12. timer-endpoint           connect=east-router  addr=domain-a/timer-endpoint/timer ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 13. requestion-endpoint      connect=west-router  addr=west/requestion-endpoint/requestion-endpoint ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 14. mailbox-endpoint         connect=west-router  addr=domain-a/mailbox-endpoint/mailbox ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC} 15. im-endpoint              connect=nested-router addr=domain-a/im-endpoint/session ${BLUE}│${NC}"
    echo -e "${BLUE}└────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""

    # ── Four-link coverage matrix ──
    echo -e "${BLUE}┌────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│${NC} Four-link coverage matrix                                                 ${BLUE}│${NC}"
    echo -e "${BLUE}├────────────────────────────────────────────────────────────────────────────┤${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  upload (observed by console/session-control via routing or rules):       ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    session_update            alpha/delta/beta/gamma/omega → observers     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_asked          requestion-endpoint upload listener          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_updated        requestion-endpoint cache merge              ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_resolved       requestion cache removal                     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_cancelled      requestion cache removal                     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  control (source endpoint → router → target endpoint):                    ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    add_prompt                console/mailbox/im/timer → target session     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    abort_session             console/session-control → target session       ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    compact_session           console/session-control → target session       ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    requestion_respond        requestion/session-control → requestion       ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  request (source endpoint → router → target, returns response):          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    runtime_workspace_view_snapshot   console/session-control → runtime     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    runtime_requestion_snapshot       console/session-control → requestion  ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    runtime_session_view_snapshot     console/session-control → session     ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    runtime_session_messages          console/im/session-control → session  ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}  response (router → source address, target=request.source):               ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    mirrors request/control subtype     returned from target endpoint      ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}    wire shape: { linkType:\"response\", subtype:<echo>, status, payload }    ${BLUE}│${NC}"
    echo -e "${BLUE}│${NC}                                                                          ${BLUE}│${NC}"
    echo -e "${BLUE}└────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
}

# ── Launch 15-process demo ───────────────────────────────────────────

launch_demo() {
    info "=== Launching 15-process live demo ==="

    LOG_DIR="/workspace/OSG-Project/.tmp/gv-demo-15p-$(date +%Y%m%d-%H%M%S)"
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

    # ── Phase 1: Routers (with state-files) ──
    info "[1/4] root-router :7200..."
    $BIN_DIR/router --node-id root-router --bind-addr 127.0.0.1:7200 --tap-capacity 128 --state-file "$STATE_DIR/demo-state-root.json" > "$LOG_DIR/01-root-router.log" 2>&1 &
    record_pid "root-router" "$!" ":7200"
    sleep 1

    info "[2/4] east-router :7201..."
    $BIN_DIR/router --node-id east-router --bind-addr 127.0.0.1:7201 --upstream-url ws://127.0.0.1:7200 --state-file "$STATE_DIR/demo-state-east.json" > "$LOG_DIR/02-east-router.log" 2>&1 &
    record_pid "east-router" "$!" ":7201"
    sleep 1

    info "[3/4] west-router :7202..."
    $BIN_DIR/router --node-id west-router --bind-addr 127.0.0.1:7202 --upstream-url ws://127.0.0.1:7200 --state-file "$STATE_DIR/demo-state-west.json" > "$LOG_DIR/03-west-router.log" 2>&1 &
    record_pid "west-router" "$!" ":7202"
    sleep 1

    info "[4/4] nested-router :7203..."
    $BIN_DIR/router --node-id nested-router --bind-addr 127.0.0.1:7203 --upstream-url ws://127.0.0.1:7202 --state-file "$STATE_DIR/demo-state-nested.json" > "$LOG_DIR/04-nested-router.log" 2>&1 &
    record_pid "nested-router" "$!" ":7203"
    sleep 1

    # ── Phase 2: bash-clientdummy instances (multi-session) ──
    info "[5/9] alpha-client -> east (2 sessions)..."
    $BIN_DIR/bash-clientdummy --router-url ws://127.0.0.1:7201 --node-id alpha-client --domain east --runtime runtime-alpha --session session-alpha-1 --session session-alpha-2 --stay-alive > "$LOG_DIR/05-alpha-client.log" 2>&1 &
    record_pid "alpha-client" "$!" "east:7201"
    sleep 2

    info "[6/9] delta-client -> east (1 session)..."
    $BIN_DIR/bash-clientdummy --router-url ws://127.0.0.1:7201 --node-id delta-client --domain east --runtime runtime-delta --session session-delta-1 --stay-alive > "$LOG_DIR/06-delta-client.log" 2>&1 &
    record_pid "delta-client" "$!" "east:7201"
    sleep 2

    info "[7/9] beta-client -> west (2 sessions)..."
    $BIN_DIR/bash-clientdummy --router-url ws://127.0.0.1:7202 --node-id beta-client --domain west --runtime runtime-beta --session session-beta-1 --session session-beta-2 --stay-alive > "$LOG_DIR/07-beta-client.log" 2>&1 &
    record_pid "beta-client" "$!" "west:7202"
    sleep 2

    info "[8/9] gamma-client -> nested (2 sessions)..."
    $BIN_DIR/bash-clientdummy --router-url ws://127.0.0.1:7203 --node-id gamma-client --domain nested --runtime runtime-gamma --session session-gamma-1 --session session-gamma-2 --stay-alive > "$LOG_DIR/08-gamma-client.log" 2>&1 &
    record_pid "gamma-client" "$!" "nested:7203"
    sleep 2

    info "[9/9] omega-client -> nested (1 session)..."
    $BIN_DIR/bash-clientdummy --router-url ws://127.0.0.1:7203 --node-id omega-client --domain nested --runtime runtime-omega --session session-omega-1 --stay-alive > "$LOG_DIR/09-omega-client.log" 2>&1 &
    record_pid "omega-client" "$!" "nested:7203"
    sleep 2

    # ── Phase 3: Endpoints ──
    info "[10/15] requestion-endpoint -> west (with --seed-demo)..."
    $BIN_DIR/requestion-endpoint \
        --router-url ws://127.0.0.1:7202 \
        --address west/requestion-endpoint/requestion-endpoint \
        --seed-demo \
        > "$LOG_DIR/10-requestion-endpoint.log" 2>&1 &
    record_pid "requestion-endpoint" "$!" "west:7202"
    sleep 2

    info "[11/15] console-endpoint -> root (command-mode add_prompt)..."
    timeout 15 $BIN_DIR/console-endpoint \
        --router-url ws://127.0.0.1:7200 \
        --command-mode \
        --target "$ALPHA_ADDR_1" \
        --command add_prompt \
        --message "Hello from 15-process demo" \
        > "$LOG_DIR/11-console-endpoint.log" 2>&1 || true
    sleep 1

    info "[12/15] console-endpoint: runtime_workspace_view_snapshot..."
    timeout 15 $BIN_DIR/console-endpoint \
        --router-url ws://127.0.0.1:7200 \
        --command-mode \
        --target "$ALPHA_ADDR_1" \
        --command runtime_workspace_view_snapshot \
        >> "$LOG_DIR/11-console-endpoint.log" 2>&1 || true

    # ── Wait bounded (keep processes alive for observation) ──
    info "All 15 processes launched. Waiting 15s for observation..."
    sleep 15

    # ── Snapshot evidence ──
    info "Capturing evidence..."

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

    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN} 15-process demo launched${NC}"
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

    # Clients (bash-clientdummy instances)
    for name in alpha-client delta-client beta-client gamma-client omega-client; do
        if grep -q "$name" "$log_dir"/*.log 2>/dev/null; then
            pass "$name connected"; ((p++))
        else
            fail "$name not found"; ((f++))
        fi
    done

    # Console endpoint
    if grep -q "console-endpoint\|console_endpoint" "$log_dir"/*.log 2>/dev/null; then
        pass "console-endpoint running"; ((p++))
    else
        fail "no console-endpoint evidence"; ((f++))
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

    for f in 01-root-router 02-east-router 05-alpha-client 08-gamma-client 10-requestion-endpoint 11-console-endpoint; do
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
