import { execa } from "execa";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stringify as yamlStringify } from "yaml";
import type { ComposeSpec } from "./compose.js";

const PROJECT_NAME = "crabcage";

function composeFilePath(): string {
  const dir = join(homedir(), ".config", "crabcage");
  mkdirSync(dir, { recursive: true });
  return join(dir, "docker-compose.yml");
}

export function writeComposeFile(spec: ComposeSpec): string {
  const path = composeFilePath();
  writeFileSync(path, yamlStringify(spec));
  return path;
}

export async function composeUp(composePath: string): Promise<void> {
  await execa("docker", ["compose", "-f", composePath, "-p", PROJECT_NAME, "up", "-d"], {
    stdio: "inherit",
  });
}

export async function composeDown(): Promise<void> {
  const path = composeFilePath();
  await execa("docker", ["compose", "-f", path, "-p", PROJECT_NAME, "down"], {
    stdio: "inherit",
  });
}

export async function composeExec(command: string[]): Promise<void> {
  const path = composeFilePath();
  await execa(
    "docker",
    ["compose", "-f", path, "-p", PROJECT_NAME, "exec", "sandbox", ...command],
    { stdio: "inherit" },
  );
}

export async function composePs(): Promise<string> {
  const path = composeFilePath();
  const result = await execa("docker", [
    "compose", "-f", path, "-p", PROJECT_NAME, "ps", "--format", "json",
  ]);
  return result.stdout;
}

export async function attachToSandbox(): Promise<void> {
  const path = composeFilePath();
  await execa(
    "docker",
    ["compose", "-f", path, "-p", PROJECT_NAME, "exec", "-it", "sandbox", "claude", "--dangerously-skip-permissions"],
    { stdio: "inherit" },
  );
}
