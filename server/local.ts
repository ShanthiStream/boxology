/**
 * Local host for Boxology.
 *
 * `worker/index.ts` is a plain `(request, env) => Response` handler, so running
 * it locally needs no forking of the core: this file only supplies a config
 * store, a guard, and static files.
 *
 * Binds to loopback only. Putting this on 0.0.0.0 would expose the user's API
 * key to their network.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import handler from '../worker/index';
import { guardLocalRequest } from '../worker/guard';
import type { ConfigStore, Env } from '../worker/env';
import { defaultConfigPath, fileConfigStore } from './config';
import { engineRunner } from './engines';
import pkg from '../package.json';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC_ROOT = process.env.BOXOLOGY_STATIC ?? join(HERE, '..', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Rebuilt per request so a change saved in Settings takes effect immediately,
 * without a restart. The file read is trivial at this scale.
 */
async function buildEnv(store: ConfigStore): Promise<Env> {
  const stored = await store.read();
  return {
    ...process.env,
    LLM_PROVIDER: stored?.provider ?? process.env.LLM_PROVIDER,
    LLM_BASE_URL: stored?.baseUrl ?? process.env.LLM_BASE_URL,
    LLM_API_KEY: stored?.apiKey ?? process.env.LLM_API_KEY,
    LLM_MODEL: stored?.model ?? process.env.LLM_MODEL,
    CONFIG_STORE: store,
    // Local only. Its presence is what makes the claude-cli provider selectable.
    ENGINE_RUNNER: engineRunner,
  };
}

function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined));
    request.on('error', reject);
  });
}

async function serveStatic(pathname: string): Promise<Response | null> {
  // Block traversal before touching the filesystem.
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const candidate = join(STATIC_ROOT, relative);

  if (!candidate.startsWith(STATIC_ROOT)) return null;

  const attempt = async (path: string): Promise<Response | null> => {
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      const body = await readFile(path);
      return new Response(new Uint8Array(body), {
        headers: {
          'content-type': MIME[extname(path)] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return null;
    }
  };

  const direct = await attempt(candidate);
  if (direct) return direct;

  // SPA fallback: unknown non-asset paths render the app shell.
  if (!extname(pathname)) {
    return attempt(join(STATIC_ROOT, 'index.html'));
  }
  return null;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  store: ConfigStore,
): Promise<void> {
  const host = request.headers.host ?? '127.0.0.1';
  const url = new URL(request.url ?? '/', `http://${host}`);
  const body = await readBody(request);

  const webRequest = new Request(url, {
    method: request.method,
    headers: request.headers as HeadersInit,
    // Buffer is a Uint8Array, but @types/node's generic bufers don't line up
    // with undici's BodyInit union.
    body: body as unknown as BodyInit | undefined,
  });

  let webResponse: Response;

  const denied = guardLocalRequest(webRequest);
  if (denied) {
    webResponse = denied;
  } else if (url.pathname.startsWith('/api/')) {
    webResponse = await handler.fetch(webRequest, await buildEnv(store));
  } else {
    webResponse = (await serveStatic(url.pathname)) ??
      new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }

  const headers: Record<string, string> = {};
  webResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  response.writeHead(webResponse.status, headers);
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    // Opening a browser is a convenience; never fatal.
  }
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  for (let candidate = port; candidate < port + 10; candidate += 1) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(candidate, '127.0.0.1');
    });
    if (!free) continue;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(candidate, '127.0.0.1', () => resolve());
    });
    return candidate;
  }
  throw new Error(`No free port between ${port} and ${port + 9}.`);
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };

  const usage = (): string =>
    [
      '',
      '  Boxology — describe it, get an editable draw.io diagram.',
      '',
      '  Usage: boxology [options]',
      '',
      '    --port <number>   Port on 127.0.0.1 (default 8787, or $PORT)',
      `    --config <path>   Config file (default ${defaultConfigPath()})`,
      '    --no-open         Do not open a browser',
      '    -v, --version     Print the version',
      '    -h, --help        Show this help',
      '',
      '  Everything runs on this machine. Diagrams stay in the browser and the',
      '  API key stays in the config file.',
      '',
    ].join('\n');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(pkg.version);
    return;
  }

  const known = new Set(['--port', '--config', '--no-open']);
  const unknown = args.find((arg) => arg.startsWith('-') && !known.has(arg));
  if (unknown) {
    console.error(`\n  Unknown option: ${unknown}\n${usage()}`);
    process.exit(1);
  }

  const requestedPort = Number(flag('--port') ?? process.env.PORT ?? 8787);
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
    console.error(`\n  Invalid port: ${flag('--port') ?? process.env.PORT}\n`);
    process.exit(1);
  }

  const store = fileConfigStore(flag('--config') ?? defaultConfigPath());

  try {
    await stat(join(STATIC_ROOT, 'index.html'));
  } catch {
    console.error(
      `\n  The UI is not built.\n` +
        `  From a checkout run \`bun run build\`; from npm, reinstall the package.\n` +
        `  (looked in ${STATIC_ROOT})\n`,
    );
    process.exit(1);
  }

  const server = createServer((request, response) => {
    handle(request, response, store).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('request failed:', message);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ error: message }));
    });
  });

  const port = await listen(server, requestedPort);
  const url = `http://127.0.0.1:${port}`;

  console.log(`\n  Boxology is running at ${url}`);
  console.log(`  Config: ${store.path}`);
  console.log(`  Stop with Ctrl+C\n`);

  if (!args.includes('--no-open')) openBrowser(url);
}

// Run when executed directly, but stay importable so `main` can be called from
// a wrapper (the future `boxology` bin) without starting a second server.
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
