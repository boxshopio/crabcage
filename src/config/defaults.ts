import type { CrabcageConfig } from "./schema.js";

export const DEFAULT_IMAGE = "ghcr.io/boxshopio/crabcage:latest";
export const DEFAULT_AGENT = "claude";

export const DEFAULT_GIT = {
  push: true,
  create_pr: true,
  merge: true,
  force_push: "allow" as const,
  delete_branch: "allow" as const,
  local_destructive: "allow" as const,
};

export const DEFAULT_RESOURCES = {
  memory: "8g",
  cpus: 4,
  timeout: "0",
  idle_timeout: "0",
};

export function applyDefaults(config: Partial<CrabcageConfig>): CrabcageConfig {
  return {
    agent: config.agent ?? DEFAULT_AGENT,
    image: config.image ?? DEFAULT_IMAGE,
    mounts: config.mounts ?? [],
    credentials: config.credentials ?? [],
    setup: config.setup,
    git: { ...DEFAULT_GIT, ...config.git },
    safety: config.safety ?? { enabled: false },
    audit: config.audit ?? { enabled: false },
    resources: { ...DEFAULT_RESOURCES, ...config.resources },
    services: config.services,
    network: config.network,
  };
}
