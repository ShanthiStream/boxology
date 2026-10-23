/**
 * draw.io URL + file encoding.
 *
 * The order here is not arbitrary. draw.io's own `Graph.compress` percent-encodes
 * the XML *first*, then raw-deflates those ASCII bytes, then base64s the result:
 *
 *   xml -> encodeURIComponent(xml) -> deflate-raw -> base64 -> #R<base64>
 *
 * Compressing the raw XML instead still produces a well-formed link, but draw.io
 * decodes it to garbage and renders an empty canvas. Matches the reference
 * implementation in jgraph/drawio-mcp/project-instructions.
 */

const VIEWER_BASE = 'https://viewer.diagrams.net/';
const APP_BASE = 'https://app.diagrams.net/';

/** Wrap bare <mxGraphModel> XML in the container a .drawio file expects. */
export function toDrawioFile(xml: string, name = 'Page-1'): string {
  return (
    `<mxfile host="boxology" compressed="false" type="device">` +
    `<diagram id="boxology" name="${name}">${xml}</diagram>` +
    `</mxfile>`
  );
}

async function deflateRawBase64(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());

  // btoa needs a binary string; chunk to stay clear of the argument limit.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The `#R` fragment payload for a piece of draw.io XML. */
export async function encodeDiagram(xml: string): Promise<string> {
  const percentEncoded = encodeURIComponent(xml);
  const base64 = await deflateRawBase64(percentEncoded);
  return encodeURIComponent(base64);
}

export function viewerUrl(payload: string): string {
  return `${VIEWER_BASE}?embed=1&spin=1&proto=json&ui=min&noSaveBtn=1#R${payload}`;
}

export function editorUrl(payload: string): string {
  return `${APP_BASE}?pv=0&grid=0#R${payload}`;
}
