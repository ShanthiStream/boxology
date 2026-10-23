/**
 * Local CLI engines, modelled on open-duet's engine layer.
 *
 * Boxology ships no model. If this machine already has a signed-in `claude`
 * CLI, that CLI *is* the model: the same login and quota the user already pays
 * for, with no key to paste and nothing extra to install. Three rules make that
 * safe and predictable.
 *
 *  - Detection is cheap and never fails a request. Probes are bounded, cached
 *    for 15s, and a probe that hangs means "unknown", not "broken".
 *  - The run is chat-only. A diagram generator has no business reading files or
 *    running commands, so every tool surface is switched off. A CLI that does
 *    not understand a flag refuses to start, which is the safe failure.
 *  - The prompt goes in on stdin, never on argv. Argv is world-readable through
 *    `ps` and lands in shell history; stdin does neither.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { HttpError, type EngineRequest, type EngineRunner, type EngineStatus } from '../worker/env';

/* ------------------------------------------------------------------ *
 * Finding the CLI
 * ------------------------------------------------------------------ */

/**
 * Folders a GUI-launched app does not inherit but a shell does.
 *
 * A service manager or a double-clicked .app starts with a minimal PATH, so a
 * CLI installed under the user's home is invisible even though it works in a
 * terminal. These are appended, never prepended: whatever the user already has
 * on PATH keeps priority, and only directories that exist are added.
 */
const USER_DIRS = ['.local/bin', '.npm-global/bin', '.claude/local'];
const SYSTEM_DIRS = ['/usr/local/bin', '/opt/homebrew/bin'];
const EXTRA_SETTING = 'BOXOLOGY_EXTRA_PATH';

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function searchPath(): string {
  const home = homedir();
  const current = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const seen = new Set(current);

  const extra = (process.env[EXTRA_SETTING] ?? '').split(delimiter).filter(Boolean);
  const candidates = [...USER_DIRS.map((dir) => join(home, dir)), ...SYSTEM_DIRS, ...extra];

  const additions: string[] = [];
  for (const dir of candidates) {
    if (!dir || seen.has(dir) || !isDirectory(dir)) continue;
    seen.add(dir);
    additions.push(dir);
  }

  return [...current, ...additions].join(delimiter);
}

/** Absolute path of an executable, or null. Re-checked on every probe so an
 * install done while the server runs is picked up without a restart. */
function findExecutable(name: string): string | null {
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of searchPath().split(delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, `${name}${suffix}`);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Running the CLI
 * ------------------------------------------------------------------ */

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_OUTPUT_BYTES = 4_000_000;

/**
 * Run a program once and come back no matter what.
 *
 * `execFile` has no timeout, and a child killed by signal can leave its own
 * children running. The CLI is started in its own process group so a timeout
 * can take the whole tree down, and a second timer guarantees we resolve even
 * if the group refuses to die.
 */
function execBounded(
  executable: string,
  args: string[],
  options: { input: string | null; timeoutMs: number; cwd: string },
): Promise<ProcessResult> {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, PATH: searchPath() },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group on POSIX so the timeout can kill grandchildren too.
      detached: process.platform !== 'win32',
    });

    let killTimer: NodeJS.Timeout | undefined;

    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolvePromise({ code, signal, stdout, stderr, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // Already gone; `close` will arrive on its own.
      }
      killTimer = setTimeout(() => finish(null, 'SIGKILL'), 2_000);
    }, options.timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk;
    });

    // The CLI may exit before reading a large prompt; that is reported through
    // the exit code, not as an unhandled EPIPE.
    child.stdin?.on('error', () => undefined);

    child.on('error', (error: Error) => {
      stderr += `\n${error.message}`;
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));

    child.stdin?.end(options.input ?? '');
  });
}

/* ------------------------------------------------------------------ *
 * Claude Code
 * ------------------------------------------------------------------ */

const CLAUDE = {
  id: 'claude-cli',
  label: 'Claude Code',
  binary: 'claude',
  docs: 'https://code.claude.com/docs/en/setup',
} as const;

/**
 * Verified against Claude Code 2.1.x: with these flags the run has no tools, no
 * MCP servers, no slash commands, and no way to ask for permission — it can
 * only write text. The prompt asks for XML, so that is all we want.
 */
const LOCKDOWN_ARGS = [
  '--tools',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--permission-mode',
  'dontAsk',
];

const STATUS_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 15_000;

const statusCache = new Map<string, { at: number; value: EngineStatus }>();

function claudeModels(): string[] {
  // Aliases the CLI resolves to whatever the account can use; a full model id
  // typed by the user is passed through untouched.
  return ['sonnet', 'opus', 'haiku'];
}

function claudeStatusFrom(partial: Omit<EngineStatus, 'id' | 'label' | 'models'>): EngineStatus {
  return { id: CLAUDE.id, label: CLAUDE.label, models: claudeModels(), ...partial };
}

