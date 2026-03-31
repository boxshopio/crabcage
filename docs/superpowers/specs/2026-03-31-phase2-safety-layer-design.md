# Phase 2: Safety Layer Design

**Date:** 2026-03-31
**Status:** Draft
**Spec:** `docs/specs/2026-03-23-crabcage-design.md`

## Overview

Phase 2 adds the safety layer to crabcage. When `safety.enabled: true`, crabcage generates a configuration for the active safety backend and wires it into the container at startup. The safety backend classifies every Claude Code tool call as allow/ask/block before execution.

**What Phase 2 does:** Config generation and container wiring. Crabcage translates its own policy vocabulary (presets, git guardrails, overrides, sensitive paths) into backend-specific config, writes it into the container, and installs the backend's hooks. Crabcage's job ends at container startup — all runtime classification is the backend's responsibility.

**What Phase 2 does not do:** Runtime observation of backend decisions, audit trail integration (Phase 3), or network filtering (Phase 4).

## Safety Backend

A safety backend is a tool that intercepts Claude Code tool calls at runtime and classifies them according to policy. The backend runs inside the container as a Claude Code PreToolUse hook.

Crabcage does not run the backend or interact with it at runtime. Crabcage's role is:

1. Translate its config into backend-specific config
2. Write that config into the container (read-only, not modifiable by the agent)
3. Install the backend's hooks in the entrypoint

