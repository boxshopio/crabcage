# Crabcage Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Authors:** Tony (dreslan), Claude

## Overview

Crabcage is an auditable sandbox for agent harnesses. Run your AI coding agent in a container so your local filesystem, credentials, and shell history are isolated by default. Then dial in additional protections as needed.

**What the container protects:** Your local machine. Your filesystem, credentials, shell history, and other repos are isolated. Even with `--dangerously-skip-permissions`, the agent can't damage your laptop.

**What the container does NOT protect:** External systems. If you give the agent credentials that can push to GitHub, deploy to AWS, or modify DNS, the agent can use them. The container doesn't know the difference between a good push and a bad one.

**That's what the other layers are for.** Each one addresses a different category of risk:

| Protection Layer | What it does | Why |
|---|---|---|
| Container isolation | Filesystem separation from host | Agent can't touch your real files |
| Command approval (nah) | Classifies commands as allow/ask/block | Catch destructive commands before they run |
| Git guardrails | Control push/PR/merge/force-push independently | Humans review and merge, agent proposes |
| Credential scoping | Read-only for prod, full for dev | Agent can investigate prod but can't break it |
| Data locality | Repos are clones, not mounts | Agent works on a copy, originals untouched |
| Audit trail (punkgo-jack) | Cryptographic receipts for every action | Prove what happened, tune policies over time |
| Network filtering | DNS allowlist for egress | Prevent accidental exfiltration or wrong-env calls |

The container is always on. Everything else is a dial you turn up as needed.

**Tagline:** An auditable sandbox for agent harnesses.

**What it is NOT:** An orchestration platform, a Kubernetes control plane, or a devcontainer for human development.

**Supported agents (v1):** Claude Code. Designed to extend to Codex, Gemini CLI later.

## Problem Statement

No existing solution combines container isolation, contextual safety classification, and cryptographic audit trails into a single tool. The landscape is fragmented:

- **Trail of Bits devcontainer** — strong container isolation, no safety hooks or audit trail
- **Docker Desktop Sandboxes** — strongest isolation (microVM), but proprietary black box, no extensibility
- **Trail of Bits config** — excellent hook patterns, but guardrails not walls, no container isolation
- **nah** — contextual safety classification, but standalone tool, no container integration
- **punkgo-jack** — cryptographic audit receipts, but standalone tool, no container integration

Crabcage integrates these into a single tool where the container provides baseline safety (your filesystem is untouched even if the agent goes off the rails) and everything else is a dial you turn up as needed.

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

**Base image:** Multi-stage build, published to GHCR as `ghcr.io/boxshopio/crabcage:latest` (amd64 + arm64). End users always pull the pre-built image — the Dockerfile details below are for maintainers publishing the image.

```
Stage 1 (builder): debian:bookworm
  - build-essential, cargo (compile punkgo-jack)
  - Any native deps that need compilation

Stage 2 (runtime): debian:bookworm-slim
  - Node.js 22, Python 3.13+, uv, git, gh, aws-cli v2
  - jq, ripgrep, fzf, tmux
  - Claude Code (npm install -g @anthropic-ai/claude-code)
  - nah (pip install in runtime stage — Python package, no compilation needed)
  - punkgo-jack binary (compiled in builder, copied to runtime)
```

**Container hardening (defaults):**

```
--cap-drop=ALL
--read-only                    # root filesystem is immutable
--tmpfs /tmp --tmpfs /var/tmp  # writable scratch space
--security-opt=no-new-privileges
--network=crabcage-net         # isolated bridge network
```

**Writable paths despite `--read-only`:** The root filesystem is immutable, but these paths are writable via volumes or tmpfs:
- `/home/claude/repos` — repo volume (persistent)
- `/home/claude/.claude` — config volume (persistent)
- `/home/claude/.local` — tmpfs (Python user-site packages from `tools:` commands, ephemeral)
- `/var/audit` — audit volume (persistent, audit user only)
- `/tmp`, `/var/tmp` — tmpfs (scratch space, ephemeral)

