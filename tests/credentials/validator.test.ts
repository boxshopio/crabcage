import { describe, it, expect, vi } from "vitest";
import { validateCredential } from "../../src/credentials/validator.js";

// Mock execa to avoid running real commands
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
const mockExeca = vi.mocked(execa);

describe("validateCredential", () => {
  it("returns valid when env var is set and check succeeds", async () => {
    mockExeca.mockResolvedValueOnce({ exitCode: 0 } as any);
    const result = await validateCredential(
      { name: "GH_TOKEN", check: "gh auth status" },
      { GH_TOKEN: "test-token" },
    );
    expect(result.valid).toBe(true);
    expect(result.name).toBe("GH_TOKEN");
  });

  it("returns invalid when env var is missing", async () => {
    const result = await validateCredential(
      { name: "GH_TOKEN", check: "gh auth status" },
      {},
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not set");
  });

  it("returns invalid when check command fails", async () => {
    mockExeca.mockRejectedValueOnce(new Error("exit code 1"));
    const result = await validateCredential(
      { name: "AWS_SESSION", check: "aws sts get-caller-identity" },
      { AWS_SESSION: "set" },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("check failed");
  });

  it("returns valid with warning when check command not found", async () => {
    const err = new Error("ENOENT") as any;
    err.code = "ENOENT";
    mockExeca.mockRejectedValueOnce(err);
    const result = await validateCredential(
      { name: "CF_TOKEN", check: "some-missing-cli status" },
      { CF_TOKEN: "set" },
    );
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("not found");
  });

  it("skips check if no check command defined", async () => {
    const result = await validateCredential(
      { name: "MY_TOKEN" },
      { MY_TOKEN: "set" },
    );
    expect(result.valid).toBe(true);
  });

  it("treats optional credentials as valid even if missing", async () => {
    const result = await validateCredential(
      { name: "CF_TOKEN", required: false },
      {},
    );
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("not set");
  });
});
