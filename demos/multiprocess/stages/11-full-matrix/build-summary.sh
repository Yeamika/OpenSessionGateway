#!/usr/bin/env bash
# Stage 11: Full Matrix — build summary from all stage evidence
#
# Collects evidence files from all stages and produces a summary.md.
#
# Usage:
#   bash build-summary.sh [LOG_DIR]
#
# LOG_DIR defaults to the most recent .tmp/gv-demo-* directory.

set -euo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# ── Resolve log directory ──
if [ -n "${1:-}" ]; then
    LOG_DIR="$1"
else
    LOG_DIR=$(ls -dt /workspace/OSG-Project/.tmp/gv-demo-* 2>/dev/null | head -1)
fi

if [ -z "$LOG_DIR" ] || [ ! -d "$LOG_DIR" ]; then
    echo "ERROR: No log directory found. Pass LOG_DIR as argument."
    exit 1
fi

info "Building full matrix summary from: $LOG_DIR"

SUMMARY="$LOG_DIR/summary.md"

# ── Header ──
cat > "$SUMMARY" << 'HEADER'
# GlassVein Multiprocess Demo — Full Matrix Summary

HEADER

echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$SUMMARY"
echo "" >> "$SUMMARY"

# ── Topology snapshot ──
if [ -f "$LOG_DIR/ws-connections.txt" ]; then
    echo "## Topology" >> "$SUMMARY"
    echo "" >> "$SUMMARY"
    echo '```' >> "$SUMMARY"
    cat "$LOG_DIR/ws-connections.txt" >> "$SUMMARY"
    echo '```' >> "$SUMMARY"
    echo "" >> "$SUMMARY"
fi

# ── Process table ──
if [ -f "$LOG_DIR/processes.tsv" ]; then
    echo "## Processes" >> "$SUMMARY"
    echo "" >> "$SUMMARY"
    echo '```' >> "$SUMMARY"
    cat "$LOG_DIR/processes.tsv" >> "$SUMMARY"
    echo '```' >> "$SUMMARY"
    echo "" >> "$SUMMARY"
fi

# ── Stage results ──
echo "## Stage Results" >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo "| Stage | PASS | FAIL | PENDING | Status | Notes |" >> "$SUMMARY"
echo "|-------|------|------|---------|--------|-------|" >> "$SUMMARY"

total_pass=0
total_fail=0
total_pending=0
stage_count=0

# Stage definitions: id, name, evidence file
declare -A STAGE_NAMES
STAGE_NAMES[00]="Build"
STAGE_NAMES[01]="Router Boot"
STAGE_NAMES[02]="Clientdummy Announce"
STAGE_NAMES[03]="Endpoint Boot"
STAGE_NAMES[04]="Session Update Broadcast"
STAGE_NAMES[05]="Control Add Prompt"
STAGE_NAMES[06]="Request Response"
STAGE_NAMES[07]="Requestion Flow"
STAGE_NAMES[08]="Mailbox Store Forward"
STAGE_NAMES[09]="Timer IM Flows"
STAGE_NAMES[10]="Flow Rules Broadcast"

# Evidence file patterns
declare -A EVIDENCE_FILES
EVIDENCE_FILES[00]="00-build.txt"
EVIDENCE_FILES[01]="01-router-boot.txt"
EVIDENCE_FILES[02]="02-clientdummy-announce.txt"
EVIDENCE_FILES[03]="03-endpoint-boot.txt"
EVIDENCE_FILES[04]="04-session-update-broadcast.txt"
EVIDENCE_FILES[05]="05-control-add-prompt.txt"
EVIDENCE_FILES[06]="06-request-response.txt"
EVIDENCE_FILES[07]="07-requestion-flow.txt"
EVIDENCE_FILES[08]="08-mailbox-store-forward.txt"
EVIDENCE_FILES[09]="09-timer-im-flows.txt"
EVIDENCE_FILES[10]="10-flow-rules-broadcast.txt"

