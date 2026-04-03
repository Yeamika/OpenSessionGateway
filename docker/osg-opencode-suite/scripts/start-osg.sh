#!/usr/bin/env bash
set -euo pipefail

export LAB_BOOTSTRAP_ROLE="osg"

/opt/osg-opencode-suite/scripts/bootstrap-workspace.sh

export OSG_PLUGIN_DIRS="/workspace/OpenSessionGateway/plugins"
export OSG_SERVER_RUNTIME_DIR="${OSG_SERVER_RUNTIME_DIR:-/runtime/osg}"

mkdir -p "${OSG_SERVER_RUNTIME_DIR}"

cd /workspace/OpenSessionGateway
exec npm --prefix server run dev
