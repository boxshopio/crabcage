# Crabcage Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Authors:** Tony (dreslan), Claude

## Overview

Crabcage is a config-driven CLI that launches auditable sandboxes for AI coding agents. Container isolation is the foundation. Safety classification and cryptographic audit are opt-in layers.

**Tagline:** The auditable sandbox for AI coding agents.

**What it is NOT:** An orchestration platform, a Kubernetes control plane, or a devcontainer for human development.

**Supported agents (v1):** Claude Code. Designed to extend to Codex, Gemini CLI later.

## Problem Statement

No existing solution combines container isolation, contextual safety classification, and cryptographic audit trails into a single tool. The landscape is fragmented:

- **Trail of Bits devcontainer** — strong container isolation, no safety hooks or audit trail
- **Docker Desktop Sandboxes** — strongest isolation (microVM), but proprietary black box, no extensibility
- **Trail of Bits config** — excellent hook patterns, but guardrails not walls, no container isolation
- **nah** — contextual safety classification, but standalone tool, no container integration
- **punkgo-jack** — cryptographic audit receipts, but standalone tool, no container integration

Crabcage integrates these into a single, layered, config-driven experience.

## Architecture

### Layered Design

Each layer adds value independently. Users opt in progressively:

- **Layer 0: Container isolation** (always on) — Docker container as the security boundary
- **Layer 1: Safety classification** (opt-in) — `nah` PreToolUse hooks classify commands as allow/ask/block
- **Layer 2: Cryptographic audit** (opt-in) — `punkgo-jack` Merkle tree + Ed25519 signing + RFC 3161 timestamps

### Threat Model

**Primary:** Accidental damage — the agent misunderstands intent and runs destructive commands, deletes files, or pushes bad code. The user is supervising.

**Not in scope (v1):** Adversarial agent escape. The container boundary is sufficient for accidental damage. Defense-in-depth against reasoning agents that probe boundaries is a future hardening goal.

### Container Architecture

**Base image:** Multi-stage build, published to GHCR as `ghcr.io/boxshopio/crabcage:latest` (amd64 + arm64).

```
Stage 1 (builder): debian:bookworm
  - build-essential, cargo (compile punkgo-jack)
  - Any native deps that need compilation

Stage 2 (runtime): debian:bookworm-slim
  - Node.js 22, Python 3.13+, uv, git, gh, aws-cli v2
  - jq, ripgrep, fzf, tmux
  - Claude Code (npm install -g @anthropic-ai/claude-code)
  - nah binary (copied from builder or pip install)
  - punkgo-jack binary (copied from builder)
```

**Container hardening (defaults):**

```
--cap-drop=ALL
--read-only                    # root filesystem is immutable
--tmpfs /tmp --tmpfs /var/tmp  # writable scratch space
--security-opt=no-new-privileges
--network=crabcage-net         # isolated bridge network
```

No Docker socket. No `--privileged`. No host PID/network namespace.

**Users inside the container:**

| User | Purpose |
|---|---|
| `claude` (UID configurable) | Runs Claude Code, owns repo workspace |
| `audit` | Runs punkgo-jack daemon, owns audit logs and signing key. Claude user cannot signal or read audit user's files. |

**Volumes:**

| Volume | Mount Point | Owner | Purpose |
|---|---|---|---|
| `crabcage-repos` | `/home/claude/repos` | claude | Code workspace |
| `crabcage-config` | `/home/claude/.claude` | claude | Claude Code settings, session history, hooks |
| `crabcage-audit` | `/var/audit` | audit | Merkle tree, receipts, signing key (0400) |

The repo volume is the only persistent data Claude can write to. Config volume persists Claude Code state across sessions. Audit volume is inaccessible to the claude user.

**Services (sidecars, not Docker socket):**

Claude does not get Docker socket access. Test dependencies (Postgres, Redis, etc.) run as sidecar containers in the same docker-compose, accessible via network.

