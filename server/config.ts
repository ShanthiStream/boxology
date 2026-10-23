/**
 * Config file backing for the local host.
 *
 * The file is the only place an API key is persisted, so it is written 0600
 * inside a 0700 directory and re-chmod'd on every write — a pre-existing file
 * with looser permissions would otherwise stay readable by other users.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ConfigStore, ProviderId, StoredConfig } from '../worker/env';

export function defaultConfigPath(): string {
  const override = process.env.BOXOLOGY_CONFIG;
  if (override) return override;

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'boxology', 'config.json');
  }

  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'boxology', 'config.json');
}

function parse(raw: string): StoredConfig {
  const data = JSON.parse(raw) as Partial<StoredConfig>;
  // Anything unrecognised falls back to openai: a hand-edited or older file
  // must not brick the app, but a known provider must survive a round trip.
  const provider: ProviderId =
    data.provider === 'anthropic' || data.provider === 'claude-cli' ? data.provider : 'openai';
  return {
    version: 1,
    provider,
    baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : undefined,
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
  };
}

export function fileConfigStore(path: string = defaultConfigPath()): ConfigStore {
  return {
    path,

    async read(): Promise<StoredConfig | null> {
      try {
        return parse(await readFile(path, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },

    async write(config: StoredConfig): Promise<void> {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      // `mode` only applies at creation; tighten an existing file too.
      await chmod(path, 0o600).catch(() => undefined);
    },
  };
}
