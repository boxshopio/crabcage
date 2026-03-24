# crabcage

```
            o  O  o
      ┌─────────────────┐
      │   /V\     /V\   │  O
      │    \\(o_o)//    │
      │      (___)      │   o
      │    __|   |__    │
      └─────────────────┘
        ~ ~ ~ ~ ~ ~ ~ ~ ~
```

An auditable sandbox for agent harnesses.

Protect your computer files and production systems from irreparable damage. Dial in additional protections as desired, or run dangerously without too much concern for local filesystem damage.

> The secret formula: put your agent in a cage, not on a patty.

## The problem

You want to run an AI coding agent with `--dangerously-skip-permissions` so it can actually get work done. But you also want to protect your computer files, your credentials, and your production systems from accidental damage.

The container protects your local machine — filesystem, credentials, shell history are all isolated. But the container alone doesn't make things safe if the agent has access to external systems. If you hand it a GitHub token and an AWS admin role, it can use them. That's what the other layers are for.

## Layered protections

Each layer addresses a different category of risk. The container is always on. Everything else is a dial you turn up as needed.

| Protection | What it does | Default |
|---|---|---|
| **Container isolation** | Agent can't touch unmounted files | Always on |
| **Command approval** | Configurable via [nah](https://github.com/manuelschipper/nah) — if dangerous mode is too much | Off (`--safety`) |
| **Git guardrails** | Control push/PR/merge/force-push independently | Configurable |
| **Audit trail** | All actions auditable, analyzable later to improve the system | Off (`--audit`) |
| **Network filtering** | DNS allowlist for egress | Off (via config) |

**Best practices** (recommended, enforced outside crabcage):
- Read-only credentials for production APIs
- Fine-grained tokens scoped to what the agent actually needs
- GitHub branch protection rules (humans merge, agent proposes)

## Quick start

```bash
# Try it — zero install
npx crabcage run

# Or install globally
npm install -g crabcage
crabcage run
```

That's it. Mounts your current directory, launches Claude Code in a hardened container. No config file needed.

## Dial it in

```bash
# Add safety classification (catches destructive commands before they run)
crabcage run --safety supervised

# Add cryptographic audit trail
crabcage run --safety supervised --audit

# Use a config file for team standardization
crabcage run --config .crabcage.yml
```

## Config file

For teams, check a `.crabcage.yml` into your repo so everyone gets the same sandbox:

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
  merge: false       # humans review and merge, agent proposes
  force_push: block

safety:
  enabled: true
  preset: supervised

audit:
  enabled: true
```

Or walk through an interactive setup to configure your crabcage to your specifications:

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

1. Reads your config (or uses sensible defaults)
2. Validates credentials on the host before starting — fails fast with actionable errors
3. Checks mount paths against a denylist (`~/.ssh`, `~/.aws`, `/` are blocked)
4. Generates a docker-compose with hardened defaults
5. Launches the container with `--dangerously-skip-permissions` (the container IS the sandbox)
6. Optional layers ([nah](https://github.com/manuelschipper/nah) for safety, [punkgo-jack](https://github.com/PunkGo/punkgo-jack) for audit) hook into the agent's tool execution

## Container hardening

Applied by default — no configuration needed:

- `--cap-drop=ALL` (no Linux capabilities)
- `--read-only` root filesystem + tmpfs for scratch
- `--security-opt=no-new-privileges`
- Resource limits (memory, CPU, PID)
- No Docker socket access
- No host PID/network namespace
- Isolated bridge network
- Mount path denylist (refuses `~/.ssh`, `~/.aws`, `~/`, `/`)

## Philosophy

This is our opinionated attempt to make it safer to run AI agent harnesses. We don't think we have all the answers — the landscape is moving fast and new risks surface regularly.

We're open to [contributions](CONTRIBUTING.md) and [issues](https://github.com/boxshopio/crabcage/issues) suggesting other approaches, tweaks to existing layers, or entirely new protection layers we haven't thought of.

## License

[MIT](LICENSE)
