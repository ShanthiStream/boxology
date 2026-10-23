import { useEffect, useState } from 'react';
import { PromptPanel } from './components/PromptPanel';
import { PreviewPane } from './components/PreviewPane';
import { SettingsDialog } from './components/SettingsDialog';
import { Wordmark } from './components/Wordmark';
import type { GenerateResult, Phase, PublicConfig } from './types';

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Load provider config once, and open Settings on first run so there is no
  // dead end for someone who just installed the app.
  useEffect(() => {
    fetch('/api/config')
      .then((response) => (response.ok ? (response.json() as Promise<PublicConfig>) : null))
      .then((loaded) => {
        if (!loaded) return;
        setConfig(loaded);
        if (!loaded.configured && loaded.canWrite) setSettingsOpen(true);
      })
      .catch(() => undefined);
  }, []);

  async function generate() {
    const text = prompt.trim();
    if (text.length < 3 || phase === 'loading') return;

    setPhase('loading');
    setError(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });

      const data = (await response.json().catch(() => null)) as
        | (GenerateResult & { error?: string })
        | null;

      if (!response.ok || !data) {
        throw new Error(data?.error ?? `Request failed (${response.status})`);
      }

      setResult(data);
      setPhase('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      setPhase(result ? 'ready' : 'idle');
    }
  }

  const needsSetup = config ? !config.configured : false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <Wordmark />
        <div className="flex items-center gap-3 text-[11.5px] text-mute">
          <span className="hidden md:inline">prompt → editable draw.io XML</span>
          {config?.canWrite ? (
            <button type="button" className="chip" onClick={() => setSettingsOpen(true)}>
              {config.model
                ? `Model: ${config.model}`
                : config.provider === 'claude-cli'
                  ? 'Model: Claude Code'
                  : 'Connect a model'}
            </button>
          ) : (
            <a
              href="https://www.drawio.com/mcp/"
              target="_blank"
              rel="noreferrer"
              className="chip no-underline hover:text-text"
            >
              built on draw.io ↗
            </a>
          )}
        </div>
      </header>

      {needsSetup ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-raise px-5 py-2.5">
          <span className="text-[12.5px] text-mute">
            {config?.provider === 'claude-cli'
              ? 'Claude Code is selected but not ready. Sign in from a terminal, then re-check in Settings.'
              : 'No model connected yet. Boxology needs an API key, a local model such as Ollama, or a signed-in CLI.'}
          </span>
          <button
            type="button"
            className="btn btn-accent px-3 py-1.5"
            onClick={() => setSettingsOpen(true)}
          >
            {config?.provider === 'claude-cli' ? 'Review setup' : 'Connect a model'}
          </button>
        </div>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-y-auto lg:grid-cols-[minmax(340px,400px)_1fr] lg:grid-rows-1 lg:overflow-hidden">
        <PromptPanel
          prompt={prompt}
          phase={phase}
          error={error}
          onPromptChange={setPrompt}
          onSubmit={generate}
        />
        <PreviewPane result={result} phase={phase} />
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(saved) => setConfig(saved)}
      />
    </div>
  );
}
