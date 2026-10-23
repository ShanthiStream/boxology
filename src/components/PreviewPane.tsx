import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerateResult, Phase } from '../types';
import { diagramSize, loadViewer, renderDiagram } from '../lib/viewer';
import { downloadBlob, exportDiagram, type ImageFormat } from '../lib/export';

interface Props {
  result: GenerateResult | null;
  phase: Phase;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
      <svg width="132" height="88" viewBox="0 0 132 88" fill="none" aria-hidden="true" className="text-white/15">
        <rect x="1" y="1" width="40" height="26" rx="4" stroke="currentColor" strokeWidth="1.5" />
        <rect x="91" y="1" width="40" height="26" rx="4" stroke="currentColor" strokeWidth="1.5" />
        <rect x="46" y="61" width="40" height="26" rx="4" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M41 14h50M20 27v31a7 7 0 0 0 7 7h19M112 27v31a7 7 0 0 1-7 7H86"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 5"
        />
      </svg>
      <div>
        <p className="text-[14px] font-medium text-text">Nothing drawn yet</p>
        <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] leading-relaxed text-mute">
          Describe a flow, an architecture or a schema on the left. It appears here as a live,
          editable draw.io canvas.
        </p>
      </div>
    </div>
  );
}

export function PreviewPane({ result, phase }: Props) {
  const [copied, setCopied] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const noteTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(noteTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!result || !canvasRef.current) return;

    let cancelled = false;
    let teardown: (() => void) | undefined;
    setViewerError(null);
    setViewerReady(false);

    loadViewer()
      .then(() => {
        if (cancelled || !canvasRef.current) return;
        teardown = renderDiagram(canvasRef.current, result.xml);
        setViewerReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'The viewer failed to load.';
        // draw.io's parser error is accurate and useless; say what it means.
        setViewerError(
          message.includes('Could not load the draw.io viewer')
            ? message
            : `${message} — the model emitted XML that draw.io cannot parse. Press Generate again, or try a stronger model.`,
        );
      });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [result]);

  function download(target: GenerateResult) {
    downloadBlob(new Blob([target.file.content], { type: 'application/xml' }), target.file.name);
  }

  async function saveImage(target: GenerateResult, format: ImageFormat) {
    if (exporting) return;
    window.clearTimeout(noteTimer.current);
    setExporting(true);
    setExportNote({ tone: 'ok', text: format === 'png' ? 'Rendering PNG…' : 'Rendering JPEG…' });

    try {
      await exportDiagram(target.xml, {
        format,
        fileName: target.file.name.replace(/\.drawio$/i, ''),
      });
      setExportNote({ tone: 'ok', text: `Saved ${format === 'png' ? 'PNG' : 'JPEG'}.` });
    } catch (error) {
      setExportNote({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not export the image.',
      });
    } finally {
      setExporting(false);
      noteTimer.current = window.setTimeout(() => setExportNote(null), 8000);
    }
  }

  async function copyLink(target: GenerateResult) {
    try {
      await navigator.clipboard.writeText(target.editorUrl);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const loading = phase === 'loading';
  const size = useMemo(() => (result ? diagramSize(result.xml) : null), [result]);

  return (
    <section aria-label="Diagram preview" className="flex min-h-[440px] min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${result ? 'bg-accent' : 'bg-line'}`}
            aria-hidden="true"
          />
          <span className="truncate font-mono text-[11.5px] text-mute">
            {result ? result.file.name : 'untitled.drawio'}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="btn px-2.5 py-1.5"
            onClick={() => result && copyLink(result)}
            disabled={!result}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            type="button"
            className="btn px-2.5 py-1.5"
            onClick={() => result && download(result)}
            disabled={!result}
          >
            Download .drawio
          </button>
          <span className="mx-0.5 hidden h-4 w-px bg-line sm:block" aria-hidden="true" />
          <button
            type="button"
            className="btn px-2.5 py-1.5"
            onClick={() => result && saveImage(result, 'png')}
            disabled={!result || !viewerReady || exporting}
            title="Download the diagram as a PNG image"
          >
            PNG
          </button>
          <button
            type="button"
            className="btn px-2.5 py-1.5"
            onClick={() => result && saveImage(result, 'jpeg')}
            disabled={!result || !viewerReady || exporting}
            title="Download the diagram as a JPEG image"
          >
            JPG
          </button>
          <a
            className={`btn px-2.5 py-1.5 no-underline ${result ? '' : 'pointer-events-none opacity-40'}`}
            href={result?.editorUrl ?? 'https://app.diagrams.net/'}
            target="_blank"
            rel="noreferrer"
            tabIndex={result ? 0 : -1}
            aria-disabled={!result}
          >
            Open in draw.io ↗
          </a>
        </div>
      </div>

      <div className="canvas-grid relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0B0C0E] p-4">
        {result ? (
          <div
            className="relative max-h-full max-w-full overflow-hidden rounded-md bg-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] ring-1 ring-black/50"
            style={
              size
                ? {
                    width: Math.min(size.width + 80, 10000),
                    height: Math.min(size.height + 80, 10000),
                  }
                : undefined
            }
          >
            <div ref={canvasRef} className="h-full w-full" />
            {!viewerReady && !viewerError ? (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-mute">
                Loading draw.io viewer…
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState />
        )}

        {viewerError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/80 p-6">
            <p className="max-w-[40ch] rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-[12.5px] leading-relaxed text-red-300">
              {viewerError}
            </p>
          </div>
        ) : null}

        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/70 backdrop-blur-[2px]">
            <div className="shimmer flex items-center gap-3 rounded-md border border-line bg-panel px-4 py-3">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              <span className="text-[12.5px] text-text">Drawing your diagram…</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-[11px] text-mute">
        <span
          className={exportNote?.tone === 'error' ? 'text-red-300' : ''}
          role={exportNote ? 'status' : undefined}
        >
          {exportNote
            ? exportNote.text
            : result
              ? `${result.meta.model} · ${(result.meta.ms / 1000).toFixed(1)}s${
                  result.meta.prunedEdges > 0
                    ? ` · ${result.meta.prunedEdges} dangling edge(s) removed`
                    : ''
                }`
              : 'Editable XML, not a screenshot'}
        </span>
        <span className="hidden sm:inline">Nothing is stored — your diagram stays in the browser</span>
      </div>
    </section>
  );
}
