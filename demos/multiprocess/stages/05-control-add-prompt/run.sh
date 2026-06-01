#!/usr/bin/env bash
# GlassVein multiprocess demo — Stage 05: Control add_prompt
#
# Verifies control/add_prompt paths:
#   - same-router (console → alpha on east)
#   - cross-router (console → beta via east→root→west)
#   - cross-two-levels (console → gamma via east→root→west→nested)
#
# Prerequisite: Stages 01-03 complete.
# Status: PENDING — needs console-endpoint --command-mode wiring.

set -euo pipefail

export STAGE_ID="05-control-add-prompt"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../../scripts/common.sh"

info "=== Stage 05: Control add_prompt ==="
info ""
info "PENDING: This stage verifies control/add_prompt via console-endpoint"
info "  --command-mode targeting dummy client sessions."
info ""
info "  Test vectors:"
info "    T5a: console → alpha (same router east)"
info "    T5b: console → beta  (cross-router east→west)"
info "    T5c: console → gamma (cross-two-levels east→nested)"
info ""
info "  Implementation blocked on: console-endpoint command-mode integration."

print_summary 0 0
exit 0
