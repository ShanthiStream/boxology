export interface GenerateResult {
  xml: string;
  payload: string;
  viewerUrl: string;
  editorUrl: string;
  file: { name: string; content: string };
  meta: { model: string; ms: number; prunedEdges: number; repairedMarkup?: number };
}

export type Phase = 'idle' | 'loading' | 'ready';

export type ProviderId = 'openai' | 'anthropic' | 'claude-cli';

/** A locally installed CLI the app can borrow as its model. */
export interface EngineStatus {
  id: string;
  label: string;
  installed: boolean;
  /** Null means "could not be determined", which is not the same as no. */
  signedIn: boolean | null;
  version: string | null;
  models: string[];
  reason: string | null;
}

/** Shape of `GET /api/config`. Never carries the key itself. */
export interface PublicConfig {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  configured: boolean;
  /** False on the Cloudflare deployment, where config comes from bindings. */
  canWrite: boolean;
  configPath: string | null;
  /** Empty when no local host is running, never null, so the UI can map freely. */
  engines: EngineStatus[];
}