```yaml
services:
  sandbox:
    image: ghcr.io/boxshopio/crabcage:latest
  postgres:
    image: postgres:16
  redis:
    image: redis:7
```

Declared in the config file, not hardcoded.

### Authentication

**Supported auth modes:**

| Mode | How it works |
|---|---|
| API key | `ANTHROPIC_API_KEY` env var injected into container |
| OAuth (subscription) | `~/.claude/.credentials.json` mounted read-only from host |

The launcher auto-detects which is available. If both exist, API key takes precedence.

**Other credentials injected as env vars at runtime:**

- `GH_TOKEN` — GitHub access (push branches, create PRs, trigger CI)
- AWS session tokens (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
- `CF_API_TOKEN` — Cloudflare (optional)
- Custom credentials declared in config

**Fail-fast validation:** Every credential is checked before the container starts. Each failure prints a specific, actionable error:

```
Checking credentials...
  ✓ Claude auth       subscription (OAuth token valid)
  ✓ GH_TOKEN          valid (scope: repo, org:read)
  ✗ AWS session        expired
    → Run: aws sso login --sso-session boxshop

Aborting. Fix the above and retry.
```

## CLI

### Installation

```bash
brew install crabcage     # macOS
pip install crabcage      # or via pip/uv
npm install -g crabcage   # or via npm
```

### Zero-Config First Run

```bash
export ANTHROPIC_API_KEY=sk-...
cd my-project
crabcage run
```

Mounts current directory, pulls pre-built image, launches Claude Code. No YAML, no config file. Safety and audit are off by default.

### Progressive Opt-In

```bash
crabcage run --safety supervised          # adds nah
crabcage run --safety supervised --audit  # adds nah + punkgo-jack
crabcage run --config .sandbox.yml        # full team config
```

### Commands

```bash
crabcage init              # scaffold a .sandbox.yml interactively
crabcage run               # launch sandbox (pull image if needed)
crabcage run -d            # detached/background mode
crabcage stop              # stop running sandbox
crabcage shell             # attach to running sandbox
crabcage audit list        # list session receipts
crabcage audit verify <id> # verify a receipt's integrity
crabcage audit show <id>   # full event log
crabcage status            # show running sandboxes, volumes, image version
crabcage update            # pull latest image
crabcage clean             # prune stopped sandboxes and orphan volumes
```

### Interactive Scaffolder

```
$ crabcage init

What agent will you use? [claude/codex/gemini]: claude
Which credentials do you need?
  ✓ ANTHROPIC_API_KEY (required)
  ? GH_TOKEN [y/N]: y
  ? AWS credentials [y/N]: y
  ? Cloudflare API token [y/N]: n
Enable safety classification (nah)? [Y/n]: y
  Safety preset? [supervised/autonomous/minimal]: supervised
Enable cryptographic audit? [y/N]: y
Repo provisioning command (optional): bs pull

Wrote .sandbox.yml
```

## Config File

Declarative YAML checked into the repo for team standardization. JSON schema published for IDE autocompletion.

### Full Example

```yaml
# .sandbox.yml

# Agent configuration
agent: claude  # claude | codex | gemini (future)

# Image pinning (optional — defaults to latest)
image: ghcr.io/boxshopio/crabcage:1.2.0

# Credentials — validated before launch
credentials:
  - name: GH_TOKEN
    check: gh auth status
    help: "Run: export GH_TOKEN=$(gh auth token)"
  - name: AWS_SESSION
    check: aws sts get-caller-identity
    help: "Run: aws sso login --sso-session boxshop"
  - name: CF_API_TOKEN
    required: false

# Repo provisioning (runs on first launch, update on subsequent)
repos:
  init: bs pull
  update: bs pull
  path: /home/claude/repos

# Additional tools installed at first launch
tools:
  - uv pip install -e /home/claude/repos/kingmaker
  - uv pip install -e /home/claude/repos/boxshop-cli

# Safety layer
safety:
  enabled: true
  preset: supervised  # supervised | autonomous | minimal
  overrides:
    git_history_rewrite: block
    git_remote_write: ask
  sensitive_paths:
    block:
      - ~/.km/usage.jsonl
      - ~/.kl/credentials.json
      - ~/.punkgo/
      - ~/.config/nah/
    ask:
      - ~/.km/config.yml
      - ~/.config/boxshop/config.toml
      - ~/.kl/config.json

# Audit layer
audit:
  enabled: true
  export_path: ~/.crabcage/audit/
  sign: true
  tsa: true  # RFC 3161 timestamping

# Sidecar services
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: test
  redis:
    image: redis:7

# Network egress allowlist (DNS-level filtering)
network:
  allow:
    - github.com
    - "*.github.com"
    - "*.amazonaws.com"
    - api.cloudflare.com
    - api.anthropic.com
    - registry.npmjs.org
    - pypi.org
    - files.pythonhosted.org
```

### Minimal Config

```yaml
safety:
  enabled: true
  preset: supervised

audit:
  enabled: true
```

Everything else uses defaults. Credentials detected from environment. Current directory mounted.

### Override Precedence (lowest to highest)

1. Built-in defaults
2. `.sandbox.yml` in project directory
3. `~/.config/crabcage/config.yml` (user global)
4. CLI flags (`--safety autonomous`)
5. Environment variables (`CRABCAGE_SAFETY_PRESET=autonomous`)

## Safety Presets

Three built-in presets, each a complete `nah` policy configuration.

### `supervised` (default)

Human watching. Claude works freely on safe operations, asks before anything impactful.

| Action Type | Policy |
|---|---|
| filesystem_read | allow |
| filesystem_write (within repos/) | allow |
| filesystem_write (outside repos/) | ask |
| filesystem_delete | ask |
| git_safe (status, diff, log, branch, checkout) | allow |
| git_remote_write (push, PR creation) | ask |
| git_history_rewrite (force push, rebase) | block |
| package_run (npm run, pytest, uv run) | allow |
| network_outbound | context (nah decides per-target) |
| process_signal (kill) | ask |
| obfuscated (base64 pipes, decode+exec) | block |
| env/printenv/set | block |

### `autonomous`

Fire-and-forget. Nothing destructive is possible.

| Action Type | Policy |
|---|---|
| filesystem_read | allow |
| filesystem_write (within repos/) | allow |
| filesystem_write (outside repos/) | block |
| filesystem_delete | block |
| git_safe | allow |
| git_remote_write | allow (push branches + create PRs — not merge) |
| git_history_rewrite | block |
| package_run | allow |
| network_outbound | allowlist only |
| process_signal | block |
| obfuscated | block |
| env/printenv/set | block |

### `minimal`

Just isolation. Almost everything allowed.

| Action Type | Policy |
|---|---|
| Everything | allow |
| git_history_rewrite | ask |
| obfuscated | ask |

### Per-Project Tightening

Repos can ship a `.nah.yaml` that tightens the active preset but cannot relax it:

```yaml
overrides:
  classify:
    - command: "km terraform apply prod*"
      action: block
```

## Audit Layer

### Architecture

Two users, two volumes, no cross-access. Claude cannot read, write, or kill the audit process.

```
┌─────────────────────────────────────────────┐
│  Container                                   │
│                                              │
│  claude user                 audit user       │
│  ┌──────────┐               ┌─────────────┐ │
│  │Claude Code│──hook fires──▶│punkgo-jack  │ │
│  │  + nah    │               │daemon       │ │
│  └──────────┘               └──────┬──────┘ │
│       │                            │         │
│       ▼                            ▼         │
│  /home/claude/repos/     /var/audit/         │
│  (claude:rw)             (audit:rw,          │
│                           claude:none)       │
└─────────────────────────────────────────────┘
```

### Event Capture Chain

1. Claude Code invokes a tool (Bash, Read, Write, Edit, etc.)
2. `nah` PreToolUse hook fires — classifies — allow/ask/block
3. `punkgo-jack` PreToolUse hook fires — records the attempt + nah's classification
4. Tool executes (or doesn't)
5. `punkgo-jack` PostToolUse hook fires — records the outcome
6. Every 5 minutes, punkgo-jack anchors a checkpoint via RFC 3161 TSA (DigiCert)

Blocked and asked actions are also recorded — the audit captures what Claude *attempted*, not just what executed.

### Event Record Schema

```json
{
  "ts": "2026-03-23T14:30:01Z",
  "session_id": "abc123",
  "tool": "Bash",
  "params": {"command": "git push origin feature/auth"},
  "nah_classification": "ask",
  "nah_reasoning": "git_remote_write: push to remote",
  "user_decision": "approved",
  "outcome": "success",
  "cwd": "/home/claude/repos/kingslanding"
}
```

### Integrity Guarantees

- Each event is a leaf in an append-only Merkle tree (RFC 6962)
- Tree root is signed with Ed25519 key (owned by audit user, mode 0400)
- Insertion of a new event changes the root hash — any tampering with prior events breaks the chain
- RFC 3161 timestamps prove events existed at a given time, independent of container clock
- Signing key is inaccessible to the claude user

### Receipt Export

On container exit:

1. Shutdown hook triggers `punkgo-jack export`
2. Receipt written to `/var/audit/receipts/<session-id>.json`
3. Receipt copied to host at configured `export_path` (default: `~/.crabcage/audit/`)
4. Receipt contains: session summary, event count, Merkle root, inclusion proofs, TSA tokens

### Verification

Offline, no network needed:

```bash
crabcage audit verify <session-id>

Session: abc123
Events: 847
Duration: 2h 14m
Merkle root: a3f8c2...
Signature: ✓ valid (Ed25519)
TSA anchors: 27 checkpoints, all valid
Chain integrity: ✓ no gaps, no modifications
```

### Analysis Commands

```bash
crabcage audit list                  # browse sessions
crabcage audit show <id>             # full event log
crabcage audit show <id> --blocks    # what got blocked
crabcage audit show <id> --asks      # what required approval
crabcage audit show <id> --json      # machine-readable export
```

## Network Isolation

**Default:** No restriction. Zero-config users don't need to think about this.

**Opt-in via config:**

```yaml
network:
  allow:
    - github.com
    - "*.amazonaws.com"
    - api.cloudflare.com
    - api.anthropic.com
    - registry.npmjs.org
    - pypi.org
    - files.pythonhosted.org
```

### Implementation

DNS sidecar container (dnsmasq or coredns, ~5MB):

```
┌──────────────┐     ┌──────────────┐     ┌──────────┐
│  sandbox     │────▶│  dns-filter  │────▶│ upstream  │
│  (Claude)    │ :53 │  (dnsmasq)   │     │ DNS       │
└──────────────┘     └──────────────┘     └──────────┘
```

- Sandbox container's DNS is pointed at the filter sidecar
- Filter resolves only allowlisted domains, returns NXDOMAIN for everything else
- Launcher generates the DNS config from the `network.allow` list at startup

### What This Catches

- Accidental requests to wrong environments (staging vs prod)
- Naive package supply-chain exfiltration (phone-home to unknown domain)
- Claude fetching arbitrary URLs from untrusted input

### What This Doesn't Catch (accepted risk)

- Hardcoded IP addresses bypass DNS filtering
- DNS-over-HTTPS would bypass the sidecar
- These are adversarial techniques outside the accidental-damage threat model

## Boxshop Overlay

Private config in `boxshop-config` (not in the open-source repo).

### `.sandbox.yml` (in boxshop-config)

```yaml
agent: claude

credentials:
  - name: GH_TOKEN
    check: gh auth status
    help: "Run: export GH_TOKEN=$(gh auth token)"
  - name: AWS_SESSION
    check: aws sts get-caller-identity
    help: "Run: aws sso login --sso-session boxshop"
  - name: CF_API_TOKEN
    required: false
    help: "Run: export CF_API_TOKEN=<token from 1Password>"

repos:
  init: bs pull
  update: bs pull
  path: /home/claude/repos

tools:
  - uv pip install -e /home/claude/repos/kingmaker
  - uv pip install -e /home/claude/repos/boxshop-cli
  - uv pip install -e /home/claude/repos/kingslanding-cli

safety:
  enabled: true
  preset: supervised
  overrides:
    git_history_rewrite: block
  sensitive_paths:
    block:
      - ~/.km/usage.jsonl
      - ~/.kl/credentials.json
    ask:
      - ~/.km/config.yml
      - ~/.config/boxshop/config.toml
      - ~/.kl/config.json

audit:
  enabled: true
  export_path: ~/.crabcage/audit/
  sign: true
  tsa: true

network:
  allow:
    - github.com
    - "*.github.com"
    - "*.amazonaws.com"
    - api.cloudflare.com
    - api.anthropic.com
    - registry.npmjs.org
    - pypi.org
    - files.pythonhosted.org
    - "*.sentry.io"
```

### `bs claude` Launcher (in boxshop-cli)

Thin wrapper that:

1. Reads the boxshop `.sandbox.yml` from `boxshop-config`
2. Calls `crabcage run --config <path>` under the hood
3. Handles boxshop-specific ergonomics (auto-detects AWS SSO session, resolves `CF_API_TOKEN` from 1Password CLI if available)

### Container Setup

The setup step configures bs inside the container:

```bash
mkdir -p ~/.config/boxshop
cat > ~/.config/boxshop/config.toml <<EOF
org = "boxshopio"
repos_dir = "/home/claude/repos"
EOF
bs pull
```

Claude Code config (hooks, plugins, rules) carries over via the config volume. Rules symlinked from `boxshop-config`:

```bash
ln -s /home/claude/repos/boxshop-config/claude/config/rules/* ~/.claude/rules/
```

## Security Considerations

### Known Limitations

**nah bypass vectors (defense-in-depth, not a security boundary):**

- Claude can write a script that performs a blocked action, then execute the script
- MCP tool calls may not flow through the PreToolUse hook chain (must verify empirically)
- Tool chaining (`find -exec`, `xargs`, `perl -e`) can evade pattern matching
- Claude could modify `PATH` to shadow blocked commands

These are acceptable because the container is the security boundary, not `nah`. `nah` is UX — it catches the common accidents before they happen.

**Audit daemon (tamper-evident, not tamper-proof):**

Running punkgo-jack as a separate user prevents the claude user from:
- Killing the daemon
- Reading or modifying the audit log
- Accessing the signing key

The Merkle tree makes post-hoc tampering detectable. However, if the daemon crashes and isn't restarted, events during downtime are not captured.

**Credential exposure:**

All injected credentials are visible as env vars inside the container. Mitigations:
- `nah` blocks `env`/`printenv`/`set` commands
- Credentials should be scoped (fine-grained PATs, narrow IAM policies)
- AWS session tokens are short-lived
- The container cannot access host credential files (they're injected, not mounted)

**Repo volumes are the weakest link:**

The repo volume is persistent and writable. Git destructive operations (force push, reset --hard) are the highest-impact accident path. Mitigations:
- `nah` hard-blocks git history rewrites by default
- GitHub branch protection rules operate outside the container (strongest control)
- Pre-session volume snapshots (future enhancement)

### Hardening Checklist

Applied by default:

- [x] `--cap-drop=ALL`
- [x] `--read-only` root filesystem + tmpfs for scratch
- [x] `--security-opt=no-new-privileges`
- [x] No Docker socket
- [x] No `--privileged`
- [x] No host PID/network namespace
- [x] Separate audit user for punkgo-jack
- [x] Signing key owned by audit user (mode 0400)
- [x] Audit volume inaccessible to claude user
- [x] `env`/`printenv` blocked by default safety presets
- [x] Git history rewrites blocked by default

## Future Phases

### Phase 2: Dedicated Machine Identity (AWS)

**Current:** User's SSO token injected — same access as the user.
**Target:** IAM user in a tools account with cross-account role assumption.

```
tools-account
  └── claude-iam-user
        ├── assume → dev-account/ClaudeAdmin
        ├── assume → sandbox-account/ClaudeAdmin
        ├── assume → prod-account/ClaudeReadOnly
        └── assume → kingslanding-prod/ClaudeReadOnly
```

Decouples Claude's access from user identity. Requires:
- IAM user in tools account
- IAM roles in each target account with trust policy
- Scoped policies per role (read-only for prod, admin for dev/sandbox)

### Phase 3: Cloud-Hosted Sandbox

Same Docker image, deployed to ECS/Fargate via `km`. Enables:
- Run from anywhere (laptop, phone via web terminal)
- Fire-and-forget autonomous runs
- Audit logs shipped directly to S3
- Multiple concurrent sessions
- No local Docker required

Requires:
- VPC + security group setup
- ECS task definition generated from `.sandbox.yml`
- Web terminal (ttyd or similar) or SSH tunnel
- Session lifecycle management (auto-shutdown after idle)
- Cost controls (Fargate spot, auto-stop)

### Phase 4: Multi-Agent Support

Extend config to support Codex and Gemini CLI. Container architecture unchanged — just the agent binary and auth flow.

### Phase 5: Image Optimization

Multi-stage build producing Alpine or distroless runtime image. Only worth doing once toolchain is proven stable on Debian slim.

## Competitive Positioning

### What Others Do Well (and We Don't Compete With)

| Capability | Best Existing Solution |
|---|---|
| VM-level isolation | Docker Desktop Sandboxes (microVM) |
| macOS VM sandbox | ClodPod (Tart) |
| Multi-agent orchestration | Gluon Agent |
| K8s control plane | Spritz |
| Claude Code config reference | Trail of Bits config (1,652 stars) |

### What Crabcage Uniquely Offers

1. **Integrated safety classification** — `nah` pre-configured inside a container, with presets (supervised/autonomous/minimal). No manual hook installation.
2. **Cryptographic audit trail** — Only open-source tool offering tamper-evident, signed audit records for AI agent actions. Compliance-ready (SOC 2, HIPAA).
3. **Declarative config** — YAML config checked into repo. No Dockerfile editing.
4. **Zero-config first run** — `crabcage run` works with just an API key.
5. **Fail-fast credential validation** — Check creds before launch, not after 30s of container boot.
6. **Published base image** — Pre-built multi-arch image on GHCR. Nobody builds from source.

### Target Personas

1. **Enterprise security lead** (primary) — Needs compliance artifacts proving AI tool usage is governed. Cares about audit receipts and safety presets.
2. **Open-source maintainer** — Reviews PRs with AI tools on repos they maintain. Wants isolation from their credentials and host filesystem.
3. **Autonomous-mode power user** — Wants to let the agent run freely but within bounded risk. Sandbox enables autonomy safely.

## References

- [nah — Context-aware safety guard](https://github.com/manuelschipper/nah)
- [punkgo-jack — Cryptographic audit receipts](https://github.com/PunkGo/punkgo-jack)
- [Trail of Bits devcontainer](https://github.com/trailofbits/claude-code-devcontainer)
- [Trail of Bits config](https://github.com/trailofbits/claude-code-config)
- [Anthropic devcontainer reference](https://github.com/anthropics/claude-code/tree/main/.devcontainer)
- [Docker Desktop Sandboxes](https://docs.docker.com/ai/sandboxes/agents/claude-code/)
- [sandclaude](https://github.com/binwiederhier/sandclaude)
- [claude-container](https://github.com/nicwolff/claude-container)
- [Anthropic sandbox engineering blog](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Ona: How Claude Code escapes its sandbox](https://ona.com/stories/how-claude-code-escapes-its-own-denylist-and-sandbox)