The first (and currently only) backend is [nah](https://github.com/manuelschipper/nah/) — a deterministic command classifier for Claude Code. If a second backend is introduced, the translation layer can be extracted into a formal interface at that point. Until then, the nah-specific logic lives in `src/safety/` without an abstraction layer.

### Why a backend model

Crabcage defines policy. The backend enforces it. This separation means:

- The user-facing config (`.crabcage.yml`) is stable regardless of which backend is active
- Presets, git guardrails, and overrides use crabcage's vocabulary, not the backend's
- Swapping or upgrading the backend doesn't change the config format

## Config Generation

### Preset Mapping

Each crabcage preset maps to a set of nah `actions:` overrides layered on top of nah's `full` profile. Where a cell says "default", crabcage does not override — nah's own profile handles it.

| Crabcage action type | nah action type(s) | supervised | autonomous | minimal |
|---|---|---|---|---|
| `filesystem_delete` | `filesystem_delete` | ask | block | default |
| `git_remote_write` | `git_remote_write` | ask | allow | default |
| `git_history_rewrite` | `git_history_rewrite` | block | block | ask |
| `git_local_destructive` | `git_discard` | ask | block | default |
| `process_signal` | `process_signal` | ask | block | default |
| `obfuscated` | `obfuscated` | block | block | ask |

All presets use nah's `full` profile as the base, which provides comprehensive command classification tables and sensible defaults for action types not listed above.

### Git Guardrail Translation

The `git:` config section translates to nah action type overrides:

| Git config field | nah action type | Mapping |
|---|---|---|
| `git.push: false` | `git_remote_write` | block |
| `git.push: true` | `git_remote_write` | (no override — preset decides) |
| `git.force_push: block` | `git_history_rewrite` | block |
| `git.force_push: ask` | `git_history_rewrite` | ask |
| `git.delete_branch: ask` | `git_remote_write` | (handled via nah classify entry) |
| `git.delete_branch: block` | `git_remote_write` | (handled via nah classify entry) |
| `git.local_destructive: ask` | `git_discard` | ask |
| `git.local_destructive: block` | `git_discard` | block |
| `git.create_pr` | `git_remote_write` | (handled via nah classify entry for `gh pr create`) |
| `git.merge: false` | `git_remote_write` | (handled via nah classify entry for `gh pr merge`) |

For `delete_branch`, `create_pr`, and `merge`, crabcage generates nah `classify:` entries that map specific command prefixes to action types:

```yaml
# generated nah classify entries for git guardrails
classify:
  git_remote_write:
    - git branch -d       # delete_branch (when set to ask or block)
    - git branch -D
    - git push origin --delete
    - gh pr create        # create_pr (when false → block)
    - gh pr merge         # merge (when false → block)
```

The action type policy (allow/ask/block) for these entries is inherited from the `git_remote_write` action type, which is set by the preset and/or git guardrails.

Git guardrails can only tighten the active preset's policy, never relax it. The strictness ordering is: `allow` < `ask` < `block`. If the preset sets `git_history_rewrite: block` and the git config sets `force_push: ask`, the preset wins (block > ask).

### Overrides

`safety.overrides` applies after preset + git guardrails, same tighten-only rule. Keys are crabcage action type names, values are policies (`allow`, `ask`, `block`).

Valid crabcage action types for overrides:

- `filesystem_delete`
- `git_remote_write`
- `git_history_rewrite`
- `git_local_destructive`
- `process_signal`
- `obfuscated`

An unrecognized action type in overrides is a validation error (fail-fast, pre-launch).

### Sensitive Paths

`safety.sensitive_paths.block` and `safety.sensitive_paths.ask` map directly to nah's `sensitive_paths:` config field:

```yaml
# crabcage config
safety:
  sensitive_paths:
    block:
      - ~/.km/usage.jsonl
    ask:
      - ~/.km/config.yml

# generated nah config
sensitive_paths:
  ~/.km/usage.jsonl: block
  ~/.km/config.yml: ask
```

### Credential Exposure

All presets except `minimal` block `env`, `printenv`, and `set` commands to prevent credential leakage. This is implemented via nah's `classify:` field, which maps command prefixes to action types:

```yaml
# generated nah config
classify:
  obfuscated:
    - env
    - printenv
    - set
```

The `obfuscated` action type is `block` in supervised/autonomous, `ask` in minimal — so credential exposure inherits the preset's obfuscation policy.

## Container Wiring

### Config Injection

Crabcage generates the nah config YAML on the host and bind-mounts it into the container as a read-only file:

- **Host path:** `~/.config/crabcage/nah-config.yaml`
- **Container path:** `/home/claude/.config/nah/config.yaml:ro`

The compose generator adds this mount when `safety.enabled: true`. The file is root-owned inside the container, readable by the claude user, not writable. The agent cannot modify its own safety rules.

### Hook Installation

The container entrypoint checks for the nah config file at the mounted path. If present:

1. Run `nah install` — writes the hook script to `~/.claude/hooks/nah_guard.py` and patches `~/.claude/settings.json` with PreToolUse hook entries
2. The `.claude` directory is a named volume, so hooks persist across container restarts
3. `nah install` is idempotent — safe to run on every startup

If the config file is absent (safety disabled), the entrypoint skips hook installation. Claude Code launches with `--dangerously-skip-permissions` as in Phase 1.

### Startup Output

When safety is enabled, the run command's startup message reflects the active configuration:

```
Starting Claude Code...
  Safety layer: supervised (nah)
  Git guardrails: push + PR (no merge, force-push blocked)
```

When safety is disabled (Phase 1 behavior):

```
Starting Claude Code...
  Claude Code permissions are managed by crabcage's container boundary
  (and safety layers if enabled), not by Claude Code's built-in prompts.
```

## Error Handling

All failures are fail-fast, pre-launch. The container never starts in an inconsistent state.

**Safety enabled but nah not in image.** The entrypoint runs `nah install`. If `nah` is not found, the entrypoint exits with: `"Safety layer enabled but nah is not installed in the container image."` This only happens with custom images — the official Dockerfile installs nah.

**Invalid override action type.** `generate()` throws a validation error if `safety.overrides` contains an unrecognized action type. Caught before the container starts. The JSON schema in `schema.ts` should enumerate valid action types.

**Git guardrails relaxation attempt.** The tighten-only merge silently keeps the stricter policy. No warning needed — this is consistent with how the config loader already handles preset strictness.

## New Files

```
src/safety/
  presets.ts      — Preset policy tables as data (supervised/autonomous/minimal → nah action overrides)
  generate.ts     — Merge preset + git guardrails + overrides + sensitive_paths → nah config object
  serialize.ts    — Serialize nah config object to YAML string
tests/safety/
  presets.test.ts  — Preset mapping correctness
  generate.test.ts — Merge logic, tighten-only, git translation, sensitive paths, credential exposure
```

## Changed Files

- `src/docker/compose.ts` — Add nah config bind mount when safety enabled
- `src/commands/run.ts` — Generate + write nah config before compose generation when safety enabled
- `container/entrypoint.sh` — Run `nah install` if nah config exists at mounted path
- `tests/docker/compose.test.ts` — Verify nah config mount presence/absence

## Not Changed

- `src/config/schema.ts` — Already defines `SafetyConfig` with all needed fields
- `src/config/loader.ts` — Already validates git-requires-safety and tighten-only for presets
- `src/config/defaults.ts` — `safety.enabled: false` default is correct

## Testing

**Unit tests (no Docker):**

- Preset correctness — each preset produces expected nah action overrides (snapshot-style)
- Git guardrail translation — each git config field maps to the correct nah action type/classify entry
- Tighten-only merging — relaxation attempts are rejected, tightening is accepted
- Sensitive paths passthrough — block/ask lists appear in generated nah config
- Credential exposure — `env`/`printenv`/`set` appear in nah classify section
- Compose integration — safety enabled adds nah config mount, disabled does not
- Serialization round-trip — generated object serializes to valid YAML

**Not tested (out of scope):**

- Nah's classification behavior — nah's responsibility
- Container startup with nah — manual smoke test, not unit test scope
