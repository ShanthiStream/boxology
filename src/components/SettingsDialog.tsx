import { useEffect, useRef, useState } from 'react';
import type { EngineStatus, ProviderId, PublicConfig } from '../types';

interface Preset {
  id: string;
  label: string;
  provider: ProviderId;
  baseUrl: string;
  keyless?: boolean;
  hint?: string;
}

const PRESETS: Preset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    provider: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    keyless: true,
    hint: 'Runs on your machine. No key, nothing leaves the computer.',
  },
  { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  {
    id: 'claude-cli',
    label: 'Claude Code',
    provider: 'claude-cli',
    baseUrl: '',
    keyless: true,
    hint: 'Borrows the Claude Code login you already have. No key, no endpoint.',
  },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  {
    id: 'custom',
    label: 'Custom',
    provider: 'openai',
    baseUrl: '',
    hint: 'Any OpenAI-compatible endpoint: LM Studio, vLLM, Groq, Together, DeepSeek.',
  },
];

const CLAUDE_PRESET = PRESETS.find((preset) => preset.provider === 'claude-cli')!;

function presetFor(config: PublicConfig | null): Preset {
  const base = (config?.baseUrl ?? '').replace(/\/$/, '');
  return (
    PRESETS.find((preset) => preset.provider === config?.provider && preset.baseUrl === base) ??
    PRESETS.find((preset) => preset.provider === config?.provider && preset.baseUrl === '' && base !== '') ??
    PRESETS[1]!
  );
}

function engineState(engine: EngineStatus): string {
  if (!engine.installed) return 'not installed';
  if (engine.signedIn === true) return 'signed in';
  if (engine.signedIn === false) return 'signed out';
  return 'state unknown';
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (config: PublicConfig) => void;
}

type Status = { tone: 'ok' | 'error' | 'busy'; message: string } | null;

