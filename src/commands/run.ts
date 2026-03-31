import chalk from "chalk";
import { loadConfig } from "../config/loader.js";
import { detectClaudeAuth } from "../credentials/detect-auth.js";
import { validateAllCredentials } from "../credentials/validator.js";
import { checkMountPath } from "../mounts/denylist.js";
import { resolveMount } from "../mounts/resolver.js";
import { generateCompose } from "../docker/compose.js";
import { writeComposeFile, composeUp, attachToSandbox } from "../docker/client.js";
import type { ResolvedMount } from "../mounts/resolver.js";

export interface RunOptions {
  config?: string;
  safety?: string;
  audit?: boolean;
  detach?: boolean;
  allowSensitiveMounts?: boolean;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const cwd = process.cwd();
  const env = process.env as Record<string, string | undefined>;

  // Build CLI overrides
  const cliOverrides: Record<string, unknown> = {};
  if (options.safety) {
    cliOverrides.safety = { enabled: true, preset: options.safety };
  }
  if (options.audit) {
    cliOverrides.audit = { enabled: true };
  }

  // Load config
  console.log(chalk.dim("Loading config..."));
  const { config, warnings } = loadConfig({
    configPath: options.config,
    cwd,
    cliOverrides,
  });
  for (const w of warnings) {
    console.log(chalk.yellow(`  ⚠ ${w}`));
  }

  // Detect Claude auth
  const auth = detectClaudeAuth(env);
  if (auth.mode === "none") {
    console.log(
      chalk.yellow("  ⚠ Claude auth       no API key or OAuth token found on host"),
    );
    console.log(
      chalk.dim("    → Run 'claude login' inside the container to authenticate"),
    );
  } else {
    console.log(chalk.green("  ✓ Claude auth       API key"));
  }

  // Validate credentials
  if (config.credentials.length > 0) {
    console.log(chalk.dim("\nChecking credentials..."));
    const results = await validateAllCredentials(config.credentials, env);
    let hasFailure = false;

    for (const r of results) {
      if (r.valid) {
        if (r.warning) {
          console.log(chalk.yellow(`  ⚠ ${r.name.padEnd(18)} ${r.warning}`));
        } else {
          console.log(chalk.green(`  ✓ ${r.name.padEnd(18)} valid`));
        }
      } else {
        hasFailure = true;
        console.log(chalk.red(`  ✗ ${r.name.padEnd(18)} ${r.error}`));
        if (r.help) {
          console.log(chalk.dim(`    → ${r.help}`));
        }
      }
    }

    if (hasFailure) {
      console.error(chalk.red("\nAborting. Fix the above and retry."));
      process.exit(1);
    }
  }

  // Resolve and validate mounts
  const allMountPaths = [".", ...config.mounts];
  const resolvedMounts: ResolvedMount[] = [];

  for (const mp of allMountPaths) {
    const check = checkMountPath(mp);
    if (check.blocked && !options.allowSensitiveMounts) {
      console.error(chalk.red(`  ✗ Mount blocked: ${mp}`));
      console.error(chalk.dim(`    ${check.reason}`));
      console.error(chalk.dim("    Use --allow-sensitive-mounts to override."));
      process.exit(1);
    }
    resolvedMounts.push(resolveMount(mp, cwd));
  }

  // Generate compose
  console.log(chalk.dim("\nStarting sandbox..."));
  console.log(
    chalk.dim(
      "  Claude Code permissions are managed by crabcage's container boundary\n" +
      "  (and safety layers if enabled), not by Claude Code's built-in prompts.",
    ),
  );

  const compose = generateCompose(config, resolvedMounts, auth, env);
  const composePath = writeComposeFile(compose);

  // Launch
  await composeUp(composePath);

  if (!options.detach) {
    await attachToSandbox();
  } else {
    console.log(chalk.green("\nSandbox running in background."));
    console.log(chalk.dim("  crabcage shell    — attach to sandbox"));
    console.log(chalk.dim("  crabcage stop     — stop sandbox"));
    console.log(chalk.dim("  crabcage status   — view status"));
  }
}
