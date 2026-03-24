import { execa } from "execa";
import type { CredentialConfig } from "../config/schema.js";

export interface CredentialResult {
  name: string;
  valid: boolean;
  error?: string;
  warning?: string;
  help?: string;
}

export async function validateCredential(
  cred: CredentialConfig,
  env: Record<string, string | undefined>,
): Promise<CredentialResult> {
  const isRequired = cred.required !== false;
  const isSet = Boolean(env[cred.name]);

  if (!isSet) {
    if (!isRequired) {
      return { name: cred.name, valid: true, warning: `${cred.name} not set (optional)` };
    }
    return {
      name: cred.name,
      valid: false,
      error: `${cred.name} not set`,
      help: cred.help,
    };
  }

  if (cred.check) {
    try {
      const parts = cred.check.split(" ");
      await execa(parts[0], parts.slice(1), { timeout: 10_000 });
      return { name: cred.name, valid: true };
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") {
        return {
          name: cred.name,
          valid: true,
          warning: `Check command '${cred.check.split(" ")[0]}' not found on host — credential unverified`,
        };
      }
      return {
        name: cred.name,
        valid: false,
        error: `${cred.name} check failed: ${cred.check}`,
        help: cred.help,
      };
    }
  }

  return { name: cred.name, valid: true };
}

export async function validateAllCredentials(
  credentials: CredentialConfig[],
  env: Record<string, string | undefined>,
): Promise<CredentialResult[]> {
  return Promise.all(credentials.map((c) => validateCredential(c, env)));
}
