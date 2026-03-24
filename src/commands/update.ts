import chalk from "chalk";
import { execa } from "execa";

const DEFAULT_IMAGE = "ghcr.io/boxshopio/crabcage:latest";

export async function updateCommand(): Promise<void> {
  console.log(chalk.dim(`Pulling ${DEFAULT_IMAGE}...`));
  await execa("docker", ["pull", DEFAULT_IMAGE], { stdio: "inherit" });
  console.log(chalk.green("Image updated."));
}
