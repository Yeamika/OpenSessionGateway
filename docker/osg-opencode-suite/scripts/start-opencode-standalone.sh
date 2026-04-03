#!/usr/bin/env bash
set -euo pipefail

export LAB_BOOTSTRAP_ROLE="standalone"

/opt/osg-opencode-suite/scripts/bootstrap-workspace.sh

export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/runtime/opencode-config}"
export OPENCODE_WORKDIR="${OPENCODE_WORKDIR:-/runtime/workspaces/community-event}"
export OPENCODE_HOST="${OPENCODE_HOST:-0.0.0.0}"
export OPENCODE_PORT="${OPENCODE_PORT:-10086}"

mkdir -p "${OPENCODE_CONFIG_DIR}" "${OPENCODE_WORKDIR}"
rm -rf "${OPENCODE_CONFIG_DIR}/plugin"

cd /workspace/opencode
exec bun --cwd /workspace/opencode/packages/opencode src/index.ts serve --hostname "${OPENCODE_HOST}" --port "${OPENCODE_PORT}"
