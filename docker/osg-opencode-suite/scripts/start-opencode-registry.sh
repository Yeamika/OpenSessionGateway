#!/usr/bin/env bash
set -euo pipefail

export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/runtime/opencode-config}"
export OPENCODE_WORKDIR="${OPENCODE_WORKDIR:-/runtime/workspaces/default}"
export OSG_BASE_URL="${OSG_BASE_URL:?OSG_BASE_URL is required}"
export OSG_RUNTIME_ID="${OSG_RUNTIME_ID:?OSG_RUNTIME_ID is required}"
export OSG_LOG_DIR="${OSG_LOG_DIR:-/runtime/osg-logs}"
export OPENCODE_HOST="${OPENCODE_HOST:-0.0.0.0}"
export OPENCODE_PORT="${OPENCODE_PORT:-9202}"
export OPENCODE_NPM_PACKAGE="${OPENCODE_NPM_PACKAGE:-opencode-ai@local}"
export OSG_PLUGIN_PACKAGE_NAME="${OSG_PLUGIN_PACKAGE_NAME:-@opensessiongateway/client-opencode-plugin-v2}"
export OSG_PLUGIN_PACKAGE_VERSION="${OSG_PLUGIN_PACKAGE_VERSION:-0.0.1}"
export OSG_OPENCODE_SDK_VERSION="${OSG_OPENCODE_SDK_VERSION:-local}"
export OSG_OPENCODE_PLUGIN_VERSION="${OSG_OPENCODE_PLUGIN_VERSION:-local}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/runtime/npm-global}"
export npm_config_registry="${LAB_NPM_REGISTRY:-https://registry.npmjs.org/}"
export BUN_CONFIG_REGISTRY="${LAB_BUN_REGISTRY:-${npm_config_registry}}"

mkdir -p "${OPENCODE_CONFIG_DIR}" "${OPENCODE_WORKDIR}" "${OSG_LOG_DIR}" "${NPM_CONFIG_PREFIX}"
export PATH="${NPM_CONFIG_PREFIX}/bin:${PATH}"

cat > "${OPENCODE_CONFIG_DIR}/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": [
    "${OSG_PLUGIN_PACKAGE_NAME}"
  ]
}
EOF

cat > "${OPENCODE_CONFIG_DIR}/package.json" <<EOF
{
  "name": "opencode-managed-config",
  "private": true,
  "dependencies": {
    "${OSG_PLUGIN_PACKAGE_NAME}": "${OSG_PLUGIN_PACKAGE_VERSION}",
    "@opencode-ai/sdk": "${OSG_OPENCODE_SDK_VERSION}",
    "@opencode-ai/plugin": "${OSG_OPENCODE_PLUGIN_VERSION}"
  },
  "overrides": {
    "@opencode-ai/sdk": "${OSG_OPENCODE_SDK_VERSION}",
    "@opencode-ai/plugin": "${OSG_OPENCODE_PLUGIN_VERSION}"
  }
}
EOF

if [[ ! -x "${NPM_CONFIG_PREFIX}/bin/opencode" || "${LAB_FORCE_INSTALL:-0}" == "1" ]]; then
  npm install -g "${OPENCODE_NPM_PACKAGE}"
fi

if [[ ! -d "${OPENCODE_CONFIG_DIR}/node_modules" || "${LAB_FORCE_INSTALL:-0}" == "1" ]]; then
  rm -rf "${OPENCODE_CONFIG_DIR}/node_modules" "${OPENCODE_CONFIG_DIR}/bun.lock"
  (cd "${OPENCODE_CONFIG_DIR}" && bun install)
fi

cd "${OPENCODE_WORKDIR}"
exec opencode serve --hostname "${OPENCODE_HOST}" --port "${OPENCODE_PORT}"
