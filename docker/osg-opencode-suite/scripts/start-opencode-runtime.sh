#!/usr/bin/env bash
set -euo pipefail

export LAB_BOOTSTRAP_ROLE="opencode"

/opt/osg-opencode-suite/scripts/bootstrap-workspace.sh

export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/runtime/opencode-config}"
export OPENCODE_WORKDIR="${OPENCODE_WORKDIR:-/runtime/workspaces/default}"
export OSG_BASE_URL="${OSG_BASE_URL:?OSG_BASE_URL is required}"
export OSG_RUNTIME_ID="${OSG_RUNTIME_ID:?OSG_RUNTIME_ID is required}"
export OSG_LOG_DIR="${OSG_LOG_DIR:-/runtime/osg-logs}"
export OPENCODE_HOST="${OPENCODE_HOST:-0.0.0.0}"
export OPENCODE_PORT="${OPENCODE_PORT:-9202}"

mkdir -p "${OPENCODE_CONFIG_DIR}/plugin" "${OPENCODE_WORKDIR}" "${OSG_LOG_DIR}"

cat > "${OPENCODE_CONFIG_DIR}/plugin/osg.js" <<'EOF'
export { default } from "file:///workspace/OpenSessionGateway/packages/client-opencode-plugin-v2/node_modules/@opensessiongateway/client-opencode-plugin-v2/dist/index.js"
EOF

cd /workspace/opencode
exec bun --cwd /workspace/opencode/packages/opencode src/index.ts serve --hostname "${OPENCODE_HOST}" --port "${OPENCODE_PORT}"
