import chalk from "chalk";
import { composeDown } from "../docker/client.js";

export async function stopCommand(): Promise<void> {
  console.log(chalk.dim("Stopping sandbox..."));
  await composeDown();
  console.log(chalk.green("Sandbox stopped."));
}