async function probeClaude(): Promise<EngineStatus> {
  const executable = findExecutable(CLAUDE.binary);
  if (!executable) {
    return claudeStatusFrom({
      installed: false,
      signedIn: null,
      version: null,
      reason: `Not installed. Get it at ${CLAUDE.docs}`,
    });
  }

  // Auth is account-wide, so it is checked outside any project folder: a broken
  // workspace must not make a perfectly valid login look signed out.
  const home = homedir();

  // Side by side: a CLI that hangs must cost one timeout, not two, because this
  // runs behind `GET /api/config` on page load.
  const [version, auth] = await Promise.all([
    execBounded(executable, ['--version'], {
      input: null,
      timeoutMs: STATUS_TIMEOUT_MS,
      cwd: home,
    }),
    execBounded(executable, ['auth', 'status', '--json'], {
      input: null,
      timeoutMs: STATUS_TIMEOUT_MS,
      cwd: home,
    }),
  ]);

  if (version.code !== 0) {
    return claudeStatusFrom({
      installed: true,
      signedIn: null,
      version: null,
      reason: version.timedOut
        ? 'Installed, but `claude --version` did not finish. Run it once in a terminal.'
        : 'Installed, but `claude --version` did not run. Run it once in a terminal.',
    });
  }

  const versionText =
    version.stdout.trim().split('\n')[0]?.replace(/\s*\(Claude Code\)\s*$/i, '').trim() || null;

  let signedIn: boolean | null = null;
  try {
    // Only `loggedIn` is read. The payload also carries the account's email and
    // organisation; none of that needs to travel to the browser.
    signedIn = (JSON.parse(auth.stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    signedIn = null;
  }

  if (signedIn === true) {
    return claudeStatusFrom({ installed: true, signedIn, version: versionText, reason: null });
  }

  return claudeStatusFrom({
    installed: true,
    signedIn,
    version: versionText,
    reason:
      signedIn === false
        ? 'Installed, but not signed in. Run `claude` in a terminal and use /login, or set ANTHROPIC_API_KEY.'
        : 'Installed, but its sign-in state could not be read. Run `claude auth status` in a terminal.',
  });
}

async function claudeStatus(): Promise<EngineStatus> {
  const cached = statusCache.get(CLAUDE.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const value = await probeClaude();
  statusCache.set(CLAUDE.id, { at: Date.now(), value });
  return value;
}

/**
 * Turn whatever the CLI printed on failure into one actionable sentence.
 *
 * The CLI reports provider trouble in several shapes — a clean `API Error: 401`,
 * a "Not logged in" notice, a JSON warning line, a bare timeout — and none of
 * them mean anything to someone who just wanted a diagram.
 */
function describeFailure(stdout: string, stderr: string, model?: string): string {
  const combined = `${stdout}\n${stderr}`.trim();
  const lines = combined
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const apiError = lines.find((line) => /API Error:/i.test(line));
  const detail = (apiError ?? lines[lines.length - 1] ?? '').slice(0, 300);

  if (/not logged in|please run \/login|authentication_error|invalid api key/i.test(combined)) {
    return 'Claude Code is not signed in. Run `claude` in a terminal and use /login, or set ANTHROPIC_API_KEY.';
  }
  if (/usage limit|rate_limit|\b429\b|out of (?:credits|quota)/i.test(combined)) {
    return 'Claude Code is rate-limited or out of quota. Wait a little, or switch model.';
  }
  if (/model is unavailable|unrecognized_model|invalid model|unknown model/i.test(combined)) {
    return model
      ? `Claude Code rejected the model "${model}". Pick another one, or leave Model blank to use its default. ${detail}`
      : `Claude Code's own default model was rejected by its provider. Set a model in Settings, or check your Claude Code config. ${detail}`;
  }
  if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(combined)) {
    return `Claude Code could not reach its provider. ${detail}`;
  }

  return detail
    ? `Claude Code failed: ${detail}`
    : 'Claude Code exited without returning an answer. Run it once in a terminal to check it.';
}

async function runClaude(request: EngineRequest): Promise<{ text: string; model: string }> {
  const executable = findExecutable(CLAUDE.binary);
  if (!executable) {
    throw new HttpError(400, `Claude Code is not installed. Get it at ${CLAUDE.docs}`);
  }

  const model = request.model?.trim();
  const args = ['-p', '--output-format', 'text', ...LOCKDOWN_ARGS];
  if (model) args.push('--model', model);
  // Appended, never replacing the CLI's own prompt: the CLI is an agent and
  // expects its own framing, and our instruction is the last one it reads.
  if (request.system.trim()) args.push('--append-system-prompt', request.system);

  const result = await execBounded(executable, args, {
    input: request.prompt,
    timeoutMs: request.timeoutMs,
    // A neutral folder: whatever the user's current project contains (a
    // CLAUDE.md, an MCP config) has no business shaping a diagram.
    cwd: tmpdir(),
  });

  if (result.timedOut) {
    throw new HttpError(
      504,
      `Claude Code did not answer within ${Math.round(request.timeoutMs / 1000)}s. A local model may still be loading — try again, or pick a smaller one.`,
    );
  }

  if (result.code !== 0) {
    throw new HttpError(502, describeFailure(result.stdout, result.stderr, model));
  }

  const text = result.stdout.trim();
  if (!text) {
    throw new HttpError(502, describeFailure(result.stdout, result.stderr, model));
  }

  return { text, model: model ? `${CLAUDE.label} · ${model}` : CLAUDE.label };
}

/** Forget cached probe results, e.g. right after the user installs or logs in. */
export function invalidateEngineStatus(): void {
  statusCache.clear();
}

export const engineRunner: EngineRunner = {
  async list(): Promise<EngineStatus[]> {
    return [await claudeStatus()];
  },

  async run(request: EngineRequest) {
    switch (request.engine) {
      case CLAUDE.id:
        return runClaude(request);
      default:
        throw new HttpError(400, `Unknown local engine "${request.engine}".`);
    }
  },
};
