import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PANEL_HANDLE_OVERFLOW_PX } from "../windowing/react/panelHeight.js";

const MIN_HEIGHT = 128;
/** Space kept clear under a joined body: the toolbar on a floating layout, some world under a band. */
const BOTTOM_CLEARANCE = { overlay: 12, split: 80 };

interface Box { left: number; top: number; width: number }

export interface JoinedSurfaceProps {
  /** The overlay that holds both windows; the body is placed in its coordinates. */
  overlay: HTMLElement;
  /** The group's height for this join, or null to start at the usable height under the tab strips. */
  height: number | null;
  onHeightChange(height: number): void;
  /** The top of what the host draws over the bottom of the screen, such as a toolbar. */
  menuBottom(): number | null | undefined;
  presentation: "overlay" | "split";
  /** Split paints the grip above the toolbar, as a window's own grip. */
  liftResizeHandle: boolean;
  children?: ReactNode;
}

function panels(overlay: HTMLElement): [HTMLElement, HTMLElement] | null {
  const left = overlay.querySelector<HTMLElement>('.foss-earth-dock-panel[data-side="left"]');
  const right = overlay.querySelector<HTMLElement>('.foss-earth-dock-panel[data-side="right"]');
  return left && right ? [left, right] : null;
}

/** Where the body goes: from the left window's left edge to the right one's right edge, under the lower tab strip. */
function measure(overlay: HTMLElement): Box | null {
  const found = panels(overlay);
  if (!found) return null;
  const origin = overlay.getBoundingClientRect();
  const [left, right] = found.map(panel => panel.getBoundingClientRect());
  return {
    left: left.left - origin.left,
    top: Math.max(left.bottom, right.bottom) - origin.top,
    width: right.right - left.left,
  };
}

/**
 * One body for two windows whose selected tabs are joined surfaces. It spans
 * both columns and the space between them, starts under the tab strips, and
 * has its own height for the length of the join; the windows keep theirs.
 */
export function JoinedSurface({ overlay, height, onHeightChange, menuBottom, presentation, liftResizeHandle, children }: JoinedSurfaceProps) {
  const [box, setBox] = useState<Box | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const gripRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number; resizing: boolean } | null>(null);
  const view = overlay.ownerDocument.defaultView;

  const viewportHeight = (): number => view?.visualViewport?.height ?? view?.innerHeight ?? 0;
  const origin = (): number => overlay.getBoundingClientRect().top;
  /** The tallest the group may be with its grip still on screen. */
  const cap = (top: number): number => Math.max(MIN_HEIGHT, viewportHeight() - origin() - top - PANEL_HANDLE_OVERFLOW_PX);
  const usable = (top: number): number => {
    const bottom = presentation === "overlay" ? menuBottom() : null;
    const limit = typeof bottom === "number" && bottom - origin() > top ? bottom - origin() : viewportHeight() - origin();
    return Math.min(cap(top), Math.max(MIN_HEIGHT, limit - BOTTOM_CLEARANCE[presentation] - top));
  };

  useLayoutEffect(() => {
    const update = (): void => {
      const next = measure(overlay);
      setBox(current => (
        current && next && current.left === next.left && current.top === next.top && current.width === next.width ? current : next
      ));
    };
    update();
    const Observer = view?.ResizeObserver;
    const observer = typeof Observer === "function" ? new Observer(update) : null;
    observer?.observe(overlay);
    for (const panel of panels(overlay) ?? []) observer?.observe(panel);
    view?.addEventListener("resize", update);
    view?.visualViewport?.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      view?.removeEventListener("resize", update);
      view?.visualViewport?.removeEventListener("resize", update);
    };
  }, [overlay, view]);

  // The first measured top sets the height for this join; later, the screen only caps it.
  useLayoutEffect(() => {
    if (!box) return;
    if (height === null) onHeightChange(usable(box.top));
    else if (height > cap(box.top) && viewportHeight() > 0) onHeightChange(cap(box.top));
  });
  useLayoutEffect(() => {
    if (!view) return;
    const clamp = (): void => {
      const next = measure(overlay);
      if (next && height !== null && height > cap(next.top)) onHeightChange(cap(next.top));
    };
    view.addEventListener("resize", clamp);
    view.visualViewport?.addEventListener("resize", clamp);
    return () => {
      view.removeEventListener("resize", clamp);
      view.visualViewport?.removeEventListener("resize", clamp);
    };
  });

  // As a window's lifted grip: centered on the bottom edge, above the toolbar.
  useLayoutEffect(() => {
    const grip = gripRef.current, element = elementRef.current;
    if (!liftResizeHandle || !grip || !element) return;
    const rect = element.getBoundingClientRect();
    grip.style.left = `${rect.left + rect.width / 2 - 12}px`;
    grip.style.top = `${rect.bottom - 12}px`;
  });

  const finish = (): void => {
    if (drag.current?.resizing) view?.dispatchEvent(new Event("foss-earth-panel-resize-end"));
    drag.current = null;
  };
  const grip = box && height !== null ? (
    <div
      ref={gripRef}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize images"
      title="Drag to resize"
      className="foss-earth-dock-panel-resize-handle foss-earth-joined-surface-resize-handle"
      data-axes="height"
      data-lifted={liftResizeHandle ? "true" : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height, resizing: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (!current.resizing) {
          current.resizing = true;
          view?.dispatchEvent(new Event("foss-earth-panel-resize-start"));
        }
        onHeightChange(Math.max(MIN_HEIGHT, Math.min(cap(box.top), current.startHeight + event.clientY - current.startY)));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        finish();
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) finish(); }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" className="foss-earth-dock-panel-resize-dots" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2.5v11M5.5 5 8 2.5 10.5 5M5.5 11 8 13.5 10.5 11" />
      </svg>
    </div>
  ) : null;

  return (
    <div
      ref={elementRef}
      className="foss-earth-joined-surface"
      data-occlude-world=""
      style={box && height !== null
        ? { position: "absolute", left: box.left, top: box.top, width: box.width, height }
        : { position: "absolute", visibility: "hidden" }}
    >
      <div className="foss-earth-joined-surface-body">{box && height !== null ? children : null}</div>
      {grip && liftResizeHandle ? createPortal(grip, overlay.ownerDocument.body) : grip}
    </div>
  );
}
