import { describe, it, expect } from "vitest";
import { validateConfig, type CrabcageConfig } from "../../src/config/schema.js";

describe("validateConfig", () => {
  it("accepts a minimal config with no fields", () => {
    const result = validateConfig({});
    expect(result.valid).toBe(true);
  });

  it("accepts a full config", () => {
    const config = {
      agent: "claude",
      image: "ghcr.io/boxshopio/crabcage:1.0.0",
      mounts: ["~/repos", "~/data:ro"],
      credentials: [
        { name: "GH_TOKEN", check: "gh auth status", help: "Run: export GH_TOKEN=..." },
      ],
      setup: {
        init: ["bs pull"],
        update: ["bs pull"],
      },
      git: {
        push: true,
        create_pr: true,
        merge: false,
        force_push: "block",
        delete_branch: "ask",
        local_destructive: "ask",
      },
      safety: {
        enabled: true,
        preset: "supervised",
      },
      audit: {
        enabled: true,
        export_path: "~/.crabcage/audit/",
        sign: true,
        tsa: true,
      },
      resources: {
        memory: "8g",
        cpus: 4,
        timeout: "4h",
        idle_timeout: "30m",
      },
      services: {
        postgres: { image: "postgres:16", environment: { POSTGRES_PASSWORD: "test" } },
      },
      network: {
        allow: ["github.com", "*.amazonaws.com"],
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  it("rejects invalid agent value", () => {
    const result = validateConfig({ agent: "invalid" });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("rejects invalid safety preset", () => {
    const result = validateConfig({ safety: { enabled: true, preset: "yolo" } });
    expect(result.valid).toBe(false);
  });

  it("rejects non-string mount entries", () => {
    const result = validateConfig({ mounts: [123] });
    expect(result.valid).toBe(false);
  });
});
