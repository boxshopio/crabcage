import { describe, it, expect, vi } from "vitest";
import { detectClaudeAuth } from "../../src/credentials/detect-auth.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("no keychain");
  }),
}));

describe("detectClaudeAuth", () => {
  it("returns api_key when ANTHROPIC_API_KEY is set", () => {
    const result = detectClaudeAuth({ ANTHROPIC_API_KEY: "sk-ant-..." });
    expect(result.mode).toBe("api_key");
    expect(result.apiKey).toBe("sk-ant-...");
  });

  it("returns none when no API key and no keychain", () => {
    const result = detectClaudeAuth({});
    expect(result.mode).toBe("none");
  });
});
