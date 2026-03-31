import { execSync } from "node:child_process";

export interface AuthMode {
  mode: "api_key" | "subscription" | "none";
  apiKey?: string;
}

export function detectClaudeAuth(env: Record<string, string | undefined>): AuthMode {
  if (env.ANTHROPIC_API_KEY) {
    return { mode: "api_key", apiKey: env.ANTHROPIC_API_KEY };
  }

  // Try to extract subscription OAuth token from macOS Keychain
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const creds = JSON.parse(raw);
    const token = creds?.claudeAiOauth?.accessToken;
    if (token) {
      return { mode: "subscription", apiKey: token };
    }
  } catch {
    // Keychain not available or no entry — fall through
  }

  return { mode: "none" };
}
