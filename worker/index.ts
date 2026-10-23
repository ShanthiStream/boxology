import { HttpError, type Env, type LlmOverrides, type ProviderId, type StoredConfig } from './env';
import { complete, listModels, probe, resolveConfig } from './llm';
import { SYSTEM_PROMPT } from './prompt';
import { sanitize, slugify } from './xml';
import { encodeDiagram, editorUrl, toDrawioFile, viewerUrl } from './drawio';

const MAX_PROMPT_CHARS = 4000;

/**
 * Best-effort per-isolate limiter. Cloudflare may run many isolates and recycle
 * them freely, so this is a speed bump, not a quota. Put a real rate-limit rule
 * in front of the route (WAF) before this endpoint is public. Locally it just
 * stops a runaway loop from burning tokens.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit = 12, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

function cors(env: Env): Record<string, string> {
  return env.ALLOWED_ORIGIN
    ? {
        'access-control-allow-origin': env.ALLOWED_ORIGIN,
        'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
        'access-control-allow-headers': 'content-type',
      }
    : {};
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

/** The config in effect, from the file when there is one, else from bindings. */
async function loadConfig(env: Env): Promise<StoredConfig> {
  const provider: ProviderId =
    env.LLM_PROVIDER === 'anthropic'
      ? 'anthropic'
      : env.LLM_PROVIDER === 'claude-cli'
        ? 'claude-cli'
        : 'openai';

  // Mirror resolveConfig exactly: an Anthropic key must not be reported as
  // satisfying an OpenAI config, or the UI claims a key exists and the first
  // request fails anyway. A CLI provider needs no key at all.
  const envKey =
    env.LLM_API_KEY ??
    (provider === 'anthropic'
      ? env.ANTHROPIC_API_KEY
      : provider === 'openai'
        ? env.OPENAI_API_KEY
        : undefined);

  if (env.CONFIG_STORE) {
    const stored = await env.CONFIG_STORE.read();
    // The file wins, but an exported key still fills a blank so terminal-based
    // workflows keep working after someone saves settings in the UI.
    if (stored) return { ...stored, apiKey: stored.apiKey ?? envKey };
  }

  return {
    version: 1,
    provider,
    baseUrl: env.LLM_BASE_URL ?? env.OPENAI_BASE_URL,
    apiKey: envKey,
    model: env.LLM_MODEL,
  };
}

/** Report a stored config as per-request overrides, so validation sees exactly
 * what the file holds rather than whatever the process environment started with. */
function draftOf(config: StoredConfig): LlmOverrides {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl || undefined,
    apiKey: config.apiKey || undefined,
    model: config.model || undefined,
  };
}

async function publicConfig(config: StoredConfig, env: Env) {
  let configured = true;
  try {
    resolveConfig(env, draftOf(config));
  } catch {
    configured = false;
  }

  const engines = env.ENGINE_RUNNER ? await env.ENGINE_RUNNER.list() : [];

  // A CLI exists as a provider even when it cannot answer, so "configured"
  // additionally requires installed-and-signed-in. Otherwise the app claims to
  // be ready and the first prompt fails.
  if (configured && config.provider === 'claude-cli') {
    const engine = engines.find((entry) => entry.id === config.provider);
    configured = Boolean(engine?.installed && engine.signedIn === true);
  }

  return {
    provider: config.provider,
    baseUrl: config.baseUrl ?? '',
    model: config.model ?? '',
    hasApiKey: Boolean(config.apiKey),
    configured,
    canWrite: Boolean(env.CONFIG_STORE),
    configPath: env.CONFIG_STORE?.path ?? null,
    engines,
  };
}

/** Draft values from the settings UI; a blank key means "keep the saved one". */
async function overridesFrom(env: Env, body: Record<string, unknown>): Promise<LlmOverrides> {
  const stored = await loadConfig(env);
  const stringOr = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

  const provider = stringOr(body.provider) ?? stored.provider;
  // Endpoint, key and model are provider-scoped: retyping them is exactly what
  // switching provider means, so nothing carries over when the two differ.
  const sameProvider = provider === stored.provider;

  return {
    provider,
    baseUrl: stringOr(body.baseUrl) ?? (sameProvider ? stored.baseUrl : undefined),
    // Falling back to the saved key lets users test a model without retyping it.
    apiKey: stringOr(body.apiKey) ?? (sameProvider ? stored.apiKey : undefined),
    model: stringOr(body.model) ?? (sameProvider ? stored.model : undefined),
  };
}

