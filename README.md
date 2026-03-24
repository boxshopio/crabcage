# crabcage

An auditable sandbox for agent harnesses. Dial in protections, or run dangerously without the danger.

> Your AI agent gets a crabby patty — a nice, contained environment where it can work freely without touching your actual files, credentials, or production systems.

## What it does

Crabcage runs your AI coding agent (Claude Code, etc.) inside a Docker container. Your local filesystem is isolated by default. Then you dial in additional protections as needed:

| Protection | What it does | Default |
|---|---|---|
| **Container isolation** | Agent can't touch unmounted files | Always on |
| **Command approval** | Catch destructive commands before they run | Off (opt-in via `--safety`) |
| **Git guardrails** | Control push/PR/merge/force-push | Configurable |
| **Audit trail** | Cryptographic receipts for every action | Off (opt-in via `--audit`) |
| **Network filtering** | DNS allowlist for egress | Off (opt-in via config) |

**What the container protects:** Your local machine. Filesystem, credentials, shell history — all isolated.

**What it does NOT protect:** External systems. If you give the agent credentials that can push to GitHub or deploy to AWS, the agent can use them. That's what the other layers are for.

## Quick start

```bash
# Try it (zero install)
npx crabcage run

# Or install globally
npm install -g crabcage
crabcage run
```

That's it. Mounts your current directory, launches Claude Code in a hardened container. No config file needed.

## Dial in protections

```bash
# Add safety classification (catches destructive commands)
crabcage run --safety supervised

# Add cryptographic audit trail
crabcage run --safety supervised --audit

# Use a config file for team standardization
crabcage run --config .sandbox.yml
```

## Config file

For teams, check a `.sandbox.yml` into your repo:

```yaml
mounts:
  - ~/repos

credentials:
  - name: GH_TOKEN
    check: gh auth status
    help: "Run: export GH_TOKEN=$(gh auth token)"

git:
  push: true
  create_pr: true
  merge: false
  force_push: block

safety:
  enabled: true
  preset: supervised

audit:
  enabled: true
```

Generate one interactively:

```bash
crabcage init
```

## Commands

```bash
crabcage run               # launch sandbox
crabcage run -d            # launch in background
crabcage stop              # stop sandbox
crabcage shell             # open shell in running sandbox
crabcage status            # show running sandboxes
crabcage audit list        # list audit receipts
crabcage audit verify <id> # verify receipt integrity
crabcage update            # pull latest image
crabcage clean             # remove stopped sandboxes
```

## Safety presets

| Preset | Use case | Key behaviors |
|---|---|---|
| `supervised` | You're watching | Asks before push, delete; blocks force-push |
| `autonomous` | Fire-and-forget | Blocks all destructive ops; allows push + PR |
| `minimal` | Just isolation | Only blocks force-push and obfuscated commands |

## How it works

1. **CLI reads your config** (or uses defaults)
2. **Validates credentials** on the host before starting (fail-fast)
3. **Checks mount paths** against a denylist (`~/.ssh`, `~/.aws`, `/` are blocked)
4. **Generates a docker-compose** with hardened defaults (`--cap-drop=ALL`, `--read-only`, resource limits)
5. **Launches the container** with Claude Code in `--dangerously-skip-permissions` mode (the container IS the sandbox)
6. **Optional layers** (nah for safety, punkgo-jack for audit) hook into Claude Code's tool execution

## Container hardening

Applied by default — no configuration needed:

- `--cap-drop=ALL` (no Linux capabilities)
- `--read-only` root filesystem + tmpfs for scratch
- `--security-opt=no-new-privileges`
- Resource limits (memory, CPU, PID)
- No Docker socket access
- No host PID/network namespace
- Isolated bridge network

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
