#!/bin/bash
set -e

# Check for initialized marker
MARKER="/home/claude/.claude/.crabcage-initialized"

if [ -f "$MARKER" ]; then
    echo "[crabcage] Container already initialized, running update commands..."
    if [ -f "/tmp/crabcage-update.sh" ]; then
        bash /tmp/crabcage-update.sh
    fi
else
    echo "[crabcage] First launch — running init commands..."
    if [ -f "/tmp/crabcage-init.sh" ]; then
        bash /tmp/crabcage-init.sh
    fi
    touch "$MARKER"
fi

echo "[crabcage] Ready."

# If arguments passed, run them (e.g., claude --dangerously-skip-permissions)
if [ $# -gt 0 ]; then
    exec "$@"
else
    # Default: keep container running for attach
    exec tail -f /dev/null
fi
