/**
 * Provider-agnostic LLM adapter.
 *
 * One OpenAI-compatible path covers OpenAI, OpenRouter, Groq, Together,
 * DeepSeek, LM Studio and Ollama (`/v1/chat/completions`). Anthropic gets its
 * own branch because its message shape differs. Provider choice is config-only,
 * so swapping models never touches application code.
 */
import { HttpError, type Env, type LlmOverrides, type ProviderId } from './env';

export interface Resolved {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  /** True when the model runs on this machine, so a key is optional. */
  isLocal: boolean;
}

const DEFAULTS: Record<'openai' | 'anthropic', { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
};

function looksLocal(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0';
  } catch {
    return false;
  }
}

export function resolveConfig(env: Env, overrides: LlmOverrides = {}): Resolved {
  const provider = (overrides.provider ?? env.LLM_PROVIDER ?? 'openai').toLowerCase() as ProviderId;

  if (provider === 'claude-cli') {
    // No key, no endpoint: the CLI owns both. The runner only exists on the
    // local host, so a cloud deployment cannot quietly fall into this branch.
    if (!env.ENGINE_RUNNER) {
      throw new HttpError(
        400,
        'Local CLI engines only work when Boxology runs on your machine (bun run dev:local).',
      );
    }
    return {
      provider,
      baseUrl: '',
      apiKey: '',
      // A model name belongs to one provider. Falling back to LLM_MODEL here
      // would hand an Ollama tag such as `gemma4:cloud` to the CLI as `--model`
      // as soon as someone tested Claude Code before saving it.
      model: (overrides.model ?? (env.LLM_PROVIDER === 'claude-cli' ? env.LLM_MODEL : undefined) ?? '').trim(),
      maxTokens: Number(env.MAX_OUTPUT_TOKENS ?? 8000),
      isLocal: true,
    };
  }

  if (provider !== 'openai' && provider !== 'anthropic') {
    throw new HttpError(400, `Unknown provider "${provider}". Use "openai", "anthropic" or "claude-cli".`);
  }

  const fallback = DEFAULTS[provider];
  const baseUrl = (
    overrides.baseUrl ??
    env.LLM_BASE_URL ??
    env.OPENAI_BASE_URL ??
    fallback.baseUrl
  ).replace(/\/$/, '');

  const apiKey =
    overrides.apiKey ??
    env.LLM_API_KEY ??
    (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY) ??
    '';

  const isLocal = looksLocal(baseUrl);
  if (!apiKey && !isLocal) {
    throw new HttpError(
      400,
      'No API key configured. Open Settings and add one, move to a local model, or use a signed-in CLI.',
    );
  }

  return {
    provider,
    baseUrl,
    apiKey,
    model: overrides.model ?? env.LLM_MODEL ?? fallback.model,
    maxTokens: Number(env.MAX_OUTPUT_TOKENS ?? 8000),
    isLocal,
  };
}

/** Turn provider failures into something a user can act on. */
export function describeHttpError(status: number, body: string): string {
  const detail = body.replace(/\s+/g, ' ').slice(0, 200);
  switch (true) {
    case status === 401 || status === 403:
      return 'The provider rejected the credentials (401). Check the API key.';
    case status === 404:
      return 'No endpoint there (404). Check the base URL — it usually ends in /v1.';
    case status === 429:
      return 'Rate limited or out of quota (429). Wait or switch models.';
    case status >= 500:
      return `The provider had a server error (${status}). Try again shortly.`;
    default:
      return `The provider returned ${status}: ${detail}`;
  }
}

function describeNetworkError(error: unknown, baseUrl: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|fetch failed|connection refused|failed to fetch/i.test(message)) {
    return `Nothing is listening at ${baseUrl}. If this is a local model, start it first (for Ollama: \`ollama serve\`).`;
  }
  if (/abort|timeout|timed out/i.test(message)) {
    return `${baseUrl} did not respond in time.`;
  }
  return message;
}

