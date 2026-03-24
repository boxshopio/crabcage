import { describe, it, expect } from "vitest";
import { resolveMount } from "../../src/mounts/resolver.js";

describe("resolveMount", () => {
  it("resolves ~/repos to /home/claude/repos", () => {
    const result = resolveMount("~/repos");
    expect(result.containerPath).toBe("/home/claude/repos");
    expect(result.readOnly).toBe(false);
  });

  it("handles :ro suffix", () => {
    const result = resolveMount("~/data:ro");
    expect(result.containerPath).toBe("/home/claude/data");
    expect(result.readOnly).toBe(true);
  });

  it("handles explicit container path with colon syntax", () => {
    const result = resolveMount("/opt/shared:/mnt/shared:ro");
    expect(result.containerPath).toBe("/mnt/shared");
    expect(result.readOnly).toBe(true);
  });

  it("resolves . to /home/claude/work", () => {
    const result = resolveMount(".", "/Users/test/my-project");
    expect(result.containerPath).toBe("/home/claude/work");
    expect(result.readOnly).toBe(false);
  });
});