function readBody(body: Record<string, unknown>, env: Env): StoredConfig {
  const provider: ProviderId =
    body.provider === 'anthropic'
      ? 'anthropic'
      : body.provider === 'claude-cli'
        ? 'claude-cli'
        : 'openai';

  if (provider === 'claude-cli' && !env.ENGINE_RUNNER) {
    throw new HttpError(400, 'Local CLI engines are only available when Boxology runs on your machine.');
  }

  let baseUrl: string | undefined;
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim() !== '') {
    baseUrl = body.baseUrl.trim().replace(/\/$/, '');
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new HttpError(400, 'Base URL must be a valid http(s) address.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new HttpError(400, 'Base URL must start with http:// or https://.');
    }
  }

  return {
    version: 1,
    provider,
    // A CLI owns its endpoint and credentials; storing either would be a lie.
    baseUrl: provider === 'claude-cli' ? undefined : baseUrl,
    apiKey:
      provider === 'claude-cli'
        ? undefined
        : typeof body.apiKey === 'string' && body.apiKey.trim() !== ''
          ? body.apiKey.trim()
          : undefined,
    model: typeof body.model === 'string' && body.model.trim() !== '' ? body.model.trim() : undefined,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      if (url.pathname === '/api/health') {
        const config = await loadConfig(env);
        try {
          const cfg = resolveConfig(env);
          return json(
            { ok: true, provider: cfg.provider, model: cfg.model, baseUrlSet: Boolean(config.baseUrl) },
            200,
            headers,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unconfigured';
          return json({ ok: false, error: message }, 200, headers);
        }
      }

      if (url.pathname === '/api/config') {
        if (request.method === 'PUT') {
          if (!env.CONFIG_STORE) {
            throw new HttpError(405, 'Config is read-only on this deployment. Set bindings instead.');
          }
          const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
          if (!body) throw new HttpError(400, 'Expected a JSON body.');

          const incoming = readBody(body, env);
          // A blank key field means "leave what is saved alone" — but only for
          // the same provider. Carrying an OpenAI key into a CLI provider would
          // keep a dead secret on disk and still report `hasApiKey`.
          const current = await loadConfig(env);
          const merged: StoredConfig = incoming.apiKey
            ? incoming
            : {
                ...incoming,
                apiKey: current.provider === incoming.provider ? current.apiKey : undefined,
              };

          await env.CONFIG_STORE.write(merged);
          return json(await publicConfig(merged, env), 200, headers);
        }

        return json(await publicConfig(await loadConfig(env), env), 200, headers);
      }

      if (url.pathname === '/api/models' || url.pathname === '/api/test') {
        if (request.method !== 'POST') {
          throw new HttpError(405, 'Use POST.');
        }
        const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
        const overrides = await overridesFrom(env, body);

        if (url.pathname === '/api/models') {
          const models = await listModels(env, overrides);
          return json({ models }, 200, headers);
        }

        const result = await probe(env, overrides);
        return json(result, 200, headers);
      }

      if (url.pathname === '/api/generate') {
        if (request.method !== 'POST') {
          throw new HttpError(405, 'Use POST.');
        }

        const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
        if (!rateLimit(ip)) {
          throw new HttpError(429, 'Too many requests. Wait a minute and try again.');
        }

        const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';

        if (prompt.length < 3) {
          throw new HttpError(400, 'Describe the diagram you want first.');
        }
        if (prompt.length > MAX_PROMPT_CHARS) {
          throw new HttpError(413, `Prompt is too long (max ${MAX_PROMPT_CHARS} characters).`);
        }

        const started = Date.now();
        const { text, model } = await complete(env, SYSTEM_PROMPT, prompt);
        const { xml, prunedEdges, repairedMarkup } = sanitize(text);

        const payload = await encodeDiagram(xml);
        const name = slugify(prompt);

        return json(
          {
            xml,
            payload,
            viewerUrl: viewerUrl(payload),
            editorUrl: editorUrl(payload),
            file: { name: `${name}.drawio`, content: toDrawioFile(xml) },
            meta: { model, ms: Date.now() - started, prunedEdges, repairedMarkup },
          },
          200,
          headers,
        );
      }

      return json({ error: 'Not found' }, 404, headers);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status, headers);
      }
      const message = error instanceof Error ? error.message : 'Unexpected error';
      console.error('request failed', url.pathname, message);
      return json({ error: `Request failed: ${message}` }, 500, headers);
    }
  },
};
