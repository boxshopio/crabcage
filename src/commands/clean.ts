import chalk from "chalk";
import { execa } from "execa";

export async function cleanCommand(): Promise<void> {
  console.log(chalk.dim("Pruning stopped containers and orphan volumes..."));
  await execa("docker", ["compose", "-p", "crabcage", "down", "--volumes", "--remove-orphans"], {
    stdio: "inherit",
    reject: false,
  });
  console.log(chalk.green("Cleaned up."));
}
