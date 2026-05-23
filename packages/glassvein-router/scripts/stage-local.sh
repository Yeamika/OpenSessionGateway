#!/usr/bin/env bash
# stage-local.sh — copy a locally-built glassvein-router binary into dist/ for npm pack.
#
# Usage:
#   ./scripts/stage-local.sh                        # linux-x64 (default)
#   TARGET=linux-arm64 ./scripts/stage-local.sh
#   TARGET=win32-x64  ./scripts/stage-local.sh
#
# Prerequisite: cargo build --release -p router
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GLASSVEIN_ROOT="$(cd "$PKG_DIR/../.." && pwd)"

TARGET="${TARGET:-linux-x64}"
BINARY_NAME="glassvein-router"
if [ "$TARGET" = "win32-x64" ]; then
  BINARY_NAME="glassvein-router.exe"
fi

# The Rust crate is named "router"; cargo produces "router" (or "router.exe").
RUST_BINARY="router"
if [ "$TARGET" = "win32-x64" ]; then
  RUST_BINARY="router.exe"
fi

SRC="${GLASSVEIN_ROOT}/target/release/${RUST_BINARY}"
DST_DIR="${PKG_DIR}/dist/${TARGET}"
DST="${DST_DIR}/${BINARY_NAME}"

if [ ! -f "$SRC" ]; then
  echo "ERROR: binary not found at $SRC" >&2
  echo "Run: cargo build --release -p router" >&2
  exit 1
fi

mkdir -p "$DST_DIR"
cp "$SRC" "$DST"
chmod +x "$DST"

echo "Staged $DST ($(du -h "$DST" | cut -f1))"
