import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AuthMode {
  mode: "api_key" | "oauth" | "none";
  credentialsPath?: string;
}

export function detectClaudeAuth(env: Record<string, string | undefined>): AuthMode {
  if (env.ANTHROPIC_API_KEY) {
    return { mode: "api_key" };
  }

  const credPath = join(homedir(), ".claude", ".credentials.json");
  if (existsSync(credPath)) {
    return { mode: "oauth", credentialsPath: credPath };
  }

  return { mode: "none" };
}
