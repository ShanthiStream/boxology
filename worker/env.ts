/** Every way Boxology can reach a model. */
export type ProviderId = 'openai' | 'anthropic' | 'claude-cli';

/**
 * Provider config a user can edit from the app.
 *
 * This type is the contract between the settings UI, the config file on disk,
 * and the LLM adapter. It deliberately contains no platform-specific detail so
 * the same shape can come from a Worker binding or from `config.json`.
 */
export interface StoredConfig {
  version: 1;
  provider: ProviderId;
  /** Blank means "use the provider default". */
  baseUrl?: string;
  /** Omitted entirely for local models such as Ollama. */
  apiKey?: string;
  model?: string;
}

/**
 * Where user config lives. Injected by the local host; absent on Cloudflare,
 * where config comes from Worker bindings and is not writable at runtime.
 */
export interface ConfigStore {
  read(): Promise<StoredConfig | null>;
  write(config: StoredConfig): Promise<void>;
  /** Absolute path, surfaced in the UI so users know where their key sits. */
  readonly path: string;
}

/** Per-request overrides, used to test settings before saving them. */
export interface LlmOverrides {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/**
 * A locally installed CLI that can stand in for a hosted model.
 *
 * Nothing here is a secret: the CLI keeps its own credentials, and the app only
 * learns whether it is installed, which version, and whether it is signed in.
 */
export interface EngineStatus {
  /** Also the provider id, e.g. "claude-cli". */
  id: string;
  label: string;
  installed: boolean;
  /** Null when sign-in could not be determined, which is not the same as no. */
  signedIn: boolean | null;
  version: string | null;
  /** Model names this engine accepts, for a picker. */
  models: string[];
  /** One line explaining why the engine cannot be used, else null. */
  reason: string | null;
}

export interface EngineRequest {
  engine: string;
  model?: string;
  system: string;
  prompt: string;
  timeoutMs: number;
}

/**
 * Runs local CLIs. Implemented in `server/engines.ts` and injected through
 * `Env`, because `worker/` is also bundled for Cloudflare where `node:child_process`
 * does not exist. Absent there, which is what makes the provider unavailable.
 */
export interface EngineRunner {
  list(): Promise<EngineStatus[]>;
  run(request: EngineRequest): Promise<{ text: string; model: string }>;
}

/** Bindings available to the Worker. Secrets never reach the client. */
export interface Env {
  /** "openai" (any OpenAI-compatible endpoint) | "anthropic" */
  LLM_PROVIDER?: string;
  /** Override the endpoint, e.g. http://localhost:11434/v1 for Ollama. */
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;

  // Convenience aliases so a fresh account works without renaming keys.
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;

  MAX_OUTPUT_TOKENS?: string;

  /** Cloudflare-only: restrict CORS to one origin. Unset locally on purpose. */
  ALLOWED_ORIGIN?: string;

  /** Present only on the local host. Its absence makes config read-only. */
  CONFIG_STORE?: ConfigStore;

  /** Present only on the local host. Its absence hides local CLI engines. */
  ENGINE_RUNNER?: EngineRunner;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
