#!/usr/bin/env bash
# GlassVein multiprocess demo: shared helpers.
#
# Source this file from stage scripts:
#   source "$(dirname "$0")/../scripts/common.sh"
#
# All paths are relative to the GlassVein project root (workspace/OSG-Project/GlassVein).

set -euo pipefail

# ── Resolve project root (GlassVein/) ──
# common.sh lives at demos/multiprocess/scripts/common.sh
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
GV_ROOT="$(cd "$DEMO_ROOT/../.." && pwd)"

export SCRIPTS_DIR DEMO_ROOT GV_ROOT

# ── Paths ──
BIN_DIR="${GV_ROOT}/target/debug"
STATE_TEMPLATE_DIR="${DEMO_ROOT}/state"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="${GV_ROOT}/.tmp/gv-stage-${STAGE_ID:-unknown}-${RUN_ID}"

export BIN_DIR LOG_DIR RUN_ID STATE_TEMPLATE_DIR

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Logging helpers ──
pass()  { echo -e "${GREEN}[PASS]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; }
info()  { echo -e "${YELLOW}[INFO]${NC} $1"; }
debug() { echo -e "${CYAN}[DBG]${NC} $1"; }

# ── Port check (bash /dev/tcp, no external dependency) ──
port_is_listening() {
    local port="$1"
    timeout 2 bash -c "echo >/dev/tcp/127.0.0.1/$port" 2>/dev/null
}

# ── Wait for a port to start listening ──
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

# ── PID tracking ──
declare -a ALL_PIDS=()
PIDS_FILE=""

init_pid_tracking() {
    local dir="$1"
    PIDS_FILE="$dir/processes.tsv"
    echo -e "name\tpid\tport_or_url\tstarted_at" > "$PIDS_FILE"
}

record_pid() {
    local name="$1" pid="$2" extra="${3:-}"
    local ts
    ts=$(date +%H:%M:%S)
    echo -e "${name}\t${pid}\t${extra}\t${ts}" >> "$PIDS_FILE"
    ALL_PIDS+=("$pid")
}

# ── Cleanup: kill all tracked PIDs ──
cleanup_pids() {
    info "Cleaning up background processes..."
    for pid in "${ALL_PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    # Also catch any orphaned children
    jobs -p 2>/dev/null | xargs -r kill 2>/dev/null || true
    wait 2>/dev/null || true
    info "Cleanup done"
}

# ── Setup log dir (no auto-cleanup trap) ──
# By default, processes are left running after a stage completes so that
# downstream stages can use them.  Call cleanup_pids explicitly on failure
# or use demos/multiprocess/scripts/cleanup.sh to stop all demo processes.
setup_stage() {
    mkdir -p "$LOG_DIR"
    init_pid_tracking "$LOG_DIR"
    info "Stage log dir: $LOG_DIR"
}

# ── Register cleanup trap on failure only ──
# Usage: call after setup_stage.  If the script exits with non-zero,
# all tracked PIDs are killed.  On success (exit 0), processes stay alive.
cleanup_on_failure() {
    trap 'if [ $? -ne 0 ]; then cleanup_pids; fi' EXIT
}

# ── Require a binary to exist ──
require_binary() {
    local name="$1"
    local path="${BIN_DIR}/${name}"
    if [ ! -x "$path" ]; then
        fail "Required binary not found: $path"
        fail "Run Stage 00 (build) first."
        return 1
    fi
}

# ── Copy state template to runtime dir ──
# Templates are maintained by the Topology/State worker in multiprocess/state/.
# We copy them as-is; grants are NOT modified here.
copy_state_template() {
    local router_name="$1"   # e.g. "root", "east", "west", "nested"
    local dest_dir="$2"
    local src="${STATE_TEMPLATE_DIR}/demo-state-${router_name}.json"
    local dst="${dest_dir}/demo-state-${router_name}.json"
    if [ ! -f "$src" ]; then
        fail "State template not found: $src"
        fail "Dependency: Topology/State worker must provide templates in $STATE_TEMPLATE_DIR/"
        return 1
    fi
    cp "$src" "$dst"
    debug "Copied state template: $src -> $dst"
}

# ── Summary helper ──
print_summary() {
    local pass_count="$1"
    local fail_count="$2"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN} Result: $pass_count PASS, $fail_count FAIL${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    [ "$fail_count" -eq 0 ] && return 0 || return 1
}