The `tools:` commands from `.sandbox.yml` (e.g., `uv pip install -e ...`) run at container startup **before** Claude Code starts. They install to `/home/claude/.local` (Python user-site), which is a tmpfs mount. This means custom tools are re-installed on each container launch — acceptable since `uv pip install` is fast and the tools are already cloned in the repos volume.

No Docker socket. No `--privileged`. No host PID/network namespace.

**Users inside the container:**

| User | Purpose |
|---|---|
| `claude` (UID configurable) | Runs Claude Code, owns repo workspace |
| `audit` | Runs punkgo-jack daemon, owns audit logs and signing key. Claude user cannot signal audit's processes (standard Unix: non-root users cannot signal other users' processes) or read audit-owned files (directory permissions 0700). Combined with `--security-opt=no-new-privileges`, the claude user cannot escalate to audit. |

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

**Fail-fast validation:** Every credential is checked before the container starts using the `check` command from the config (or built-in defaults). Validation is **exit-code based** — a zero exit code means valid, non-zero means invalid. The status line shows the credential name and pass/fail:

```
Checking credentials...
  ✓ Claude auth       valid (OAuth)
  ✓ GH_TOKEN          valid
  ✗ AWS session        check failed
    → Run: aws sso login --sso-session boxshop

Aborting. Fix the above and retry.
```

The `help` field from the config provides the actionable fix message. The launcher does not parse command output for scope or token details — it only checks whether the credential is present and the check command succeeds.

**Execution context:** Credential checks run on the **host**, before the container starts. The check commands (e.g., `gh auth status`, `aws sts get-caller-identity`) must be available in the user's host environment. If a check command is not found, the launcher warns but does not fail — the credential is treated as unverified.

## Implementation

**Language:** TypeScript/Node.js. The CLI is an npm package.

**Why Node, not Python/Rust/Go:**
- Everyone running Claude Code already has Node installed — it's a prerequisite
- `npx crabcage run` enables zero-install first runs (no global install needed)
- `npm install -g crabcage` for permanence
- Brew formula available for macOS users who prefer it
- The CLI is thin orchestration (Docker commands, YAML parsing, credential checks) — no performance-critical paths
- Internal tools (`km`, `bs`, `kl`) remain Python; this is an OSS tool with different distribution constraints

**Package name:** `crabcage` on npm. Entry point: `crabcage` CLI command.

**Dependencies (minimal):**
- `commander` or `yargs` — CLI framework
- `yaml` — config file parsing
- `ajv` — JSON schema validation
- `chalk` or `picocolors` — terminal output

The CLI does NOT run inside the container. It runs on the host and orchestrates Docker.

## CLI

### Installation

```bash
npx crabcage run          # zero-install, try it immediately
npm install -g crabcage   # permanent install
brew install crabcage     # macOS via Homebrew
```

### Zero-Config First Run

```bash
export ANTHROPIC_API_KEY=sk-...
cd my-project
crabcage run
```

Mounts current directory, pulls pre-built image, launches Claude Code with `--dangerously-skip-permissions`. No YAML, no config file. The container is the sandbox — your local filesystem is already protected. Safety classification and audit are off by default, ready to dial in.

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
crabcage audit recover     # export latest checkpoint from incomplete sessions
crabcage status            # show running sandboxes, volumes, image version
crabcage update            # pull latest image
crabcage clean             # prune stopped sandboxes and orphan volumes
```

### Interactive Setup

`crabcage init` walks through each protection layer with reasoning. It's educational — users understand what they're configuring and why. Can be re-run to update an existing config.

```
$ crabcage init

Crabcage protects your system in layers. Let's configure each one.

── Container Isolation (always on) ──────────────────────
Your agent runs in a container. Your local filesystem, credentials,
and shell history are isolated. This alone protects your machine —
but not external systems the agent has credentials for.

── Command Approval ─────────────────────────────────────
Catch destructive commands before they run. Uses 'nah' to classify
commands as allow/ask/block based on context, not just pattern matching.

Enable command approval? [y/N]: y

  How strict?
  a) supervised — asks before git push, deletes, production commands
  b) autonomous — blocks all destructive ops, allows pushes + PRs
  c) minimal    — only catches force-push and obfuscated commands
  d) custom     — configure each action type individually

  Choice [a]: a

