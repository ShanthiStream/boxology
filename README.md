# Boxology

Describe a diagram in a sentence, get a real draw.io file back. Not a screenshot,
not a canvas you can only use here — native `.drawio` XML you can open, edit and
keep.

```
prompt ──▶ handler ──▶ LLM (provider-agnostic) ──▶ draw.io XML
                                                    │
                          GraphViewer ◀──────────────┤  live preview
                          #R fragment  ◀──────────────┤  Open in draw.io
                          .drawio file ◀──────────────┤  Download
                          PNG / JPEG   ◀──────────────┘  In-browser export
```

One core, two hosts. `worker/index.ts` is a plain `(request, env) => Response`
handler: Cloudflare runs it directly, and `server/local.ts` runs the same function
on `node:http` for local use.

## Run it locally

Boxology runs on your machine and nowhere else. The server binds to loopback,
API keys stay in a local config file, and diagrams never leave the browser. It
is a web UI, but there is no Boxology account and no Boxology server — which is
also why it is not offered as a hosted multi-user app: that would mean holding
everyone's keys.

### Install

Requires [Bun](https://bun.sh) to build and Node 20+ to run. The built app has
no runtime dependencies.

```bash
git clone https://github.com/ShanthiStream/boxology
cd boxology
bun install
bun run build        # tsc + vite + server bundle → dist/
bun run start        # http://127.0.0.1:8787, opens your browser
```

`npm install -g .` inside the clone puts the `boxology` command on your `PATH`,
which is what the flags below assume. Boxology is not on npm yet — when it is,
`npx boxology` will do the same without the clone.

Chrome and Edge can then install it as a real app window — **Install Boxology**
from the address bar, or ⋮ → Cast, save and share → Install page as app. It gets
its own Dock/taskbar icon and no tab strip, while still talking only to your
machine (Safari: File → Add to Dock).

Prefer one file over a clone? `bun run package` builds an installable tarball:

```bash
bun run package
npm install -g ./release/boxology-0.1.0.tgz
boxology
```

On first launch the settings dialog opens. Pick a provider, paste a key (or point
at Ollama and skip the key), hit **Fetch models**, then **Test connection** to
prove it works before saving. If you already use Claude Code, Boxology detects it
and can borrow that login instead — no key at all. See
[Local CLI engines](#local-cli-engines).

```bash
boxology --port 9000             # different port
boxology --config ./cfg.json     # different config file
boxology --no-open               # do not launch a browser
boxology --help
BOXOLOGY_CONFIG=./cfg.json boxology   # same thing, env form
```

Everything is served from the app's own origin — the draw.io viewer and both
fonts are vendored — so preview and PNG/JPEG export work offline and make no
third-party requests. Only the model call leaves the machine, and not even that
if you use Ollama or a local CLI engine.

For UI work, `bun run dev` serves on `:5173` with hot reload but expects the
Cloudflare-style host; to iterate against the local host, rebuild and restart:

```bash
bun run build:ui && bun run build:server
```

### Where your key lives

`~/.config/boxology/config.json` (respects `XDG_CONFIG_HOME`; on Windows
`%APPDATA%\boxology\config.json`), written `0600` inside a `0700` directory.

```json
{
  "version": 1,
  "provider": "openai",
  "baseUrl": "http://localhost:11434/v1",
  "apiKey": "sk-…",
  "model": "qwen2.5-coder:14b"
}
```

The key is never returned to the browser — `GET /api/config` reports only
`hasApiKey: true`. Leaving the key field blank in the dialog keeps the saved one,
but only while the provider stays the same: a key belongs to one provider and is
dropped when you switch. A CLI provider stores no key and no base URL at all.

## Choosing a model

Either use the settings dialog, or set four environment variables. `LLM_BASE_URL`
accepts anything speaking the OpenAI chat-completions shape.

| Provider | `LLM_PROVIDER` | `LLM_BASE_URL` | `LLM_MODEL` |
|---|---|---|---|
| OpenAI | `openai` | `https://api.openai.com/v1` | `gpt-4.1-mini` |
| Anthropic | `anthropic` | — | `claude-sonnet-4-5` |
| OpenRouter | `openai` | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4.5` |
| Ollama (local) | `openai` | `http://localhost:11434/v1` | `qwen2.5-coder:14b` |
| LM Studio | `openai` | `http://localhost:1234/v1` | whatever you loaded |
| Claude Code (CLI) | `claude-cli` | — | `sonnet`, `opus`, `haiku` or a full id |

Local endpoints are detected by hostname and don't require a key, and
`claude-cli` never takes one. Models that are strong at structured XML (Claude,
GPT-4.1, Qwen2.5-Coder) produce noticeably better diagrams than small chat models.

## Local CLI engines

If you already pay for a coding CLI, you already have a model. Boxology looks for
one when it starts, and a signed-in `claude` shows up in the settings dialog as
**Claude Code** — the same login and quota you use in a terminal, no key to paste.

Detection is cached for 15 seconds and never fails a request: `claude --version`
and `claude auth status --json`, run side by side with a 12-second cap each. Only
`loggedIn` is read from that payload; the account email and organisation never
reach the browser, and a probe that times out reports "unknown", not "broken".

A generation spawns the CLI once, chat-only:

```bash
claude -p --output-format text \
  --tools "" --strict-mcp-config --disable-slash-commands \
  --permission-mode dontAsk \
  [--model MODEL] [--append-system-prompt SYSTEM]
```

- The prompt goes in on **stdin**, never argv, so it stays out of `ps` and shell
  history.
- The working directory is the OS temp dir, so a `CLAUDE.md` in whatever project
  you have open cannot steer a diagram.
- If the CLI does not understand one of those flags it refuses to start. That is
  the safe failure — the alternative is a run with tools enabled.

Installed somewhere unusual? `PATH` wins, then `~/.local/bin`, `~/.npm-global/bin`,
`~/.claude/local`, `/usr/local/bin` and `/opt/homebrew/bin` are **appended** (only
if they exist), because a GUI-launched app inherits a much smaller `PATH` than your
shell. Add your own directory with a colon-separated list:

```bash
BOXOLOGY_EXTRA_PATH=/opt/tools/bin bun run start
```

Local engines exist only on the local host: the runner is injected through `Env`,
and a Cloudflare deployment has no `node:child_process`, so `claude-cli` is not
selectable there. Only Claude Code is wired up today; `server/engines.ts` keeps
engines as a table, so adding another CLI is an entry plus its flag set rather than
a new code path.

## PNG and JPEG

The preview has **PNG** and **JPG** buttons. Both render in your browser: the
diagram is drawn again by the same `GraphViewer` into an offscreen container sized
to the diagram, then rasterised through an `<img>` and a canvas. draw.io's own
export is an editor action on their servers, and uploading the diagram just to get
a picture of it would contradict the rest of the app.

- **Offscreen, at 1:1.** Exporting the on-screen preview would bake in whatever
  scale the pane imposed on a big diagram. The offscreen render is always the
  diagram's own size, then 2× for sharpness.
- **Tight crop.** Bounds come from the geometry, not the canvas, so a diagram that
  spilled past its sheet still exports whole. HTML labels are measured through the
  shape they sit in — draw.io parks each `<foreignObject>` at `x=-9879` to centre
  text, and measuring that would produce a canvas the size of a football pitch.
- **Light colours on white.** draw.io writes label colours as
  `light-dark(light, dark)`. A detached SVG has no colour scheme, so the light
  value is committed and both formats get a white page.
- **No editor furniture.** Collapse/expand handles are stripped; they belong to
  editing, not to the picture.
- **Bounded.** Output is capped at 24 megapixels, because browsers refuse very
  large canvases.

## Security model (local host)

A server on `localhost` is reachable by every page you have open, so the local
host is not just "bind and forget":

| Risk | Control | Where |
|---|---|---|
| LAN exposure | binds `127.0.0.1` only, never `0.0.0.0` | `server/local.ts` |
| DNS rebinding | `Host` must be `127.0.0.1`, `localhost` or `[::1]` | `worker/guard.ts` |
| CSRF / token theft | `Origin`, when present, must be loopback | `worker/guard.ts` |
| Key on disk | `0600` file in `0700` dir, re-chmod'd on write | `server/config.ts` |
| Key in responses | never serialized; only `hasApiKey` | `worker/index.ts` |
| CLI as a model | chat-only run, prompt on stdin, cwd is the temp dir | `server/engines.ts` |
| Runaway spend | 12 requests/minute per IP | `worker/index.ts` |

Without the `Host` check, `evil.com` could resolve to `127.0.0.1` and read your
config through the user's browser. Without the `Origin` check, any page could
`POST /api/generate` and spend your tokens. Both are rejected with `403`.

## Deploying to a Cloudflare account

The Wrangler config deliberately has **no `account_id`**, so this deploys to
whichever account you authenticate as. Config comes from bindings here, so
`/api/config` is read-only (`canWrite: false`) and `PUT` returns `405`.

```bash
# 1. Point at the target account (either interactive or token-based)
wrangler login
# or, for CI / a different account without touching your default login:
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...

# 2. Store the key as a secret — never in wrangler.jsonc
wrangler secret put LLM_API_KEY

# 3. Ship it
bun run deploy
```

Non-secret defaults (`LLM_PROVIDER`, `LLM_MODEL`) live in `wrangler.jsonc`. To use
a different provider in production, either edit those vars or override per
environment with `wrangler deploy --var LLM_PROVIDER:anthropic`.

You'll get `https://boxology.<your-subdomain>.workers.dev`. The subdomain is free
and yours to choose; a custom domain is optional and costs whatever the registrar
charges (Cloudflare Registrar sells at cost, ~$10/yr for a `.com`).

### Before it's public

The Worker has a **best-effort per-isolate rate limit** (12 requests/minute per
IP). That is a speed bump, not a quota — isolates are recycled and multiplied
freely. Anyone who finds the URL can spend your tokens. Add a Cloudflare
**WAF rate-limiting rule** on `/api/generate` before sharing the link, or put
Cloudflare Access in front of it.

## API

| Route | Purpose |
|---|---|
| `POST /api/generate` | `{ prompt }` → XML, `#R` payload, viewer/editor URLs, `.drawio` file |
| `POST /api/models` | Draft settings → model ids (nothing saved) |
| `POST /api/test` | Draft settings → one-token round trip, latency included |
| `GET /api/config` | Effective config, key redacted, plus detected local engines |
| `PUT /api/config` | Save config — local host only, `405` elsewhere |
| `GET /api/health` | Liveness plus whether the current config resolves |

`/api/models` and `/api/test` take a draft `{ provider, baseUrl, apiKey, model }`
so settings can be proved before they are written. A missing key falls back to the
saved one, which is why "Test connection" works without retyping it.

## How it works

| Piece | File | Notes |
|---|---|---|
| HTTP API | `worker/index.ts` | Routes above |
| Model adapter | `worker/llm.ts` | OpenAI-compatible + Anthropic branches |
| Request guard | `worker/guard.ts` | Host/Origin checks for the local host |
| Config store | `server/config.ts` | `0600` JSON file, local host only |
| Local engines | `server/engines.ts` | CLI detection, bounded runs, error normalisation |
| Local host | `server/local.ts` | `node:http`, static files, loopback bind |
| npm launcher | `bin/boxology.mjs` | `npx boxology` / global install entry |
| Settings UI | `src/components/SettingsDialog.tsx` | Provider presets, detected engines, test |
| Prompt | `worker/prompt.ts` | Inlines the official draw.io XML rules |
| Output repair | `worker/xml.ts` | Fences, bare `&`, dangling edges, markup in attributes |
| URL/file encoding | `worker/drawio.ts` | `#R` fragment + `.drawio` wrapper |
| Preview | `src/lib/viewer.ts` | `viewer-static.min.js` + GraphViewer |
| Image export | `src/lib/export.ts` | Offscreen render → `<img>` → canvas → PNG/JPEG |

`shared/xml-essentials.md` is vendored from
[jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp) (Apache-2.0) and compiled
into `worker/reference.ts`. After updating it, run:

```bash
bun run ref
```

### Details that are easy to get wrong

1. **Compression order.** draw.io's `#R` fragment is
   `encodeURIComponent(xml)` → raw deflate → base64 → URL-encoded. Compressing the
   raw XML instead produces a well-formed link that renders an empty canvas.
   Verified byte-for-byte against the reference Python implementation in
   `drawio-mcp/project-instructions`.
2. **GraphViewer takes a DOM element, not a string.** `init` calls
   `xml.ownerDocument`; passing the XML string throws an `XMLSerializer` error,
   which most examples online get away with only because they use the
   `data-mxgraph` attribute path.
3. **The viewer caps zoom-in at 100%.** `auto-fit` can only shrink, so a small
   diagram lands in the corner of a large canvas. The preview sizes its sheet to
   the diagram's measured bounds instead.
4. **HTML in an XML attribute kills the whole file.** Models happily emit
   `value="Pay<br>Now"` with `html=1` in the style. XML requires
   `&lt;br&gt;`, and draw.io rejects the entire diagram otherwise. `sanitize`
   repairs markup inside attribute values only, leaving tags and text alone.

## Privacy

No database, no storage, no accounts. The diagram exists in the HTTP response and
in your browser. `Open in draw.io` carries the diagram in the URL **fragment**,
which browsers never transmit to a server.

The prompt and the generated diagram are sent to whichever model provider you
configure — that's inherent to generating them. Everything else is local: the
draw.io viewer and both fonts are vendored and served from the app's own origin,
so preview and PNG/JPEG export make no third-party requests. Nothing is uploaded
anywhere. With Ollama or a CLI engine, no diagram ever leaves the machine.

A few stencil libraries (AWS/Azure icons, math typesetting) are not vendored —
they are only fetched from `viewer.diagrams.net` if a diagram actually uses
them. Boxology's own output is text and standard shapes, which are inline.

## License

Apache-2.0. See `LICENSE` and `NOTICE` (the draw.io XML guidance is derived from
JGraph's `drawio-mcp`, and the notice records that).

## Trademark

"draw.io" and "diagrams.net" are trademarks of JGraph Ltd. Boxology is an
independent tool that reads and writes the draw.io file format; it is not
affiliated with or endorsed by JGraph. Keep their marks in descriptive text
("opens in draw.io") and out of the product name.
