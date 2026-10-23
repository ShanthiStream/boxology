/**
 * Turning model output into XML we can actually hand to draw.io.
 *
 * Models are reliable about structure and unreliable about detail: they wrap
 * output in fences, emit an <mxfile> when asked for a model, forget to escape
 * `&`, and occasionally point an edge at an id that does not exist. Each repair
 * below is narrow and observable rather than a catch-all parser.
 */
import { HttpError } from './env';

/** Strip fences/prose and isolate the smallest XML container we can use. */
export function extractXml(raw: string): string {
  let text = raw.trim();

  text = text
    .replace(/^```(?:xml)?[ \t]*\r?\n?/i, '')
    .replace(/\r?\n?```[ \t]*$/, '')
    .trim();

  const graph = text.match(/<mxGraphModel\b[\s\S]*?<\/mxGraphModel>/);
  if (graph) return graph[0].trim();

  const file = text.match(/<mxfile\b[\s\S]*?<\/mxfile>/);
  if (file) {
    const inner = file[0].match(/<mxGraphModel\b[\s\S]*?<\/mxGraphModel>/);
    if (inner) return inner[0].trim();
  }

  throw new HttpError(422, 'The model did not return draw.io XML. Try rephrasing the prompt.');
}

/** Escape bare ampersands; models routinely write "A & B" into a label. */
export function escapeAmpersands(xml: string): string {
  return xml.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g, '&amp;');
}

/**
 * Escape markup that leaked into an attribute value.
 *
 * With `html=1` in the style, models like to emit `value="Pay<br>Now"` — valid
 * HTML, invalid XML. draw.io then refuses the entire file with "Unescaped '<'
 * not allowed in attributes values", so one label costs the whole diagram. We
 * only rewrite inside quoted values, leaving tags and text nodes untouched.
 */
export function escapeAttributeMarkup(xml: string): { xml: string; fixes: number } {
  let out = '';
  let fixes = 0;
  let inTag = false;
  let quote: string | null = null;

  for (let i = 0; i < xml.length; i += 1) {
    const char = xml[i]!;

    if (!inTag) {
      if (char === '<') inTag = true;
      out += char;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '<' || char === '>') {
        out += char === '<' ? '&lt;' : '&gt;';
        fixes += 1;
        continue;
      }
      out += char;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === '>') inTag = false;
    out += char;
  }

  return { xml: out, fixes };
}

/**
 * Drop edges whose source or target id does not exist. draw.io renders such an
 * edge as a floating stub, which looks like a bug in the app rather than in the
 * generated XML.
 */
export function pruneDanglingEdges(xml: string): { xml: string; removed: number } {
  const ids = new Set<string>();
  for (const m of xml.matchAll(/<mxCell\b[^>]*\bid="([^"]+)"/g)) {
    if (m[1]) ids.add(m[1]);
  }

  let removed = 0;
  const out = xml.replace(/<mxCell\b[^>]*\bedge="1"[^>]*?(?:\/>|>[\s\S]*?<\/mxCell>)/g, (cell) => {
    const source = cell.match(/\bsource="([^"]+)"/)?.[1];
    const target = cell.match(/\btarget="([^"]+)"/)?.[1];
    const dangling = (source && !ids.has(source)) || (target && !ids.has(target));
    if (dangling) {
      removed += 1;
      return '';
    }
    return cell;
  });

  return { xml: out, removed };
}

/** Reject empty diagrams early instead of showing a blank canvas. */
export function assertRenderable(xml: string): void {
  if (!xml.startsWith('<mxGraphModel')) {
    throw new HttpError(422, 'Malformed diagram: missing <mxGraphModel> root.');
  }
  if (!/<\/mxGraphModel>$/.test(xml.trim())) {
    throw new HttpError(422, 'Truncated diagram: the model likely hit its output limit.');
  }
  if (!/\bvertex="1"/.test(xml)) {
    throw new HttpError(422, 'The model produced no shapes. Try a more specific prompt.');
  }
}

/** Normalise model output into a diagram that renders. */
export function sanitize(raw: string): { xml: string; prunedEdges: number; repairedMarkup: number } {
  let xml = escapeAmpersands(extractXml(raw));

  const repaired = escapeAttributeMarkup(xml);
  xml = repaired.xml;

  const pruned = pruneDanglingEdges(xml);
  xml = pruned.xml;

  assertRenderable(xml);
  return { xml, prunedEdges: pruned.removed, repairedMarkup: repaired.fixes };
}

/** Filename-safe slug that cuts on word boundaries ("...support-fallba" looks broken). */
export function slugify(input: string, max = 48): string {
  const words = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    const next = kept.length === 0 ? word.length : length + word.length + 1;
    if (next > max) break;
    kept.push(word);
    length = next;
  }

  return kept.join('-') || 'diagram';
}
