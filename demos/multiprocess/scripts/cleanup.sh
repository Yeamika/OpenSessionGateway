#!/usr/bin/env bash
# Stop all GlassVein multiprocess demo processes.
#
# Usage: bash demos/multiprocess/scripts/cleanup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GV_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Killing all router processes on ports 7200-7203..."
for port in 7200 7201 7202 7203; do
    pid=$(lsof -ti :$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        kill $pid 2>/dev/null || true
        echo "  Killed PID $pid on :$port"
    fi
done

echo "Killing bash-clientdummy processes..."
pkill -f "bash-clientdummy" 2>/dev/null || true

echo "Killing endpoint processes..."
for ep in console-endpoint session-control-endpoint timer-endpoint requestion-endpoint mailbox-endpoint im-endpoint; do
    pkill -f "$ep" 2>/dev/null || true
done

echo "Waiting for processes to exit..."
sleep 2

echo "Cleanup done."