async function request(cfg: Resolved, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${cfg.baseUrl}${path}`, init);
  } catch (error) {
    throw new HttpError(502, describeNetworkError(error, cfg.baseUrl));
  }
}

function headers(cfg: Resolved): Record<string, string> {
  return cfg.provider === 'anthropic'
    ? {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      }
    : {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      };
}

export interface Completion {
  text: string;
  model: string;
}

export async function complete(env: Env, system: string, user: string): Promise<Completion> {
  const cfg = resolveConfig(env);

  if (cfg.provider === 'claude-cli') {
    return env.ENGINE_RUNNER!.run({
      engine: cfg.provider,
      model: cfg.model || undefined,
      system,
      prompt: user,
      // A local CLI may wait on a cold model before it writes anything.
      timeoutMs: 180_000,
    });
  }

  const response =
    cfg.provider === 'anthropic'
      ? await request(cfg, '/v1/messages', {
          method: 'POST',
          headers: headers(cfg),
          body: JSON.stringify({
            model: cfg.model,
            system,
            max_tokens: cfg.maxTokens,
            temperature: 0.2,
            messages: [{ role: 'user', content: user }],
          }),
          signal: AbortSignal.timeout(90_000),
        })
      : await request(cfg, '/chat/completions', {
          method: 'POST',
          headers: headers(cfg),
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: 0.2,
            max_tokens: cfg.maxTokens,
            stream: false,
          }),
          signal: AbortSignal.timeout(90_000),
        });

  if (!response.ok) {
    throw new HttpError(502, describeHttpError(response.status, await response.text()));
  }

  const data = (await response.json()) as any;
  const text: string =
    cfg.provider === 'anthropic'
      ? (data?.content?.[0]?.text ?? '')
      : (data?.choices?.[0]?.message?.content ?? '');

  if (!text.trim()) {
    throw new HttpError(502, 'The model returned an empty response. Try a different model.');
  }
  return { text, model: cfg.model };
}

/** List selectable models, so users pick from a dropdown instead of typing. */
export async function listModels(env: Env, overrides: LlmOverrides = {}): Promise<string[]> {
  const cfg = resolveConfig(env, overrides);

  // A CLI has no model endpoint; the engine reports the names it accepts.
  if (cfg.provider === 'claude-cli') {
    const engines = await env.ENGINE_RUNNER!.list();
    const engine = engines.find((entry) => entry.id === cfg.provider);
    if (!engine?.installed) {
      throw new HttpError(400, engine?.reason ?? 'That local engine is not installed.');
    }
    return engine.models;
  }

  if (cfg.provider === 'anthropic') {
    const response = await request(cfg, '/v1/models?limit=50', {
      headers: headers(cfg),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new HttpError(502, describeHttpError(response.status, await response.text()));
    }
    const data = (await response.json()) as any;
    return (data?.data ?? []).map((m: any) => String(m?.id)).filter(Boolean);
  }

  const response = await request(cfg, '/models', {
    headers: headers(cfg),
    signal: AbortSignal.timeout(20_000),
  });

  if (response.ok) {
    const data = (await response.json()) as any;
    const ids = (data?.data ?? data?.models ?? [])
      .map((m: any) => String(m?.id ?? m?.name ?? ''))
      .filter(Boolean);
    if (ids.length > 0) return ids;
  } else if (!cfg.isLocal) {
    throw new HttpError(502, describeHttpError(response.status, await response.text()));
  }

  // Older Ollama builds expose the native tag list but not /v1/models.
  const origin = new URL(cfg.baseUrl).origin;

  try {
    const tags = await fetch(`${origin}/api/tags`, { signal: AbortSignal.timeout(20_000) });
    if (tags.ok) {
      const data = (await tags.json()) as any;
      return (data?.models ?? []).map((m: any) => String(m?.name)).filter(Boolean);
    }
  } catch {
    // fall through to the shared error below
  }

  throw new HttpError(
    502,
    `Could not list models at ${cfg.baseUrl}. Type a model name instead.`,
  );
}

/** One-token round trip, used by the "Test connection" button. */
export async function probe(
  env: Env,
  overrides: LlmOverrides = {},
): Promise<{ model: string; ms: number; reply: string }> {
  const cfg = resolveConfig(env, overrides);
  const started = Date.now();

  // "Test connection" has to prove the whole path, so it runs a real one-word
  // completion through the CLI rather than reporting that the binary exists.
  // A probe that only checks `--version` says "ready" right up until the first
  // request fails upstream.
  if (cfg.provider === 'claude-cli') {
    const result = await env.ENGINE_RUNNER!.run({
      engine: cfg.provider,
      model: cfg.model || undefined,
      system: '',
      prompt: 'Reply with the single word: ready',
      timeoutMs: 60_000,
    });
    return { model: result.model, ms: Date.now() - started, reply: result.text.trim().slice(0, 40) };
  }

  const response =
    cfg.provider === 'anthropic'
      ? await request(cfg, '/v1/messages', {
          method: 'POST',
          headers: headers(cfg),
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          }),
          signal: AbortSignal.timeout(30_000),
        })
      : await request(cfg, '/chat/completions', {
          method: 'POST',
          headers: headers(cfg),
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          }),
          signal: AbortSignal.timeout(30_000),
        });

  if (!response.ok) {
    throw new HttpError(502, describeHttpError(response.status, await response.text()));
  }

  const data = (await response.json()) as any;
  const reply: string =
    cfg.provider === 'anthropic'
      ? (data?.content?.[0]?.text ?? '')
      : (data?.choices?.[0]?.message?.content ?? '');

  return { model: cfg.model, ms: Date.now() - started, reply: reply.trim().slice(0, 40) };
}
