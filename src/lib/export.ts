/**
 * Turning the rendered draw.io canvas into a PNG or JPEG.
 *
 * draw.io will do this for you, but only on its servers: `export` is an editor
 * action, and the viewer we embed has no export API. Shipping the diagram to a
 * third party just to get a picture of it would contradict the rest of the app,
 * so the image is rasterised here instead.
 *
 * The source is the same `GraphViewer` render the preview uses, drawn into a
 * throwaway container sized to the diagram. Rendering offscreen matters: the
 * preview scales a big diagram down to fit the pane, and exporting that would
 * produce a small, soft image. Offscreen, the drawing is always 1:1.
 */
import { diagramSize, loadViewer, renderDiagram } from './viewer';

export type ImageFormat = 'png' | 'jpeg';

export interface ExportOptions {
  format: ImageFormat;
  fileName: string;
  /** Device pixels per diagram unit. Defaults to 2. */
  scale?: number;
  /** White space kept around the drawing, in diagram units. */
  margin?: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Browsers refuse very large canvases; stay well inside every known limit. */
const MAX_PIXELS = 24_000_000;
const DEFAULT_SCALE = 2;
const DEFAULT_MARGIN = 24;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Bounds of the drawing in the root viewport's coordinates.
 *
 * `getBBox()` alone is not enough: it reports an element's own user space, so a
 * shape inside `translate(24,24) scale(1)` would be measured 24px off. `getCTM()`
 * lifts the box into the space the exported `viewBox` uses.
 *
 * HTML labels are skipped on purpose. draw.io parks each `<foreignObject>` at
 * x=-9879 with a 10000px padding trick to centre text, so measuring one would
 * produce a canvas the size of a football pitch; the shape it labels is already
 * measured.
 */
function drawingBounds(svg: SVGSVGElement): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const shapes = svg.querySelectorAll<SVGGraphicsElement>(
    'path, rect, circle, ellipse, line, polyline, polygon, text, image',
  );

  for (const shape of shapes) {
    if (shape.closest('foreignObject, defs, clipPath, mask, marker, pattern, symbol')) continue;

    let box: DOMRect;
    let matrix: DOMMatrix | null;
    try {
      box = shape.getBBox();
      matrix = shape.getCTM();
    } catch {
      continue;
    }
    if (!matrix || !Number.isFinite(box.x) || !Number.isFinite(box.y)) continue;
    if (box.width <= 0 && box.height <= 0) continue;

    const corners: Array<[number, number]> = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ];

    for (const [px, py] of corners) {
      const x = matrix.a * px + matrix.c * py + matrix.e;
      const y = matrix.b * px + matrix.d * py + matrix.f;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}

/**
 * Replace `light-dark(a, b)` with `a`.
 *
 * draw.io writes both label colours (with `color-scheme: light` on its SVG) that
 * way. A clone serialised into an `<img>` has no stylesheet to resolve them, so
 * the light value — the one that belongs on the white page we export — is
 * committed before serialising. The arguments can contain nested `rgb(...)`, so
 * this walks parentheses rather than splitting on commas.
 */
export function resolveLightDark(value: string): string {
  let out = '';
  let index = 0;

  while (index < value.length) {
    const start = value.indexOf('light-dark(', index);
    if (start === -1) {
      out += value.slice(index);
      break;
    }
    out += value.slice(index, start);

    let depth = 0;
    let close = -1;
    for (let i = start + 'light-dark'.length; i < value.length; i += 1) {
      const char = value[i];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) {
      out += value.slice(start);
      break;
    }

    const inner = value.slice(start + 'light-dark('.length, close);
    let comma = -1;
    let nesting = 0;
    for (let i = 0; i < inner.length; i += 1) {
      const char = inner[i];
      if (char === '(') nesting += 1;
      else if (char === ')') nesting -= 1;
      else if (char === ',' && nesting === 0) {
        comma = i;
        break;
      }
    }

    out += comma === -1 ? inner : inner.slice(0, comma);
    index = close + 1;
  }

  return out;
}

const XLINK = 'http://www.w3.org/1999/xlink';

/**
 * Drop draw.io's collapse/expand handles.
 *
 * A container cell (a swimlane, say) renders a small `[-]` control inside its
 * own `<g>`: an inline SVG image plus a transparent hit rectangle. That is an
 * affordance for whoever edits the diagram, not part of the diagram, so it has
 * no place in a downloaded picture. The match is deliberately narrow — an image
 * beside a `fill="none" stroke="none"` rect — so a real image dropped on the
 * canvas is never mistaken for a control.
 */
function stripControls(root: SVGSVGElement): void {
  for (const group of [...root.querySelectorAll('g')]) {
    const children = [...group.children];
    if (children.length !== 2) continue;

    const image = children.find((child) => child.tagName.toLowerCase() === 'image');
    const hitArea = children.find((child) => child.tagName.toLowerCase() === 'rect');
    if (!image || !hitArea) continue;

    if (hitArea.getAttribute('fill') !== 'none' || hitArea.getAttribute('stroke') !== 'none') continue;

    const href = image.getAttribute('href') ?? image.getAttributeNS(XLINK, 'href') ?? '';
    if (!href.startsWith('data:image/svg+xml')) continue;

    const width = Number(image.getAttribute('width') ?? 0);
    const height = Number(image.getAttribute('height') ?? 0);
    if (!width || !height || width > 16 || height > 16) continue;

    group.remove();
  }
}

function commitColours(root: SVGSVGElement): void {
  // Drops the viewer's `width:100%` styling as a side effect, which is required:
  // the export is sized by its own attributes.
  root.setAttribute('style', 'background-color: #ffffff; color-scheme: light;');

  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of ['style', 'fill', 'stroke', 'color']) {
      const value = element.getAttribute(attribute);
      if (value?.includes('light-dark(')) {
        element.setAttribute(attribute, resolveLightDark(value));
      }
    }
  }
}

