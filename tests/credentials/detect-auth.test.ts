import { describe, it, expect } from "vitest";
import { detectClaudeAuth } from "../../src/credentials/detect-auth.js";

describe("detectClaudeAuth", () => {
  it("returns api_key when ANTHROPIC_API_KEY is set", () => {
    const result = detectClaudeAuth({ ANTHROPIC_API_KEY: "sk-ant-..." });
    expect(result.mode).toBe("api_key");
  });

  it("returns none when no API key is set", () => {
    const result = detectClaudeAuth({});
    expect(result.mode).toBe("none");
  });
});
