import { describe, it, expect } from "vitest";
import { checkMountPath } from "../../src/mounts/denylist.js";

describe("checkMountPath", () => {
  it("blocks ~/.ssh", () => {
    const result = checkMountPath("~/.ssh");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("cryptographic keys");
  });

  it("blocks ~/.aws", () => {
    const result = checkMountPath("~/.aws");
    expect(result.blocked).toBe(true);
  });

  it("blocks ~/.gnupg", () => {
    const result = checkMountPath("~/.gnupg");
    expect(result.blocked).toBe(true);
  });

  it("blocks ~/.docker/config.json", () => {
    const result = checkMountPath("~/.docker/config.json");
    expect(result.blocked).toBe(true);
  });

  it("blocks home directory mount ~/", () => {
    const result = checkMountPath("~/");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("overly broad");
  });

  it("blocks root mount /", () => {
    const result = checkMountPath("/");
    expect(result.blocked).toBe(true);
  });

  it("blocks /etc", () => {
    const result = checkMountPath("/etc");
    expect(result.blocked).toBe(true);
  });

  it("blocks /var/run/docker.sock", () => {
    const result = checkMountPath("/var/run/docker.sock");
    expect(result.blocked).toBe(true);
  });

  it("allows ~/repos", () => {
    const result = checkMountPath("~/repos");
    expect(result.blocked).toBe(false);
  });

  it("allows ~/projects/my-app", () => {
    const result = checkMountPath("~/projects/my-app");
    expect(result.blocked).toBe(false);
  });

  it("allows absolute path /opt/data", () => {
    const result = checkMountPath("/opt/data");
    expect(result.blocked).toBe(false);
  });
});
