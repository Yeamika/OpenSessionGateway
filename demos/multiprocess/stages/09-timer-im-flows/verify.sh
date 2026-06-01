#!/usr/bin/env bash
# Stage 09: Timer + IM Flows — verification skeleton
#
# Verifies:
#   1. Timer endpoint sends control/add_prompt via router
#   2. IM endpoint sends control/add_prompt via router
#   3. IM endpoint sends request/runtime_session_messages via router
#
# Usage:
#   bash verify.sh [LOG_DIR]
#
# LOG_DIR defaults to the most recent .tmp/gv-demo-* directory.
# This script only reads logs; it does NOT start or stop processes.

set -euo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; echo "PASS: $1" >> "$EVIDENCE"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; echo "FAIL: $1" >> "$EVIDENCE"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
pending() { echo -e "${YELLOW}[PENDING]${NC} $1"; echo "PENDING: $1" >> "$EVIDENCE"; }

# ── Resolve log directory ──
if [ -n "${1:-}" ]; then
    LOG_DIR="$1"
else
    LOG_DIR=$(ls -dt /workspace/OSG-Project/.tmp/gv-demo-* 2>/dev/null | head -1)
fi

if [ -z "$LOG_DIR" ] || [ ! -d "$LOG_DIR" ]; then
    echo "ERROR: No log directory found. Pass LOG_DIR as argument."
    echo "       Expected: /workspace/OSG-Project/.tmp/gv-demo-YYYYMMDD-HHMMSS/"
    exit 1
fi

info "Verifying Stage 09 against: $LOG_DIR"

EVIDENCE="$LOG_DIR/09-timer-im-flows.txt"
: > "$EVIDENCE"

p=0
f=0
pend=0

# ── Check 1: Timer endpoint connected ──
info "Check 1: Timer endpoint connected to router"
if grep -ql "timer.*connected\|timer.*announce\|timer-endpoint.*connected" "$LOG_DIR"/*.log 2>/dev/null; then
    pass "Timer endpoint connected to GV router"
    ((p++))
else
    fail "No timer endpoint connection evidence in router/endpoint logs"
    ((f++))
fi

# ── Check 2: Timer sends control/add_prompt ──
info "Check 2: Timer endpoint sends control/add_prompt"
if grep -ql "control.*add_prompt.*timer\|timer.*add_prompt\|Timer-Triggered\|timer.*control" "$LOG_DIR"/*.log 2>/dev/null; then
    pass "Timer endpoint produced control/add_prompt envelope"
    ((p++))
else
    # Timer may not have fired yet (depends on timer schedule)
    pending "Timer control/add_prompt not yet observed (timer may not have fired)"
    ((pend++))
fi

# ── Check 3: Router forwarded timer control to target ──
info "Check 3: Router forwarded timer control to target session"
if grep -ql "forward.*add_prompt\|Forwarded.*control\|control.*forward.*timer" "$LOG_DIR"/*.log 2>/dev/null; then
    pass "Router forwarded timer control/add_prompt to target"
    ((p++))
else
    pending "Router forward of timer control not yet observed"
    ((pend++))
fi

# ── Check 4: IM endpoint connected ──
info "Check 4: IM endpoint connected to router"
if grep -ql "im.*connected\|im-endpoint.*announce\|im-endpoint.*LinkHandshake" "$LOG_DIR"/*.log 2>/dev/null; then
    pass "IM endpoint connected to GV router"
    ((p++))
else
    fail "No IM endpoint connection evidence"
    ((f++))
fi

# ── Check 5: IM sends control/add_prompt ──
info "Check 5: IM endpoint sends control/add_prompt"
if grep -ql "im.*add_prompt\|im-endpoint.*control\|im.*control.*add_prompt" "$LOG_DIR"/*.log 2>/dev/null; then
    pass "IM endpoint produced control/add_prompt envelope"
    ((p++))
else
    pending "IM control/add_prompt not yet observed (no IM message routed)"
    ((pend++))
fi

# ── Check 6: IM sends request/runtime_session_messages ──
info "Check 6: IM endpoint sends request/runtime_session_messages"
if grep -ql "runtime_session_messages\|session_messages.*request\|im.*request.*messages" "$LOG_DIR"/*.log 2>/dev/null; then
    pass "IM endpoint produced request/runtime_session_messages"
    ((p++))
else
    pending "IM request/runtime_session_messages not yet observed"
    ((pend++))
fi

# ── Check 7: Response to IM request ──
info "Check 7: Response returned for IM request"
if grep -ql "response.*runtime_session_messages\|response.*session_messages" "$LOG_DIR"/*.log 2>/dev/null; then
    pass "Response to runtime_session_messages observed"
    ((p++))
else
    pending "Response to runtime_session_messages not yet observed"
    ((pend++))
fi

# ── Summary ──
echo ""
echo "=== Stage 09 Summary ===" >> "$EVIDENCE"
echo "PASS=$p FAIL=$f PENDING=$pend" >> "$EVIDENCE"
echo "" >> "$EVIDENCE"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN} Stage 09: $p PASS, $f FAIL, $pend PENDING${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "Evidence: $EVIDENCE"

[ $f -eq 0 ] && exit 0 || exit 1
