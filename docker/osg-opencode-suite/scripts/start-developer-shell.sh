#!/usr/bin/env bash
set -euo pipefail

export LAB_BOOTSTRAP_ROLE="dev"

/opt/osg-opencode-suite/scripts/bootstrap-workspace.sh

echo "DevelopersContain is ready."
echo "OpenSessionGateway: /workspace/OpenSessionGateway"
echo "opencode: /workspace/opencode"

exec bash
