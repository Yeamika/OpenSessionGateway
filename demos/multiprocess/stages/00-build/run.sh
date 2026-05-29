#!/usr/bin/env bash
# GlassVein multiprocess demo — Stage 00: Build Sanity
#
# Bounded build check for all packages required by the multiprocess demo.
# Covers: router, osgp, core, osgp-client, bash-clientdummy, demos, surface,
# and all Rust endpoints (console, requestion, session-control, mailbox, im, timer).
# Endpoint behaviour verification belongs to Stage 03; here we only check they compile.
#
# Usage:
#   bash demos/multiprocess/stages/00-build/run.sh [--skip-build]
#
# Options:
#   --skip-build   Skip cargo build, only verify existing binaries.
#
# Exit 0 = all PASS, Exit 1 = at least one FAIL.

set -euo pipefail

export STAGE_ID="00-build"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../../scripts/common.sh"

SKIP_BUILD=false
if [ "${1:-}" = "--skip-build" ]; then
    SKIP_BUILD=true
fi

mkdir -p "$LOG_DIR"

P=0
F=0
check_pass() { pass "$1"; P=$((P + 1)); }
check_fail() { fail "$1"; F=$((F + 1)); }

info "=== Stage 00: Build Sanity ==="
info "GV_ROOT   : $GV_ROOT"
info "BIN_DIR   : $BIN_DIR"
info "LOG_DIR   : $LOG_DIR"
echo ""

# ── 1. Cargo workspace metadata ──
info "Checking Cargo workspace validity..."
if cargo metadata --manifest-path "$GV_ROOT/Cargo.toml" --no-deps --format-version 1 > /dev/null 2>&1; then
    check_pass "Cargo workspace metadata valid"
else
    check_fail "Cargo workspace metadata invalid"
fi

# ── 2. Build packages ──
# Core + router + client SDK + demo clients
CORE_PACKAGES=(
    "osgp"
    "core"
    "router"
    "osgp-client"
    "surface"
)

# Demo packages
DEMO_PACKAGES=(
    "bash-clientdummy"
    "glassvein-demos"
)

# Endpoint packages (build-check only; behaviour verified in Stage 03)
ENDPOINT_PACKAGES=(
    "console-endpoint"
    "requestion-endpoint"
    "session-control-endpoint"
    "mailbox-endpoint"
    "im-endpoint"
    "timer-endpoint"
)

ALL_PACKAGES=("${CORE_PACKAGES[@]}" "${DEMO_PACKAGES[@]}" "${ENDPOINT_PACKAGES[@]}")

if [ "$SKIP_BUILD" = false ]; then
    BUILD_LOG="$LOG_DIR/cargo-build.log"
    for pkg in "${ALL_PACKAGES[@]}"; do
        info "  Building -p $pkg ..."
        if timeout 180 cargo build --manifest-path "$GV_ROOT/Cargo.toml" -p "$pkg" > "$BUILD_LOG" 2>&1; then
            check_pass "cargo build -p $pkg"
        else
            check_fail "cargo build -p $pkg (see $BUILD_LOG)"
        fi
    done
else
    info "Skipping cargo build (--skip-build)"
fi

# ── 3. Verify critical binaries ──
info "Checking required binaries in $BIN_DIR ..."

# Binaries needed by Stage 01 (router boot)
REQUIRED_BINARIES=(
    "router"
)

# Binaries needed by Stage 02 (clientdummy announce)
OPTIONAL_STAGE02=(
    "bash-clientdummy"
)

for bin_name in "${REQUIRED_BINARIES[@]}"; do
    bin_path="$BIN_DIR/$bin_name"
    if [ -x "$bin_path" ]; then
        check_pass "Binary exists (required): $bin_name"
    else
        check_fail "Binary missing (required): $bin_name ($bin_path)"
    fi
done

for bin_name in "${OPTIONAL_STAGE02[@]}"; do
    bin_path="$BIN_DIR/$bin_name"
    if [ -x "$bin_path" ]; then
        check_pass "Binary exists (stage-02): $bin_name"
    else
        # bash-clientdummy may not have been built yet if it's pending
        info "  Binary not yet built (stage-02 dependency): $bin_name"
    fi
done

# ── 4. Verify state-file templates ──
# Templates are maintained by the Topology/State worker in multiprocess/state/.
info "Checking state-file templates (multiprocess/state/) ..."
STATE_TEMPLATES=("root" "east" "west" "nested")
for name in "${STATE_TEMPLATES[@]}"; do
    template="$STATE_TEMPLATE_DIR/demo-state-${name}.json"
    if [ -f "$template" ]; then
        check_pass "State template: demo-state-${name}.json"
    else
        check_fail "State template missing: $template (dependency: Topology/State worker)"
    fi
done

# ── 5. Quick binary smoke: router --help ──
info "Quick smoke: router --help"
if timeout 5 "$BIN_DIR/router" --help > "$LOG_DIR/router-help.txt" 2>&1; then
    check_pass "router --help exits cleanly"
else
    check_fail "router --help failed (see $LOG_DIR/router-help.txt)"
fi

# ── Summary ──
echo ""
print_summary "$P" "$F"
exit $?
