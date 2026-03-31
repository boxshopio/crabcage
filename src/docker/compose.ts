import type { CrabcageConfig } from "../config/schema.js";
import type { ResolvedMount } from "../mounts/resolver.js";
import type { AuthMode } from "../credentials/detect-auth.js";

export interface ComposeSpec {
  services: Record<string, Record<string, unknown>>;
  networks?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
}

export function generateCompose(
  config: CrabcageConfig,
  mounts: ResolvedMount[],
  auth: AuthMode,
  env: Record<string, string | undefined>,
): ComposeSpec {
  const volumes: string[] = [];
  const environment: string[] = [];

  // Add user mounts
  for (const mount of mounts) {
    const suffix = mount.readOnly ? "ro" : "rw";
    volumes.push(`${mount.hostPath}:${mount.containerPath}:${suffix}`);
  }

  // Named volumes for persistent state
  volumes.push("crabcage-config:/home/claude/.claude");
  volumes.push("crabcage-audit:/var/audit");

  // tmpfs for scratch and user-site packages
  const tmpfs = ["/tmp", "/var/tmp", "/home/claude/.local"];

  // Auth — inject API key if available; OAuth users authenticate inside the container
  if (auth.mode === "api_key" && env.ANTHROPIC_API_KEY) {
    environment.push(`ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY}`);
  }

  // Inject other credentials as env vars
  for (const cred of config.credentials) {
    const value = env[cred.name];
    if (value) {
      environment.push(`${cred.name}=${value}`);
    }
  }

  // Build sandbox service
  const sandbox: Record<string, unknown> = {
    image: config.image,
    stdin_open: true,
    tty: true,
    cap_drop: ["ALL"],
    read_only: true,
    security_opt: ["no-new-privileges"],
    pids_limit: 256,
    volumes,
    tmpfs,
    environment,
    working_dir: "/home/claude/work",
  };

  // Resource limits
  if (config.resources.memory !== "0") {
    sandbox.mem_limit = config.resources.memory;
  }
  if (config.resources.cpus > 0) {
    sandbox.cpus = config.resources.cpus;
  }

  // Build compose spec
  const services: Record<string, Record<string, unknown>> = { sandbox };

  // Add sidecar services
  if (config.services) {
    for (const [name, svc] of Object.entries(config.services)) {
      services[name] = {
        image: svc.image,
        environment: svc.environment
          ? Object.entries(svc.environment).map(([k, v]) => `${k}=${v}`)
          : undefined,
        ports: svc.ports,
      };
    }
  }

  // Assign all services to the crabcage network
  for (const svc of Object.values(services)) {
    svc.networks = ["crabcage-net"];
  }

  return {
    services,
    networks: {
      "crabcage-net": { driver: "bridge" },
    },
    volumes: {
      "crabcage-config": {},
      "crabcage-audit": {},
    },
  };
}
