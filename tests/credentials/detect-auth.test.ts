import { describe, it, expect, vi } from "vitest";
import { detectClaudeAuth } from "../../src/credentials/detect-auth.js";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

import { existsSync } from "node:fs";
const mockExists = vi.mocked(existsSync);

describe("detectClaudeAuth", () => {
  it("returns api_key when ANTHROPIC_API_KEY is set", () => {
    const result = detectClaudeAuth({ ANTHROPIC_API_KEY: "sk-ant-..." });
    expect(result.mode).toBe("api_key");
  });

  it("returns oauth when credentials file exists", () => {
    mockExists.mockReturnValue(true);
    const result = detectClaudeAuth({});
    expect(result.mode).toBe("oauth");
  });

  it("returns none when neither is available", () => {
    mockExists.mockReturnValue(false);
    const result = detectClaudeAuth({});
    expect(result.mode).toBe("none");
  });

  it("prefers api_key over oauth when both exist", () => {
    mockExists.mockReturnValue(true);
    const result = detectClaudeAuth({ ANTHROPIC_API_KEY: "sk-ant-..." });
    expect(result.mode).toBe("api_key");
  });
});
