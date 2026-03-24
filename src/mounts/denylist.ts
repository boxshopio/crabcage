import { homedir } from "node:os";
import { resolve, normalize } from "node:path";

export interface MountCheckResult {
  blocked: boolean;
  reason?: string;
}

interface DenyRule {
  pattern: string;
  reason: string;
}

const DENIED_PATHS: DenyRule[] = [
  { pattern: "~/.ssh", reason: "cryptographic keys (SSH)" },
  { pattern: "~/.gnupg", reason: "cryptographic keys (GPG)" },
  { pattern: "~/.aws", reason: "cloud credentials (AWS)" },
  { pattern: "~/.config/gcloud", reason: "cloud credentials (GCP)" },
  { pattern: "~/.docker/config.json", reason: "registry credentials (Docker)" },
  { pattern: "/etc", reason: "system configuration" },
  { pattern: "/var/run/docker.sock", reason: "Docker socket (host-root equivalent)" },
];

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return resolve(homedir(), p.slice(2));
  }
  if (p === "~") {
    return homedir();
  }
  return resolve(p);
}

function normalized(p: string): string {
  return normalize(p).replace(/\/+$/, "");
}

export function checkMountPath(rawPath: string): MountCheckResult {
  // Strip :ro/:rw suffix for checking
  const pathOnly = rawPath.split(":")[0];
  const expanded = expandPath(pathOnly);
  const home = homedir();

  // Block root mount
  if (expanded === "/" || normalized(pathOnly) === "/") {
    return { blocked: true, reason: "Mounting / is overly broad — defeats container isolation" };
  }

  // Block home directory mount
  if (expanded === home || normalized(pathOnly) === "~" || normalized(pathOnly) === "~/") {
    return {
      blocked: true,
      reason: "Mounting ~/ is overly broad — exposes SSH keys, credentials, and all personal files",
    };
  }

  // Check denylist
  for (const rule of DENIED_PATHS) {
    const deniedExpanded = expandPath(rule.pattern);
    if (expanded === deniedExpanded || expanded.startsWith(deniedExpanded + "/")) {
      return { blocked: true, reason: `Contains ${rule.reason}` };
    }
  }

  return { blocked: false };
}
