import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { validateConfig } from "./schema.js";
import { applyDefaults } from "./defaults.js";
import type { CrabcageConfig } from "./schema.js";

/** Fields that repo-local configs are NOT allowed to set. */
const RESTRICTED_REPO_FIELDS = ["setup", "mounts", "credentials", "services"] as const;

/** Safety preset strictness ordering (higher index = stricter). */
const PRESET_STRICTNESS: Record<string, number> = {
  minimal: 0,
  supervised: 1,
  autonomous: 2,
};

export interface LoadedConfig {
  config: CrabcageConfig;
  warnings: string[];
}

/** Strip restricted fields from a repo-local config. */
export function enforceRepoBoundary(raw: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...raw };
  for (const field of RESTRICTED_REPO_FIELDS) {
    if (field in cleaned) {
      delete cleaned[field];
    }
  }
  return cleaned;
}

/** Merge two partial configs. Safety can only tighten, never relax. */
export function mergeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base, ...override };

  // Safety-specific: can only tighten
  const baseSafety = base.safety as { preset?: string } | undefined;
  const overrideSafety = override.safety as { preset?: string } | undefined;

  if (baseSafety?.preset && overrideSafety?.preset) {
    const baseLevel = PRESET_STRICTNESS[baseSafety.preset] ?? 0;
    const overrideLevel = PRESET_STRICTNESS[overrideSafety.preset] ?? 0;

    if (overrideLevel < baseLevel) {
      // Override is less strict — keep base preset
      merged.safety = { ...overrideSafety, preset: baseSafety.preset };
    }
  }

  return merged;
}

function readYamlFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8");
  return (parseYaml(content) as Record<string, unknown>) ?? {};
}

/** Load config from all sources with precedence + trust boundary. */
export function loadConfig(options: {
  configPath?: string;
  cwd?: string;
  cliOverrides?: Record<string, unknown>;
}): LoadedConfig {
  const warnings: string[] = [];
  const cwd = options.cwd ?? process.cwd();

  // Layer 1: Built-in defaults (applied last via applyDefaults)
  let merged: Record<string, unknown> = {};

  // Layer 2: User global config (personal defaults, lowest file-based precedence)
  const globalConfigPath = join(homedir(), ".config", "crabcage", "config.yml");
  const globalRaw = readYamlFile(globalConfigPath);
  if (globalRaw) {
    merged = mergeConfigs(merged, globalRaw);
  }

  // Layer 3: Repo-local .crabcage.yml (team config overrides personal, trust-restricted)
  const repoConfigPath = join(cwd, ".crabcage.yml");
  const repoRaw = readYamlFile(repoConfigPath);
  if (repoRaw) {
    const stripped = enforceRepoBoundary(repoRaw);
    const strippedFields = RESTRICTED_REPO_FIELDS.filter((f) => f in repoRaw && !(f in stripped));
    for (const field of strippedFields) {
      warnings.push(
        `Ignoring '${field}' from ${repoConfigPath} — ${field} can only be set in ~/.config/crabcage/config.yml or via CLI.`,
      );
    }
    merged = mergeConfigs(merged, stripped);
  }

  // Layer 4: Explicit --config flag (no trust restriction)
  if (options.configPath) {
    const explicitRaw = readYamlFile(options.configPath);
    if (explicitRaw) {
      merged = mergeConfigs(merged, explicitRaw);
    }
  }

  // Layer 5: CLI overrides
  if (options.cliOverrides) {
    merged = mergeConfigs(merged, options.cliOverrides);
  }

  // Layer 6: Environment variables (highest precedence)
  const envOverrides: Record<string, unknown> = {};
  if (process.env.CRABCAGE_SAFETY_PRESET) {
    envOverrides.safety = { enabled: true, preset: process.env.CRABCAGE_SAFETY_PRESET };
  }
  if (process.env.CRABCAGE_IMAGE) {
    envOverrides.image = process.env.CRABCAGE_IMAGE;
  }
  if (Object.keys(envOverrides).length > 0) {
    merged = mergeConfigs(merged, envOverrides);
  }

  // Validate merged config
  const validation = validateConfig(merged);
  if (!validation.valid) {
    throw new Error(`Invalid config:\n${validation.errors?.join("\n")}`);
  }

  // Apply defaults for missing fields
  const config = applyDefaults(merged as Partial<CrabcageConfig>);

  // Check: git guardrails require safety enabled
  const hasGitGuardrails =
    config.git.force_push !== "allow" ||
    config.git.local_destructive !== "allow" ||
    !config.git.merge;
  if (hasGitGuardrails && !config.safety.enabled) {
    throw new Error(
      "Git guardrails are configured but safety is disabled. Git guardrails are enforced via nah rules and require safety.enabled: true.",
    );
  }

  return { config, warnings };
}
