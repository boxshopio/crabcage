#!/bin/bash
set -e

# Pre-trust the workspace so Claude Code skips the trust dialog.
# Inside crabcage, the container IS the trust boundary.
# Write to .claude/ (bind-mounted rw) and symlink, since root fs is read-only.
CLAUDE_JSON="/home/claude/.claude/claude-config.json"
CLAUDE_JSON_LINK="/home/claude/.claude.json"

if [ ! -f "$CLAUDE_JSON" ]; then
    cat > "$CLAUDE_JSON" <<'TRUST'
{
  "hasCompletedOnboarding": true,
  "projects": {
    "/home/claude/work": {
      "hasTrustDialogAccepted": true,
      "allowedTools": []
    }
  }
}
TRUST
else
    # If .claude.json exists but workspace isn't trusted, add trust entry
    if command -v jq > /dev/null 2>&1; then
        jq '.projects["/home/claude/work"].hasTrustDialogAccepted = true | .hasCompletedOnboarding = true' "$CLAUDE_JSON" > "${CLAUDE_JSON}.tmp" \
            && mv "${CLAUDE_JSON}.tmp" "$CLAUDE_JSON"
    fi
fi


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
