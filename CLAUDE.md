# CLAUDE.md - Crabcage

## Project Overview

Crabcage is a CLI tool (`@crabcage/cli`) that runs AI coding agents (Claude Code, Codex, Gemini) inside hardened Docker containers with layered security controls. Published to npm, used via `npx crabcage run` or global install.

## Structure

```
src/
  cli.ts                     # Entry point — Commander program with subcommands
  commands/
    run.ts                   # Launch sandbox (config -> credentials -> mounts -> compose -> docker)
    stop.ts                  # Stop running sandbox (compose down)
    shell.ts                 # Attach shell to running sandbox
    status.ts                # Show sandbox status (compose ps)
    update.ts                # Pull latest sandbox image
    clean.ts                 # Remove stopped containers and orphan volumes
  config/
    schema.ts                # CrabcageConfig interface + AJV JSON Schema validation
    loader.ts                # Multi-layer config loading with trust boundaries
    defaults.ts              # Default values for all config fields
  credentials/
    detect-auth.ts           # Detect Claude auth (API key or macOS Keychain subscription)
    validator.ts             # Validate user-defined credentials with optional check commands
  docker/
    compose.ts               # Generate docker-compose spec with hardening flags
    client.ts                # Docker Compose CLI wrapper (up, down, exec, ps, attach)
  mounts/
    denylist.ts              # Block dangerous mount paths (~/.ssh, ~/.aws, /, ~, etc.)
    resolver.ts              # Resolve mount paths to host:container pairs
dist/                        # Compiled output (committed: no)
tests/                       # (not yet created)
.github/workflows/
  ci.yml                     # Build + test on Node 22
  release.yml                # Publish to npm
  pr-size.yml                # PR size labels
```

## Tooling

| Tool       | Purpose          | Command            |
|------------|------------------|--------------------|
| TypeScript | Language         | `tsc`              |
| tsx        | Dev runner       | `tsx src/cli.ts`   |
| Vitest     | Test framework   | `vitest run`       |
| npm        | Package manager  | `npm ci`           |

## Commands

```bash
npm ci                # Install dependencies
npm run build         # Compile TypeScript (tsc)
npm run dev           # Run CLI in dev mode (tsx)
npm test              # Run tests (vitest run)
npm run test:watch    # Run tests in watch mode
npm run lint          # Type-check only (tsc --noEmit)
```

## Architecture

### Data Flow

```
CLI args + .crabcage.yml + ~/.config/crabcage/config.yml + env vars
  -> config/loader.ts (merge with trust boundaries + safety ratchet)
  -> config/schema.ts (AJV validation)
  -> config/defaults.ts (fill missing fields)
  -> credentials/detect-auth.ts (find Claude API key or subscription token)
  -> credentials/validator.ts (run check commands for user-defined creds)
  -> mounts/denylist.ts (reject dangerous paths)
  -> mounts/resolver.ts (resolve to host:container pairs)
  -> docker/compose.ts (generate hardened compose spec)
  -> docker/client.ts (write compose file, docker compose up)
```

### Config Layering (Precedence low -> high)

1. Built-in defaults
2. User global config (`~/.config/crabcage/config.yml`)
3. Repo-local `.crabcage.yml` (trust-restricted: cannot set `setup`, `mounts`, `credentials`, `services`)
4. Explicit `--config` flag (no restrictions)
5. CLI flags (`--safety`, `--audit`)
6. Environment variables (`CRABCAGE_SAFETY_PRESET`, `CRABCAGE_IMAGE`)

### Security Layers

- **Container hardening**: `cap_drop: ALL`, read-only rootfs, `no-new-privileges`, PID limit (256), tmpfs scratch, isolated bridge network, no Docker socket
- **Mount denylist**: Blocks `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gcloud`, Docker socket, `/etc`, `/`, `~/`
- **Safety ratchet**: Repo-local configs can only tighten safety presets, never relax them
- **Git guardrails**: Configurable push/PR/merge/force-push/delete-branch/local-destructive controls (require safety enabled)
- **Credential validation**: Pre-flight checks with configurable commands before container launch
- **Network filtering**: DNS allowlist for egress (via config)
- **Audit trail**: Optional cryptographic audit logging to named volume

### Supported Agents

`claude` (default), `codex`, `gemini` -- set via config `agent` field.

## Testing

- **Framework**: Vitest with globals enabled
- **Run**: `npm test` (or `vitest run`)
- **Watch**: `npm run test:watch`
- **Config**: `vitest.config.ts` at project root, test root is `.`
- **CI**: Tests run on Node 22 via GitHub Actions (`ci.yml`)

Tests directory does not exist yet. When adding tests, place them in `tests/` following the pattern `tests/<module>.test.ts`.

## Conventions

- ESM-only (`"type": "module"` in package.json, `NodeNext` module resolution)
- All imports use `.js` extension (TypeScript ESM requirement for NodeNext)
- Commander for CLI argument parsing
- AJV for config validation (uses CJS/ESM interop: `AjvModule.default`)
- `execa` for subprocess execution, `yaml` for YAML parsing, `chalk` for terminal output
- Config interfaces defined in `schema.ts`, defaults in `defaults.ts` -- keep them in sync
- Docker Compose spec generated programmatically, written to `~/.config/crabcage/docker-compose.yml`
- Compose project name is always `crabcage`

## Common Pitfalls

- **AJV import**: AJV uses CJS default export. The constructor is on `AjvModule.default`, not `AjvModule` directly. See `schema.ts` for the interop pattern.
- **Git guardrails without safety**: Configuring git guardrails (e.g., `force_push: block`) without `safety.enabled: true` throws an error -- guardrails are enforced via nah rules which require the safety layer.
- **Restricted repo-local fields**: `.crabcage.yml` in a repo cannot set `setup`, `mounts`, `credentials`, or `services` -- these are silently stripped with a warning. Only `~/.config/crabcage/config.yml` or explicit `--config` can set them.
- **Safety ratchet**: A repo-local config cannot relax a safety preset set by the global config. The stricter preset always wins.
- **macOS Keychain auth**: `detect-auth.ts` reads Claude subscription tokens from macOS Keychain via `security` CLI. This only works on macOS -- other platforms need `ANTHROPIC_API_KEY`.

## Before Committing

```bash
npm run lint          # tsc --noEmit (type-check)
npm test              # vitest run
npm run build         # tsc (verify compilation)
```
