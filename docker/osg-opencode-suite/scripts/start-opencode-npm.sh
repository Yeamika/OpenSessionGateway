#!/usr/bin/env bash
set -euo pipefail

export OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/runtime/opencode-config}"
export OPENCODE_WORKDIR="${OPENCODE_WORKDIR:-/runtime/workspaces/community-event}"
export OPENCODE_HOST="${OPENCODE_HOST:-0.0.0.0}"
export OPENCODE_PORT="${OPENCODE_PORT:-10086}"
export OPENCODE_NPM_PACKAGE="${OPENCODE_NPM_PACKAGE:-opencode-ai@local}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-/runtime/npm-global}"
export npm_config_registry="${LAB_NPM_REGISTRY:-https://registry.npmjs.org/}"

sudo install -d "${OPENCODE_CONFIG_DIR}" "${OPENCODE_WORKDIR}" "${NPM_CONFIG_PREFIX}" /workspace
sudo chown -R node:node "${OPENCODE_CONFIG_DIR}" "${OPENCODE_WORKDIR}" "${NPM_CONFIG_PREFIX}" /workspace

mkdir -p "${OPENCODE_CONFIG_DIR}" "${OPENCODE_WORKDIR}" "${NPM_CONFIG_PREFIX}"
export PATH="${NPM_CONFIG_PREFIX}/bin:${PATH}"

if [[ ! -x "${NPM_CONFIG_PREFIX}/bin/opencode" || "${LAB_FORCE_INSTALL:-0}" == "1" ]]; then
  npm install -g "${OPENCODE_NPM_PACKAGE}"
fi

sudo ln -sf "${NPM_CONFIG_PREFIX}/bin/opencode" /usr/local/bin/opencode

cd "${OPENCODE_WORKDIR}"
exec opencode serve --hostname "${OPENCODE_HOST}" --port "${OPENCODE_PORT}"