export function SettingsDialog({ open, onClose, onSaved }: Props) {
  const [preset, setPreset] = useState<Preset>(PRESETS[0]!);
  const [provider, setProvider] = useState<ProviderId>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [savedProvider, setSavedProvider] = useState<ProviderId>('openai');
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [engines, setEngines] = useState<EngineStatus[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setApiKey('');

    fetch('/api/config')
      .then((response) => response.json() as Promise<PublicConfig>)
      .then((config) => {
        const match = presetFor(config);
        setPreset(match);
        setProvider(config.provider);
        setSavedProvider(config.provider);
        setBaseUrl(config.baseUrl || match.baseUrl);
        setModel(config.model);
        setHasSavedKey(config.hasApiKey);
        setConfigPath(config.configPath);
        setEngines(config.engines ?? []);
      })
      .catch(() => setStatus({ tone: 'error', message: 'Could not read the current settings.' }));
  }, [open]);

  useEffect(() => {
    if (open && provider !== 'claude-cli') firstField.current?.focus();
  }, [open, provider]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const usesCli = provider === 'claude-cli';
  const engine = engines.find((entry) => entry.id === provider) ?? null;
  const engineReady = Boolean(engine?.installed && engine.signedIn === true);
  const savedKeyApplies = hasSavedKey && savedProvider === provider;

  const draft = () => ({
    provider,
    baseUrl: usesCli ? '' : baseUrl,
    apiKey: usesCli ? '' : apiKey || undefined,
    model: model || undefined,
  });

  async function call(path: string, init: RequestInit): Promise<any> {
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json' },
    });
    const data = (await response.json().catch(() => null)) as any;
    if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);
    return data;
  }

  function choose(option: Preset) {
    if (option.provider !== provider) {
      // Model names do not carry across providers: `gpt-4.1-mini` means nothing
      // to a CLI, and `sonnet` means nothing to OpenAI.
      setModel('');
      setModels([]);
    }
    setPreset(option);
    setProvider(option.provider);
    setBaseUrl(option.baseUrl);
    setStatus(null);
  }

  /** Re-probe without touching unsaved edits in the form. */
  async function refreshEngines() {
    setStatus({ tone: 'busy', message: 'Looking for local CLI engines…' });
    try {
      const config = (await (await fetch('/api/config')).json()) as PublicConfig;
      setEngines(config.engines ?? []);
      setStatus(
        config.engines?.length
          ? { tone: 'ok', message: `Checked ${config.engines.length} engine(s).` }
          : { tone: 'error', message: 'No local engine detection is available on this deployment.' },
      );
    } catch {
      setStatus({ tone: 'error', message: 'Could not reach the local engine check.' });
    }
  }

  async function fetchModels() {
    setStatus({ tone: 'busy', message: 'Asking the provider for its model list…' });
    try {
      const data = await call('/api/models', { method: 'POST', body: JSON.stringify(draft()) });
      setModels(data.models ?? []);
      setStatus({
        tone: 'ok',
        message:
          data.models?.length > 0
            ? `Found ${data.models.length} model${data.models.length === 1 ? '' : 's'}.`
            : 'The provider returned no models. Type a name instead.',
      });
      if (!model && data.models?.[0]) setModel(data.models[0]);
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Failed.' });
    }
  }

  async function testConnection() {
    setStatus({
      tone: 'busy',
      message: usesCli ? 'Running the CLI once — this can take a minute…' : 'Sending a one-token test…',
    });
    try {
      const data = await call('/api/test', { method: 'POST', body: JSON.stringify(draft()) });
      setStatus({ tone: 'ok', message: `Connected to ${data.model} in ${data.ms} ms.` });
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Failed.' });
    }
  }

  async function save() {
    setStatus({ tone: 'busy', message: 'Saving…' });
    try {
      const saved = await call('/api/config', { method: 'PUT', body: JSON.stringify(draft()) });
      setHasSavedKey(saved.hasApiKey);
      setSavedProvider(saved.provider);
      setEngines(saved.engines ?? engines);
      setStatus({ tone: 'ok', message: 'Saved.' });
      onSaved(saved as PublicConfig);
      onClose();
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'Failed.' });
    }
  }

  const keyLabel = preset.keyless ? 'API key (not needed)' : 'API key';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/80 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full max-w-[560px] rounded-lg border border-line bg-panel shadow-[0_24px_60px_-15px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="settings-title" className="text-[16px] font-medium tracking-tight">
              Connect a model
            </h2>
            <p className="mt-1 text-[12.5px] text-mute">
              Bring your own key, point at a local model, or borrow a CLI you are already signed
              in to. Nothing is sent anywhere but the provider you pick.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn px-2 py-1 text-mute" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          {engines.length > 0 ? (
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-mute">
                  Local engines (detected)
                </span>
                <button type="button" className="text-[11px] text-mute underline hover:text-text" onClick={refreshEngines}>
                  Re-check
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {engines.map((entry) => {
                  const ready = entry.installed && entry.signedIn === true;
                  const selected = provider === entry.id;
                  return (
                    <div
                      key={entry.id}
                      className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 ${
                        selected ? 'border-accent/40 bg-accent/5' : 'border-line bg-raise'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-text">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${ready ? 'bg-accent' : 'bg-line'}`}
                            aria-hidden="true"
                          />
                          {entry.label}
                          {entry.version ? (
                            <span className="font-mono text-[11px] text-mute">{entry.version}</span>
                          ) : null}
                          <span className={`text-[11px] ${ready ? 'text-mute' : 'text-amber-300/80'}`}>
                            {engineState(entry)}
                          </span>
                        </p>
                        {entry.reason ? (
                          <p className="mt-1 text-[11.5px] leading-relaxed text-mute">{entry.reason}</p>
                        ) : (
                          <p className="mt-1 text-[11.5px] leading-relaxed text-mute">
                            Runs chat-only: no tools, no files, no MCP servers.
                          </p>
                        )}
                      </div>
                      {selected ? (
                        <span className="shrink-0 text-[11px] text-accent">selected</span>
                      ) : (
                        <button
                          type="button"
                          className="btn shrink-0 px-2.5 py-1"
                          onClick={() => choose(PRESETS.find((option) => option.provider === entry.id) ?? CLAUDE_PRESET)}
                          disabled={!ready}
                          title={ready ? 'Use this engine' : (entry.reason ?? 'Not ready')}
                        >
                          Use
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-mute">Provider</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`chip ${
                    option.id === preset.id ? 'border-accent/60 bg-accent/10 text-text' : ''
                  }`}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {preset.hint ? <p className="mt-2 text-[12px] text-mute">{preset.hint}</p> : null}
            {usesCli && engine ? (
              <p className="mt-1 text-[12px] text-mute">
                {engineReady
                  ? `Detected at ${engine.version ?? 'your PATH'} · ${engine.models.join(', ')}`
                  : (engine.reason ?? 'This engine is not ready.')}
              </p>
            ) : null}
          </div>

          {usesCli ? null : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-mute">Base URL</span>
              <input
                ref={firstField}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
                className="rounded-md border border-line bg-ink px-3 py-2 font-mono text-[12.5px] text-text
                           placeholder:text-mute/50 focus:border-accent/60 focus:outline-none"
              />
            </label>
          )}

          {usesCli ? null : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-mute">{keyLabel}</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                placeholder={savedKeyApplies ? '•••••••••• saved — leave blank to keep' : 'sk-…'}
                className="rounded-md border border-line bg-ink px-3 py-2 font-mono text-[12.5px] text-text
                           placeholder:text-mute/50 focus:border-accent/60 focus:outline-none"
              />
            </label>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-mute">Model</span>
            <div className="flex gap-2">
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={usesCli ? 'Leave blank for your Claude Code default' : 'Fetch the list, or type a name'}
                spellCheck={false}
                list="boxology-models"
                className="min-w-0 flex-1 rounded-md border border-line bg-ink px-3 py-2 font-mono text-[12.5px]
                           text-text placeholder:text-mute/50 focus:border-accent/60 focus:outline-none"
              />
              <datalist id="boxology-models">
                {models.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <button type="button" className="btn shrink-0 px-3 py-2" onClick={fetchModels}>
                {usesCli ? 'Show names' : 'Fetch models'}
              </button>
            </div>
            {models.length > 0 ? (
              <p className="text-[11.5px] text-mute">
                {usesCli
                  ? `Aliases this CLI accepts: ${models.join(', ')} — or a full model id.`
                  : `${models.length} available — start typing to filter the list.`}
              </p>
            ) : null}
          </div>

          <div aria-live="polite" className="min-h-[20px]">
            {status ? (
              <p
                className={`rounded-md border px-2.5 py-2 text-[12px] leading-relaxed ${
                  status.tone === 'error'
                    ? 'border-red-500/30 bg-red-500/10 text-red-300'
                    : status.tone === 'ok'
                      ? 'border-accent/30 bg-accent/10 text-text'
                      : 'border-line bg-raise text-mute'
                }`}
              >
                {status.message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <span className="font-mono text-[11px] text-mute">
            {configPath ? `Saved to ${configPath}` : 'Read-only deployment'}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn px-3 py-2" onClick={testConnection}>
              Test connection
            </button>
            <button type="button" className="btn btn-accent px-4 py-2" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
