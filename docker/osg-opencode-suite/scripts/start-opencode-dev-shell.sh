#!/usr/bin/env bash
set -euo pipefail

export LAB_BOOTSTRAP_ROLE="standalone"
export LAB_SYNC_ALWAYS="${LAB_SYNC_ALWAYS:-1}"

/opt/osg-opencode-suite/scripts/bootstrap-workspace.sh

echo "opencode-dev is ready."
echo "Source sync root: /workspace/opencode"
echo "Attach with: docker exec -it opencode-dev bash"

cd /workspace/opencode
trap 'exit 0' TERM INT
while sleep 3600; do :; done
