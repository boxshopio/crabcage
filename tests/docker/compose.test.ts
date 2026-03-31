import { describe, it, expect } from "vitest";
import { generateCompose } from "../../src/docker/compose.js";
import { applyDefaults } from "../../src/config/defaults.js";
import type { CrabcageConfig } from "../../src/config/schema.js";
import type { ResolvedMount } from "../../src/mounts/resolver.js";
import type { AuthMode } from "../../src/credentials/detect-auth.js";

function makeConfig(overrides: Partial<CrabcageConfig> = {}): CrabcageConfig {
  return applyDefaults(overrides);
}

describe("generateCompose", () => {
  it("generates minimal compose with just CWD mount", () => {
    const config = makeConfig();
    const mounts: ResolvedMount[] = [
      { hostPath: "/Users/test/project", containerPath: "/home/claude/work", readOnly: false },
    ];
    const auth: AuthMode = { mode: "api_key", apiKey: "sk-test" };
    const result = generateCompose(config, mounts, auth, { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.services.sandbox).toBeDefined();
    expect(result.services.sandbox.image).toBe("ghcr.io/boxshopio/crabcage:latest");
    expect(result.services.sandbox.cap_drop).toEqual(["ALL"]);
    expect(result.services.sandbox.read_only).toBe(true);
    expect(result.services.sandbox.volumes).toContain(
      "/Users/test/project:/home/claude/work:rw",
    );
    expect(result.services.sandbox.environment).toContain("ANTHROPIC_API_KEY=sk-test");
  });

  it("includes resource limits", () => {
    const config = makeConfig({ resources: { memory: "16g", cpus: 8, timeout: "0", idle_timeout: "0" } });
    const mounts: ResolvedMount[] = [];
    const auth: AuthMode = { mode: "api_key", apiKey: "sk-test" };
    const result = generateCompose(config, mounts, auth, { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.services.sandbox.mem_limit).toBe("16g");
    expect(result.services.sandbox.cpus).toBe(8);
  });

  it("includes sidecar services", () => {
    const config = makeConfig({
      services: {
        postgres: { image: "postgres:16", environment: { POSTGRES_PASSWORD: "test" } },
      },
    });
    const mounts: ResolvedMount[] = [];
    const auth: AuthMode = { mode: "api_key", apiKey: "sk-test" };
    const result = generateCompose(config, mounts, auth, { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.services.postgres).toBeDefined();
    expect(result.services.postgres.image).toBe("postgres:16");
  });

  it("mounts host .claude directory for subscription auth", () => {
    const config = makeConfig();
    const mounts: ResolvedMount[] = [];
    const auth: AuthMode = { mode: "none" };
    const result = generateCompose(config, mounts, auth, {});

    const vols = result.services.sandbox.volumes as string[];
    expect(vols.some((v: string) => v.includes(".claude") && v.includes("/home/claude/.claude"))).toBe(true);
    const env = result.services.sandbox.environment as string[];
    expect(env.some((e: string) => e.startsWith("ANTHROPIC_API_KEY="))).toBe(false);
  });

  it("includes tmpfs mounts for /tmp and /home/claude/.local", () => {
    const config = makeConfig();
    const mounts: ResolvedMount[] = [];
    const auth: AuthMode = { mode: "api_key", apiKey: "sk-test" };
    const result = generateCompose(config, mounts, auth, { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.services.sandbox.tmpfs).toContain("/tmp");
    expect(result.services.sandbox.tmpfs).toContain("/var/tmp");
    expect(result.services.sandbox.tmpfs).toContain("/home/claude/.local");
  });

  it("includes security hardening defaults", () => {
    const config = makeConfig();
    const mounts: ResolvedMount[] = [];
    const auth: AuthMode = { mode: "api_key", apiKey: "sk-test" };
    const result = generateCompose(config, mounts, auth, { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.services.sandbox.security_opt).toEqual(["no-new-privileges"]);
    expect(result.services.sandbox.pids_limit).toBe(256);
  });

  it("assigns all services to crabcage-net", () => {
    const config = makeConfig();
    const mounts: ResolvedMount[] = [];
    const auth: AuthMode = { mode: "api_key", apiKey: "sk-test" };
    const result = generateCompose(config, mounts, auth, { ANTHROPIC_API_KEY: "sk-test" });

    expect(result.services.sandbox.networks).toEqual(["crabcage-net"]);
    expect(result.networks).toBeDefined();
  });
});
