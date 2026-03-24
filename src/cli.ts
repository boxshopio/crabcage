#!/usr/bin/env node
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { stopCommand } from "./commands/stop.js";
import { shellCommand } from "./commands/shell.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";
import { cleanCommand } from "./commands/clean.js";

const program = new Command();

program
  .name("crabcage")
  .description("An auditable sandbox for agent harnesses")
  .version("0.1.0");

program
  .command("run")
  .description("Launch a sandbox for your AI agent")
  .option("-c, --config <path>", "Path to .sandbox.yml config file")
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
