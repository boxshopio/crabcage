import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ResolvedMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export function resolveMount(raw: string, cwd?: string): ResolvedMount {
  const parts = raw.split(":");
  let hostPart: string;
  let containerPart: string | undefined;
  let readOnly = false;

  if (parts.length === 3) {
    // /host/path:/container/path:ro
    hostPart = parts[0];
    containerPart = parts[1];
    readOnly = parts[2] === "ro";
  } else if (parts.length === 2) {
    if (parts[1] === "ro" || parts[1] === "rw") {
      // ~/path:ro
      hostPart = parts[0];
      readOnly = parts[1] === "ro";
    } else {
      // /host:/container
      hostPart = parts[0];
      containerPart = parts[1];
    }
  } else {
    hostPart = parts[0];
  }

  // Expand host path
  const expandedHost = expandHostPath(hostPart, cwd);

  // Derive container path if not explicit
  if (!containerPart) {
    containerPart = deriveContainerPath(hostPart, cwd);
  }

  return { hostPath: expandedHost, containerPath: containerPart, readOnly };
}

function expandHostPath(p: string, cwd?: string): string {
  if (p === ".") return cwd ?? process.cwd();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

function deriveContainerPath(p: string, _cwd?: string): string {
  if (p === ".") return "/home/claude/work";
  if (p.startsWith("~/")) {
    const relFromHome = p.slice(2);
    return `/home/claude/${relFromHome}`;
  }
  // Absolute paths outside home — mount under /mnt
  return `/mnt${p}`;
}
