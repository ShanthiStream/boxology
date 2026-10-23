/**
 * draw.io viewer integration.
 *
 * The iframe approach (`viewer.diagrams.net/#R<compressed>`) is the obvious one
 * and the wrong one here: the diagram has to survive a URL, so large diagrams
 * get truncated by the browser, and the viewer's own chrome fights our layout.
 * `viewer-static.min.js` exposes GraphViewer, which draws into a container we
 * own — the same mechanism draw.io's own MCP app server uses.
 *
 * The bundle is vendored in `public/vendor/`, not loaded from the draw.io CDN.
 * A local-first tool should not tell a third party what diagrams you are
 * looking at, and PNG/JPEG export has to work with the network unplugged. The
 * bundle still defaults its optional stencil/math paths to diagrams.net, so a
 * diagram built from AWS/Azure icon libraries would fetch those on demand;
 * Boxology's own output is text and standard shapes, which are inline.
 */

const VIEWER_SRC = '/vendor/viewer-static.min.js';

/**
 * White margin kept around the drawing, in diagram units.
 *
 * draw.io calls this `border` and applies it once per side, so the sheet that
 * holds a diagram is its measured bounds plus twice this. The preview uses the
 * same constant to size that sheet before the viewer has drawn anything.
 */
export const DIAGRAM_BORDER = 40;

export interface GraphViewerOptions {
  nav?: boolean;
  resize?: boolean;
  border?: number;
  'auto-fit'?: boolean;
  'auto-crop'?: boolean;
  'toolbar-nohide'?: boolean;
  zoom?: number;
  lightbox?: boolean;
}

declare global {
  interface Window {
    mxUtils?: { parseXml: (xml: string) => XMLDocument };
    GraphViewer?: new (
      container: HTMLElement,
      xml: Element,
      options?: GraphViewerOptions,
    ) => { destroy?: () => void; graph?: ViewerGraph };
  }
}

/** The slice of mxGraph the preview drives directly. */
interface ViewerGraph {
  centerZoom: boolean;
  zoomTo: (scale: number) => void;
}

/** A live render, plus the one control the preview needs over it. */
export interface DiagramViewer {
  destroy: () => void;
  /**
   * Scale the drawing. `1` is 100%; the caller is responsible for resizing the
   * sheet it sits on, because the render itself does not grow.
   */
  setZoom: (scale: number) => void;
}

let pending: Promise<void> | null = null;

export function loadViewer(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.GraphViewer) return Promise.resolve();
  if (pending) return pending;

  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = VIEWER_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Could not load the bundled draw.io viewer. Rebuild the app and reload.'));
    document.head.appendChild(script);
  });

  // A failed load should be retryable rather than permanently cached.
  pending.catch(() => {
    pending = null;
  });

  return pending;
}

export function renderDiagram(container: HTMLElement, xml: string): DiagramViewer {
  if (!window.GraphViewer || !window.mxUtils) throw new Error('Viewer not loaded');

  // GraphViewer reads `xml.ownerDocument`, so it needs a DOM element. Passing
  // the XML string (as most examples online do) throws an XMLSerializer error.
  const node = window.mxUtils.parseXml(xml).documentElement;

  container.replaceChildren();

  const viewer = new window.GraphViewer(container, node, {
    nav: true,
    resize: true,
    border: DIAGRAM_BORDER,
    lightbox: false,
  });

  const graph = viewer.graph;

  return {
    destroy() {
      try {
        viewer.destroy?.();
      } catch {
        // viewer already torn down
      }
      container.replaceChildren();
    },

    setZoom(scale) {
      if (!graph) return;
      // draw.io keeps the *centre* of the drawing in place while zooming. That
      // walks the diagram off the sheet we sized for it, so zoom from the origin
      // instead: every scale then lays out exactly like 100%, just larger.
      graph.centerZoom = false;
      graph.zoomTo(scale);
    },
  };
}

/**
 * Natural size of a diagram, used to size the sheet it is drawn on.
 *
 * GraphViewer renders at 1:1 and caps zoom-in at 100%, so a small diagram on a
 * full-pane canvas sits in a corner of a huge white page. Sizing the sheet to
 * the content keeps the diagram filling its frame at any diagram size; when the
 * sheet is larger than the pane, the pane scrolls rather than clipping it.
 *
 * Only children of the root layer are measured: nested cells store coordinates
 * relative to their parent, so including them would inflate the bounds.
 */
export function diagramSize(xml: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  let maxX = 0;
  let maxY = 0;

  for (const cell of doc.querySelectorAll('mxCell[vertex="1"]')) {
    if (cell.getAttribute('parent') !== '1') continue;
    const geometry = cell.querySelector('mxGeometry');
    if (!geometry) continue;

    const x = Number(geometry.getAttribute('x') ?? 0);
    const y = Number(geometry.getAttribute('y') ?? 0);
    const width = Number(geometry.getAttribute('width') ?? 0);
    const height = Number(geometry.getAttribute('height') ?? 0);
    if (!Number.isFinite(x + width) || !Number.isFinite(y + height)) continue;

    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return { width: Math.max(maxX, 240), height: Math.max(maxY, 160) };
}
