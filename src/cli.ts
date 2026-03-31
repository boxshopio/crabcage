#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { stopCommand } from "./commands/stop.js";
import { shellCommand } from "./commands/shell.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";
import { cleanCommand } from "./commands/clean.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const program = new Command();

program
  .name("crabcage")
  .description("An auditable sandbox for agent harnesses")
  .version(pkg.version);

program
  .command("run")
  .description("Launch a sandbox for your AI agent")
  .option("-c, --config <path>", "Path to .crabcage.yml config file")
  .option("-s, --safety <preset>", "Safety preset: supervised, autonomous, minimal")
  .option("-a, --audit", "Enable cryptographic audit trail")
  .option("-d, --detach", "Run in background (detached mode)")
  .option("--allow-sensitive-mounts", "Allow mounting sensitive paths (bypasses denylist)")
  .action(async (opts) => {
    try {
      await runCommand(opts);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.command("stop").description("Stop the running sandbox").action(stopCommand);
program.command("shell").description("Open a shell in the running sandbox").action(shellCommand);
program.command("status").description("Show sandbox status").action(statusCommand);
program.command("update").description("Pull the latest sandbox image").action(updateCommand);
program.command("clean").description("Remove stopped sandboxes and orphan volumes").action(cleanCommand);

program.parse();