for id in $(printf '%s\n' "${!STAGE_NAMES[@]}" | sort); do
    name="${STAGE_NAMES[$id]}"
    evidence_file="$LOG_DIR/${EVIDENCE_FILES[$id]}"
    ((stage_count++))

    if [ -f "$evidence_file" ]; then
        # Parse PASS/FAIL/PENDING counts from evidence file
        pass_count=$(grep -c "^PASS:" "$evidence_file" 2>/dev/null || echo 0)
        fail_count=$(grep -c "^FAIL:" "$evidence_file" 2>/dev/null || echo 0)
        pending_count=$(grep -c "^PENDING:" "$evidence_file" 2>/dev/null || echo 0)

        total_pass=$((total_pass + pass_count))
        total_fail=$((total_fail + fail_count))
        total_pending=$((total_pending + pending_count))

        # Determine status
        if [ "$fail_count" -gt 0 ]; then
            status="FAIL"
        elif [ "$pending_count" -gt 0 ] && [ "$pass_count" -eq 0 ]; then
            status="PENDING"
        elif [ "$pending_count" -gt 0 ]; then
            status="PARTIAL"
        elif [ "$pass_count" -gt 0 ]; then
            status="PASS"
        else
            status="NO DATA"
        fi

        # Extract first FAIL or PENDING as note
        note=$(grep -m1 "^FAIL:\|^PENDING:" "$evidence_file" 2>/dev/null | sed 's/^FAIL: \|^PENDING: //' | head -c 60)
        [ -z "$note" ] && note="-"

        echo "| $id-$name | $pass_count | $fail_count | $pending_count | $status | $note |" >> "$SUMMARY"
    else
        echo "| $id-$name | 0 | 0 | 0 | NO EVIDENCE | No evidence file found |" >> "$SUMMARY"
        total_pending=$((total_pending + 1))
    fi
done

echo "" >> "$SUMMARY"

# ── Overall verdict ──
echo "## Overall Verdict" >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo "- **Total PASS**: $total_pass" >> "$SUMMARY"
echo "- **Total FAIL**: $total_fail" >> "$SUMMARY"
echo "- **Total PENDING**: $total_pending" >> "$SUMMARY"
echo "- **Stages evaluated**: $stage_count" >> "$SUMMARY"
echo "" >> "$SUMMARY"

if [ "$total_fail" -eq 0 ] && [ "$total_pending" -eq 0 ]; then
    echo "**Verdict: ALL PASS** ✅" >> "$SUMMARY"
elif [ "$total_fail" -eq 0 ]; then
    echo "**Verdict: PASS WITH PENDING** ⚠️" >> "$SUMMARY"
    echo "" >> "$SUMMARY"
    echo "Some stages have PENDING items (typically Phase B/D ForwardEngine convergence)." >> "$SUMMARY"
elif [ "$total_pass" -eq 0 ]; then
    echo "**Verdict: BLOCKED** ❌" >> "$SUMMARY"
else
    echo "**Verdict: MIXED** ⚠️" >> "$SUMMARY"
fi

echo "" >> "$SUMMARY"

# ── Known limitations ──
echo "## Known Limitations" >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo "1. Stage 10 (Flow-Rules Broadcast) is PENDING — requires Phase B/D ForwardEngine convergence." >> "$SUMMARY"
echo "2. Timer stage depends on timer actually firing during the observation window." >> "$SUMMARY"
echo "3. IM stage depends on an IM message being routed during the observation window." >> "$SUMMARY"
echo "4. Legacy fanout (session_update → surface-viewer) is hardcoded in router, not rule-driven." >> "$SUMMARY"
echo "" >> "$SUMMARY"

# ── Evidence files ──
echo "## Evidence Files" >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo '```' >> "$SUMMARY"
ls -la "$LOG_DIR"/*.txt 2>/dev/null | awk '{print $NF}' >> "$SUMMARY" || echo "(none)" >> "$SUMMARY"
echo '```' >> "$SUMMARY"
echo "" >> "$SUMMARY"

# ── Done ──
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE} Full matrix summary written to:${NC}"
echo -e "${BLUE}   $SUMMARY${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "Totals: ${GREEN}$total_pass PASS${NC}  ${RED}$total_fail FAIL${NC}  ${YELLOW}$total_pending PENDING${NC}"
echo ""
