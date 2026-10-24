import type { Phase } from '../types';
import { useEffect, useState } from 'react';

const EXAMPLES = [
  {
    label: 'Refund approval',
    prompt:
      'Customer refund approval: request, review, decision, escalate or pay out, with a note on who owns each step',
  },
  {
    label: 'AWS image app',
    prompt:
      'AWS architecture for an image app: CloudFront, API Gateway, Lambda, SQS queue, S3 storage, DynamoDB',
  },
  { label: 'CI/CD pipeline', prompt: 'CI/CD pipeline from commit to production, with a rollback path' },
  {
    label: 'Booking ER diagram',
    prompt: 'Booking system ER diagram: users, trips, payments, refunds and their relationships',
  },
];

interface Props {
  prompt: string;
  phase: Phase;
  error: string | null;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onErrorDismiss?: () => void;
}

export function PromptPanel({ prompt, phase, error, onPromptChange, onSubmit, onErrorDismiss }: Props) {
  const loading = phase === 'loading';
  const [visibleError, setVisibleError] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      setVisibleError(error);
      const t = setTimeout(() => setVisibleError(null), 8000);
      return () => clearTimeout(t);
    }
  }, [error]);

  return (
    <section
      aria-labelledby="prompt-heading"
      className="flex flex-col gap-5 border-b border-line p-5 lg:min-h-0 lg:border-b-0 lg:border-r"
    >
      <div>
        <h1
          id="prompt-heading"
          className="max-w-[22ch] text-[26px] font-medium leading-[1.15] tracking-tightest"
        >
          Describe the diagram.
          <span className="block text-mute">Get something you can edit.</span>
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mute">
          Boxology writes native draw.io XML — not a picture. Open it in draw.io, drag anything, and
          it stays yours.
        </p>
      </div>

      <form
        className="flex flex-1 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="prompt" className="text-[11px] font-medium uppercase tracking-[0.14em] text-mute">
          Your prompt
        </label>

        <textarea
          id="prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="A three-stage onboarding flow with a verification decision and a fallback to support…"
          spellCheck={false}
          rows={7}
          maxLength={4000}
          className="min-h-[160px] w-full resize-y rounded-md border border-line bg-panel px-3 py-3
                     text-[13.5px] leading-relaxed text-text placeholder:text-mute/60
                     transition-colors hover:border-white/15 focus:border-accent/60 focus:outline-none"
        />

        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => onPromptChange(example.prompt)}
              className="chip"
              title={example.prompt}
            >
              {example.label}
            </button>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-3 pt-1">
          <button type="submit" className="btn btn-accent px-4" disabled={loading || prompt.trim().length < 3}>
            {loading ? 'Drawing…' : 'Generate diagram'}
          </button>
          <span className="text-[11px] text-mute">
            <kbd className="kbd">⌘</kbd> <kbd className="kbd">↵</kbd>
          </span>
        </div>

        <div aria-live="polite" className="min-h-[18px]">
          {visibleError ? (
            <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-red-300">
              <span className="flex-1">{visibleError}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                className="ml-1 text-red-300/80 hover:text-red-200"
                onClick={() => {
                  setVisibleError(null);
                  onErrorDismiss?.();
                }}
              >
                ✕
              </button>
            </div>
          ) : null}
        </div>
      </form>
    </section>
  );
}
