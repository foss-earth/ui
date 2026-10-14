/** Measured placement of a DOM body on the shared canvas, for a pass that draws there. */

export interface SurfaceRect { x: number; y: number; width: number; height: number }

export interface SurfaceGeometry {
  /** Increases whenever any other field changes. */
  revision: number;
  /** The part of the body inside the canvas, in CSS pixels from the canvas's top-left corner. */
  cssRect: SurfaceRect;
  /** The same area in framebuffer pixels from the framebuffer's top-left corner, with whole-pixel edges. */
  framebufferRect: SurfaceRect;
  pixelsPerCssX: number;
  pixelsPerCssY: number;
  /** The body is shown and covers at least one framebuffer pixel. */
  visible: boolean;
}

export type SurfaceGeometryFields = Omit<SurfaceGeometry, "revision">;

interface Box { left: number; top: number; right: number; bottom: number }

/** The canvas as measured: its box on the page and its framebuffer size. */
export interface SurfaceCanvasMeasure { rect: Box; width: number; height: number }

const EMPTY: SurfaceRect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/**
 * Geometry for a body box over a canvas. Both rects are clipped to the canvas.
 * Framebuffer edges are rounded on their own, so bodies that share an edge in
 * CSS share it in pixels with no gap or overlap.
 */
export function surfaceGeometryFields(body: Box | null, canvas: SurfaceCanvasMeasure, shown = true): SurfaceGeometryFields {
  const cssWidth = canvas.rect.right - canvas.rect.left, cssHeight = canvas.rect.bottom - canvas.rect.top;
  const pixelsPerCssX = cssWidth > 0 ? canvas.width / cssWidth : 0;
  const pixelsPerCssY = cssHeight > 0 ? canvas.height / cssHeight : 0;
  if (!body || !shown || pixelsPerCssX <= 0 || pixelsPerCssY <= 0) {
    return { cssRect: EMPTY, framebufferRect: EMPTY, pixelsPerCssX, pixelsPerCssY, visible: false };
  }
  const clamp = (value: number, limit: number): number => Math.min(Math.max(value, 0), limit);
  const left = clamp(body.left - canvas.rect.left, cssWidth), right = clamp(body.right - canvas.rect.left, cssWidth);
  const top = clamp(body.top - canvas.rect.top, cssHeight), bottom = clamp(body.bottom - canvas.rect.top, cssHeight);
  const x0 = Math.round(left * pixelsPerCssX), x1 = Math.round(right * pixelsPerCssX);
  const y0 = Math.round(top * pixelsPerCssY), y1 = Math.round(bottom * pixelsPerCssY);
  const framebufferRect = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  return {
    cssRect: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
    framebufferRect,
    pixelsPerCssX,
    pixelsPerCssY,
    visible: framebufferRect.width > 0 && framebufferRect.height > 0,
  };
}

const sameRect = (a: SurfaceRect, b: SurfaceRect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export function sameSurfaceGeometryFields(a: SurfaceGeometryFields, b: SurfaceGeometryFields): boolean {
  return a.visible === b.visible && a.pixelsPerCssX === b.pixelsPerCssX && a.pixelsPerCssY === b.pixelsPerCssY
    && sameRect(a.cssRect, b.cssRect) && sameRect(a.framebufferRect, b.framebufferRect);
}

export interface SurfaceGeometryPort {
  /** The last committed geometry; drawing and coordinate conversion in one frame use the same one. */
  read(): SurfaceGeometry;
  /** Measures now, commits a new revision when anything changed, and returns what is committed. */
  refresh(): SurfaceGeometry;
  /** Called after each new revision. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

function shownElement(element: Element): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  const check = (element as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  return typeof check === "function" ? check.call(element, { visibilityProperty: true }) : true;
}

/**
 * Observes a body's placement over a canvas. Size changes, page resizes and
 * scrolling commit at once; a move without a resize is found by the next
 * `refresh`, which a frame calls before drawing.
 */
export function observeSurfaceGeometry(element: HTMLElement, canvas: HTMLCanvasElement): SurfaceGeometryPort {
  const view = element.ownerDocument.defaultView;
  const listeners = new Set<() => void>();
  let disposed = false;
  const measure = (): SurfaceGeometryFields => surfaceGeometryFields(
    element.getBoundingClientRect(),
    { rect: canvas.getBoundingClientRect(), width: canvas.width, height: canvas.height },
    shownElement(element),
  );
  let geometry: SurfaceGeometry = Object.freeze({ ...measure(), revision: 0 });
  const refresh = (): SurfaceGeometry => {
    if (disposed) return geometry;
    const next = measure();
    if (sameSurfaceGeometryFields(geometry, next)) return geometry;
    geometry = Object.freeze({ ...next, revision: geometry.revision + 1 });
    for (const listener of [...listeners]) listener();
    return geometry;
  };
  const update = (): void => { refresh(); };
  const Observer = view?.ResizeObserver;
  const observer = typeof Observer === "function" ? new Observer(update) : null;
  observer?.observe(element);
  observer?.observe(canvas);
  view?.addEventListener("resize", update);
  view?.addEventListener("scroll", update, { capture: true, passive: true });
  view?.visualViewport?.addEventListener("resize", update);
  view?.visualViewport?.addEventListener("scroll", update);
  return {
    read: () => geometry,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      observer?.disconnect();
      view?.removeEventListener("resize", update);
      view?.removeEventListener("scroll", update, { capture: true });
      view?.visualViewport?.removeEventListener("resize", update);
      view?.visualViewport?.removeEventListener("scroll", update);
      geometry = Object.freeze({ ...geometry, visible: false, revision: geometry.revision + 1 });
    },
  };
}