async function loadImage(svg: SVGSVGElement, width: number, height: number): Promise<HTMLImageElement> {
  const markup = new XMLSerializer().serializeToString(svg);
  const image = new Image();
  image.width = width;
  image.height = height;
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  try {
    await image.decode();
  } catch {
    throw new Error('The browser could not turn this diagram into an image.');
  }

  return image;
}

/** Rasterise the diagram, without downloading it. */
export async function renderToBlob(
  xml: string,
  options: Pick<ExportOptions, 'format' | 'scale' | 'margin'>,
): Promise<Blob> {
  await loadViewer();

  const natural = diagramSize(xml);
  const host = document.createElement('div');
  // Offscreen but still laid out: GraphViewer measures its container, and
  // `display:none` would measure zero. The padding keeps auto-fit from shrinking
  // a diagram that overflows its shapes (labels on edge midpoints, for example).
  host.style.cssText =
    'position:fixed;left:-200000px;top:0;pointer-events:none;' +
    `width:${Math.ceil(natural.width) + 160}px;height:${Math.ceil(natural.height) + 160}px;`;
  document.body.appendChild(host);

  let teardown: (() => void) | undefined;

  try {
    teardown = renderDiagram(host, xml);
    await nextFrame();
    await nextFrame();

    const svg = host.querySelector('svg');
    if (!svg) throw new Error('The diagram did not render, so there is nothing to export.');

    const bounds = drawingBounds(svg);
    if (!bounds) throw new Error('The diagram has no visible shapes to export.');

    const margin = options.margin ?? DEFAULT_MARGIN;
    const width = Math.ceil(bounds.width + margin * 2);
    const height = Math.ceil(bounds.height + margin * 2);

    const clone = svg.cloneNode(true) as SVGSVGElement;
    stripControls(clone);
    commitColours(clone);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute(
      'viewBox',
      `${Math.round(bounds.x - margin)} ${Math.round(bounds.y - margin)} ${width} ${height}`,
    );
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));

    const image = await loadImage(clone, width, height);

    const scale = Math.max(
      1,
      Math.min(options.scale ?? DEFAULT_SCALE, Math.sqrt(MAX_PIXELS / (width * height))),
    );

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot create a canvas.');

    // JPEG has no alpha, and the preview sits on white, so both formats get the
    // same white page rather than a transparent PNG nobody asked for.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, options.format === 'png' ? 'image/png' : 'image/jpeg', 0.92),
    );
    if (!blob) throw new Error('The browser could not encode the image.');
    return blob;
  } finally {
    teardown?.();
    host.remove();
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  // Firefox ignores a click on an anchor that is not in the document.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking at once cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export async function exportDiagram(xml: string, options: ExportOptions): Promise<void> {
  const blob = await renderToBlob(xml, options);
  downloadBlob(blob, `${options.fileName}.${options.format === 'png' ? 'png' : 'jpg'}`);
}