── Git Guardrails ───────────────────────────────────────
How should the agent interact with git remotes?

  a) Push branches + create PRs (recommended — humans review and merge)
  b) Push branches + create PRs + merge (agent handles full workflow)
  c) Read-only (agent can commit locally but not push)

  Choice [a]: a

── Credential Scoping ───────────────────────────────────
Do you have production systems the agent should NOT write to?

  [y/N]: y

  Recommended: use read-only credentials for production. This is
  enforced at the provider level (IAM policies, read-only API tokens),
  not inside the sandbox. See: docs/credential-scoping.md

── Audit Trail ──────────────────────────────────────────
Want cryptographic proof of what the agent did? Uses tamper-evident
Merkle tree receipts that can be verified offline.

Enable audit trail? [y/N]: y

── Network Filtering ────────────────────────────────────
Restrict which domains the agent can reach. Prevents accidental
calls to wrong environments and naive data exfiltration.

Enable network filtering? [y/N]: n

── Credentials ──────────────────────────────────────────
Which credentials does your agent need?

  ✓ Claude auth (required)
  ? GitHub token [y/N]: y
  ? AWS credentials [y/N]: y
  ? Other (name):

── Repo Provisioning ────────────────────────────────────
Command to clone/update your repos inside the container (optional):
> bs pull

── Summary ──────────────────────────────────────────────

  Container isolation    ✓ always on
  Command approval       ✓ supervised (nah)
  Git guardrails         ✓ push + PR only (no merge)
  Credential scoping     ⚠ recommended (see docs)
  Audit trail            ✓ enabled (punkgo-jack)
  Network filtering      ✗ off

Wrote .sandbox.yml
Run 'crabcage run' to start your sandbox.
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

# Repo provisioning
# init: runs when the repos volume is empty (detected via marker file .crabcage-initialized)
# update: runs on subsequent launches when the marker file exists
repos:
  init: bs pull
  update: bs pull
  path: /home/claude/repos

# Additional tools installed at first launch
tools:
  - uv pip install -e /home/claude/repos/kingmaker
  - uv pip install -e /home/claude/repos/boxshop-cli

# Git guardrails
git:
  push: true           # agent can push branches
  create_pr: true      # agent can open PRs
  merge: false         # agent cannot merge (humans do this)
  force_push: block    # never allowed
  delete_branch: ask   # confirm before deleting

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

**Safety-specific constraint:** For `safety` settings, overrides can only **tighten** policy, never relax it. This matches nah's own philosophy for per-project configs. For example, if `.sandbox.yml` sets `preset: supervised`, a CLI flag or env var cannot relax to `minimal` (less restrictive). It can tighten to `autonomous` (more restrictive — blocks more actions). Non-safety settings (image, credentials, repos) follow normal precedence.

## Safety Presets

Three built-in presets defined by crabcage, each generating a complete `nah` config file (`~/.config/nah/config.yaml`). These are **crabcage concepts, not native nah presets** — nah's own profiles are `full`, `minimal`, and `none`. Crabcage maps its presets to nah action type overrides and custom classification rules at container startup.

The `env/printenv/set` blocking is a **crabcage-added classification rule**, not a built-in nah action type. Crabcage generates nah `classify` entries that map these commands to a `credential_exposure` action type with the configured policy.

The nah config is generated by the container entrypoint before Claude Code starts, based on the active preset + any overrides from `.sandbox.yml`. The generated config is written to `~/.config/nah/config.yaml` (owned by root, readable by claude, not writable).

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
| credential_exposure (env/printenv/set) | block |

### `autonomous`

Fire-and-forget. Destructive local operations are blocked. Remote writes (push branches, create PRs) are allowed because they are reversible (branch deletion, PR closure) and reviewable — the blast radius is bounded by GitHub branch protection rules, which operate outside the container.

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
| credential_exposure (env/printenv/set) | block |

### `minimal`

Just isolation. Almost everything allowed. All action types default to `allow` except:

