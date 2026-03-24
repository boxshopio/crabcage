import { composeExec } from "../docker/client.js";

export async function shellCommand(): Promise<void> {
  await composeExec(["bash"]);
}
