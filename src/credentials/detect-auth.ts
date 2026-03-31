export interface AuthMode {
  mode: "api_key" | "none";
}

export function detectClaudeAuth(env: Record<string, string | undefined>): AuthMode {
  if (env.ANTHROPIC_API_KEY) {
    return { mode: "api_key" };
  }

  return { mode: "none" };
}