| Action Type | Policy |
|---|---|
| filesystem_read | allow |
| filesystem_write | allow |
| filesystem_delete | allow |
| git_safe | allow |
| git_remote_write | allow |
| git_history_rewrite | ask |
| package_run | allow |
| network_outbound | allow |
| process_signal | allow |
| obfuscated | ask |
| credential_exposure (env/printenv/set) | allow |

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
2. `nah` PreToolUse hook fires — classifies — allow/ask/block — writes decision to a shared JSONL file (`/tmp/nah-decisions.jsonl`) containing the tool name, classification, and reasoning
3. `punkgo-jack` PreToolUse hook fires — reads the latest nah decision from the shared file, records the attempt + nah's classification into the Merkle tree
4. Tool executes (or doesn't)
5. `punkgo-jack` PostToolUse hook fires — records the outcome (success/failure/blocked)
6. Every 5 minutes, punkgo-jack anchors a checkpoint via RFC 3161 TSA (DigiCert)

**Inter-hook communication:** Claude Code hooks fire independently — there is no built-in pipeline between hooks. The nah→punkgo-jack data flow uses a shared file (`/tmp/nah-decisions.jsonl`) as the coordination mechanism. nah appends a decision line; punkgo-jack reads the latest line matching the current tool invocation. Each decision line includes a correlation key (tool name + timestamp + a monotonic sequence number) so punkgo-jack can match the correct decision even when multiple tool calls fire in rapid succession. The file lives on tmpfs and is ephemeral. If nah fails to write (or is disabled), punkgo-jack records the event without classification data — the audit chain is never broken by a safety layer failure.

**MCP tool coverage:** Claude Code's hook system fires PreToolUse/PostToolUse for MCP tool calls, but this must be verified empirically during implementation. If MCP calls bypass the hook chain, crabcage will add a network-level audit fallback: logging outbound HTTP requests from the container via the DNS sidecar or a transparent proxy. This is a **v1 implementation task** — the spec assumes hooks cover MCP, with a documented fallback if they don't.

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

**During the session:** Punkgo-jack periodically writes checkpoint receipts to `/var/audit/receipts/` (every TSA anchor, ~5 min). This ensures partial audit data survives container crashes, OOM kills, or host failures.

**On clean container exit:**

1. Shutdown hook triggers `punkgo-jack export --final`
2. Final receipt written to `/var/audit/receipts/<session-id>.json`
3. Receipt copied to host at configured `export_path` (default: `~/.crabcage/audit/`)
4. Receipt contains: session summary, event count, Merkle root, all inclusion proofs, TSA tokens

**On unclean exit (kill, OOM, crash):** The last checkpoint receipt in the audit volume is the recovery point. `crabcage audit list` detects incomplete sessions and flags them. `crabcage audit recover` exports the latest checkpoint from the volume.

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

### Config Immutability

**The agent cannot modify how it runs.** All safety configuration is immutable from inside the container:

- `.sandbox.yml` is **not mounted** into the container — the launcher reads it on the host and generates runtime config
- `~/.config/nah/config.yaml` is owned by root, readable by claude, not writable
- `punkgo-jack` config and signing key are owned by audit user, inaccessible to claude
- Claude Code `settings.json` hook registrations are root-owned and not writable
- The `git:` guardrails are enforced via nah rules generated at startup, not editable at runtime

To change how crabcage runs, edit the config **on the host** and restart the sandbox. The agent inside the cage cannot modify the cage.

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

Multi-stage build producing a lighter runtime image. Alpine is possible but historically problematic with Python native extensions (musl vs glibc). Distroless is likely impractical given the heavy toolchain (Node.js, Python, uv, git, gh, aws-cli, ripgrep, fzf, tmux). Realistically, the gain here is trimming unnecessary packages from the slim image, not a base image switch. Only worth pursuing once toolchain is proven stable.

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
- [ClodPod — macOS VMs for AI agents](https://github.com/webcoyote/clodpod)
- [Gluon Agent — Multi-agent orchestration](https://github.com/carrotly-ai/gluon-agent)
- [Spritz — K8s-native agent control plane](https://github.com/textcortex/spritz)
- [Deva — Docker launcher for AI CLIs](https://github.com/thevibeworks/deva)
