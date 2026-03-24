import AjvModule from "ajv";
// Ajv CJS/ESM interop: the default export is a namespace, constructor is on .default
const Ajv = AjvModule.default;

export interface CredentialConfig {
  name: string;
  check?: string;
  help?: string;
  required?: boolean;
}

export interface GitConfig {
  push: boolean;
  create_pr: boolean;
  merge: boolean;
  force_push: "block" | "ask" | "allow";
  delete_branch: "block" | "ask" | "allow";
  local_destructive: "block" | "ask" | "allow";
}

export interface SafetyConfig {
  enabled: boolean;
  preset?: "supervised" | "autonomous" | "minimal";
  overrides?: Record<string, string>;
  sensitive_paths?: {
    block?: string[];
    ask?: string[];
  };
}

export interface AuditConfig {
  enabled: boolean;
  export_path?: string;
  sign?: boolean;
  tsa?: boolean;
}

export interface ResourceConfig {
  memory: string;
  cpus: number;
  timeout: string;
  idle_timeout: string;
}

export interface SetupConfig {
  init?: string[];
  update?: string[];
}

export interface ServiceConfig {
  image: string;
  environment?: Record<string, string>;
  ports?: string[];
}

export interface NetworkConfig {
  allow: string[];
}

export interface CrabcageConfig {
  agent: string;
  image: string;
  mounts: string[];
  credentials: CredentialConfig[];
  setup?: SetupConfig;
  git: GitConfig;
  safety: SafetyConfig;
  audit: AuditConfig;
  resources: ResourceConfig;
  services?: Record<string, ServiceConfig>;
  network?: NetworkConfig;
}

const configJsonSchema = {
  type: "object",
  properties: {
    agent: { type: "string", enum: ["claude", "codex", "gemini"] },
    image: { type: "string" },
    mounts: { type: "array", items: { type: "string" } },
    credentials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          check: { type: "string" },
          help: { type: "string" },
          required: { type: "boolean" },
        },
        required: ["name"],
      },
    },
    setup: {
      type: "object",
      properties: {
        init: { type: "array", items: { type: "string" } },
        update: { type: "array", items: { type: "string" } },
      },
    },
    git: {
      type: "object",
      properties: {
        push: { type: "boolean" },
        create_pr: { type: "boolean" },
        merge: { type: "boolean" },
        force_push: { type: "string", enum: ["block", "ask", "allow"] },
        delete_branch: { type: "string", enum: ["block", "ask", "allow"] },
        local_destructive: { type: "string", enum: ["block", "ask", "allow"] },
      },
    },
    safety: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        preset: { type: "string", enum: ["supervised", "autonomous", "minimal"] },
        overrides: { type: "object", additionalProperties: { type: "string" } },
        sensitive_paths: {
          type: "object",
          properties: {
            block: { type: "array", items: { type: "string" } },
            ask: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    audit: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        export_path: { type: "string" },
        sign: { type: "boolean" },
        tsa: { type: "boolean" },
      },
    },
    resources: {
      type: "object",
      properties: {
        memory: { type: "string" },
        cpus: { type: "number" },
        timeout: { type: "string" },
        idle_timeout: { type: "string" },
      },
    },
    services: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          image: { type: "string" },
          environment: { type: "object", additionalProperties: { type: "string" } },
          ports: { type: "array", items: { type: "string" } },
        },
        required: ["image"],
      },
    },
    network: {
      type: "object",
      properties: {
        allow: { type: "array", items: { type: "string" } },
      },
    },
  },
  additionalProperties: false,
};

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(configJsonSchema);

export function validateConfig(data: unknown): ValidationResult {
  const valid = validate(data);
  if (valid) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: validate.errors?.map((e: { instancePath?: string; message?: string }) => `${e.instancePath || "/"}: ${e.message}`) ?? [],
  };
}
