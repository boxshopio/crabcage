import chalk from "chalk";
import { composePs } from "../docker/client.js";

export async function statusCommand(): Promise<void> {
  try {
    const output = await composePs();
    if (!output.trim()) {
      console.log(chalk.dim("No sandbox running."));
      return;
    }
    console.log(output);
  } catch {
    console.log(chalk.dim("No sandbox running."));
  }
}
