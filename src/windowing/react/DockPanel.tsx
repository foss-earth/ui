import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { panelHeightLimit } from "./panelHeight.js";
import { usePresentationHold } from "./presentationHold.js";

function cx(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

interface ResizeDragState {
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  pointerId: number;
  moved: boolean;
  /** The pointer has moved far enough that this drag is resizing, not a click. */
  resizing: boolean;
  fitKey: string | number | null;
}

interface ContentFitState {
  key: string | number;
  measuredHeight: number | null;
  manualHeight: number | null;
}

/** The grip's arrows, centered in a 16 px box: a corner grip's run from its corner along the two edges it moves. */
const RESIZE_ICON_PATHS = {
  left: "M10.75 2.75v8h-8M8.25 5.25l2.5-2.5 2.5 2.5M5.25 8.25l-2.5 2.5 2.5 2.5",
  right: "M5.25 2.75v8h8M2.75 5.25l2.5-2.5 2.5 2.5M10.75 8.25l2.5 2.5-2.5 2.5",
  height: "M8 2.5v11M5.5 5 8 2.5 10.5 5M5.5 11 8 13.5 10.5 11",
};

export interface DockPanelClassNames {
  container?: string;
  expanded?: string;
  collapsed?: string;
  raisedZ?: string;
  defaultZ?: string;
  header?: string;
  headerExpanded?: string;
  headerCollapsed?: string;
  body?: string;
  resizeHandle?: string;
  resizeHandleForLeftPanel?: string;
  resizeHandleForRightPanel?: string;
  resizeDots?: string;
}

export interface DockPanelProps {
  side: "left" | "right";
  width: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  addMenuOpen?: boolean;
  header?: ReactNode;
  children?: ReactNode;
  classNames?: DockPanelClassNames;
  topOffsetPx?: number | string;
  edgeOffsetPx?: number;
  expandedMaxHeightCss?: string;
  minWidth?: number;
  minHeight?: number;
  initialHeight?: number;
  /** A temporary height for one content visit; its measurer returns the desired body height. */
  contentFit?: { key: string | number; measure(body: HTMLElement): number | null };
  maxHeightPaddingPx?: number;
  /** Extra ceiling as a fraction of the visual viewport, such as half a phone. */
  maxHeightRatio?: number;
  resizeClickThresholdPx?: number;
  resizeAriaLabel?: string;
  resizeTitle?: string;
  /** "height" for a panel as wide as the screen: its grip sits mid-bottom and changes only the height. */
  resizeAxes?: "both" | "height";
  /** Split paints the grip above the toolbar. The toolbar otherwise covers the half that sits on the window. */
  liftResizeHandle?: boolean;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  /** A still press on the resize grip. Moving resizes, as before. */
  onHoldPresentation?: (point: { x: number; y: number }) => void;
}

export function DockPanel(props: DockPanelProps) {
  const {
    side,
    width,
    maxWidth,
    onWidthChange,
    collapsed,
    onCollapsedChange,
    addMenuOpen = false,
    header,
    children,
    classNames,
    topOffsetPx,
    edgeOffsetPx = 6,
    expandedMaxHeightCss,
    minWidth = 160,
    minHeight = 128,
    initialHeight = 512,
    contentFit,
    maxHeightPaddingPx = 80,
    maxHeightRatio,
    resizeClickThresholdPx = 6,
    resizeAriaLabel = "Resize panel, click to minimize",
    resizeTitle = "Drag to resize, click to minimize",
    resizeAxes = "both",
    liftResizeHandle = false,
    onDragOver,
    onDrop,
    onHoldPresentation,
  } = props;
  const hold = usePresentationHold(onHoldPresentation);

  const isRightPanel = side === "right";
  // Overlay sits 6px from the screen corner. Split passes its own offsets.
  const resolvedTop = topOffsetPx ?? 6;
  const resolvedMaxHeight = expandedMaxHeightCss ?? `calc(100dvh - ${maxHeightPaddingPx}px)`;
  const topPx = typeof resolvedTop === "number" ? resolvedTop : 0;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const heightLimit = (): number => {
    const view = containerRef.current?.ownerDocument.defaultView;
    const viewport = view?.visualViewport?.height ?? view?.innerHeight ?? 0;
    if (viewport <= 0) return Number.POSITIVE_INFINITY;
    const cap = maxHeightRatio && viewport > 0 ? viewport * maxHeightRatio : undefined;
    return panelHeightLimit(viewport, topPx, maxHeightPaddingPx, minHeight, cap);
  };
  const finishResize = (drag: ResizeDragState | null) => {
    if (!drag?.resizing) return;
    drag.resizing = false;
    containerRef.current?.ownerDocument.defaultView?.dispatchEvent(new Event("foss-earth-panel-resize-end"));
  };
  const headerRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ResizeDragState | null>(null);
  const gripRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const [fitState, setFitState] = useState<ContentFitState | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const fitKey = contentFit?.key;
  const measureFit = contentFit?.measure;
  useLayoutEffect(() => {
    const panel = containerRef.current, body = bodyRef.current;
    if (collapsed || fitKey === undefined || !measureFit || !panel || !body) return;
    const view = panel.ownerDocument.defaultView;
    if (!view) return;
    const measure = (): void => {
      const bodyHeight = measureFit(body);
      if (bodyHeight === null || !Number.isFinite(bodyHeight) || bodyHeight <= 0) return;
      const style = view.getComputedStyle(panel);
      const borders = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
      const measuredHeight = Math.ceil(bodyHeight + (headerRef.current?.getBoundingClientRect().height ?? 0) + borders);
      setFitState(current => {
        if (current?.key === fitKey && (current.manualHeight !== null || current.measuredHeight === measuredHeight)) return current;
        return { key: fitKey, measuredHeight, manualHeight: null };
      });
    };
    // Children keep their natural height inside the scrolling body, even when the panel is capped.
    const resize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(measure) : null;
    const observeContent = (): void => {
      resize?.disconnect();
      for (const child of body.children) resize?.observe(child);
      if (headerRef.current) resize?.observe(headerRef.current);
    };
    const mutations = new view.MutationObserver(() => { observeContent(); measure(); });
    mutations.observe(body, { childList: true, subtree: true, characterData: true, attributes: true });
    observeContent();
    measure();
    view.addEventListener("resize", measure);
    return () => { resize?.disconnect(); mutations.disconnect(); view.removeEventListener("resize", measure); };
  }, [collapsed, fitKey, measureFit, width]);

  useLayoutEffect(() => {
    if (collapsed) return;
    const view = containerRef.current?.ownerDocument.defaultView;
    if (!view) return;
    const clamp = (): void => {
      const maxH = heightLimit();
      if (!Number.isFinite(maxH)) return;
      setPanelHeight((height) => (height > maxH ? maxH : height));
      setFitState((current) => (
        current?.manualHeight != null && current.manualHeight > maxH ? { ...current, manualHeight: maxH } : current
      ));
    };
    clamp();
    view.addEventListener("resize", clamp);
    view.document.addEventListener("fullscreenchange", clamp);
    view.visualViewport?.addEventListener("resize", clamp);
    return () => {
      view.removeEventListener("resize", clamp);
      view.document.removeEventListener("fullscreenchange", clamp);
      view.visualViewport?.removeEventListener("resize", clamp);
    };
  }, [collapsed, maxHeightPaddingPx, maxHeightRatio, minHeight, topPx]);

  useEffect(() => {
    const handleDragStart = (event: Event) => {
      const sourceSide = (event as CustomEvent<{ side?: "left" | "right" }>).detail?.side;
      setDragActive(sourceSide !== side);
    };
    const handleDragEnd = () => setDragActive(false);

    window.addEventListener("foss-earth-tab-drag-start", handleDragStart);
    window.addEventListener("foss-earth-tab-drag-end", handleDragEnd);
    return () => {
      window.removeEventListener("foss-earth-tab-drag-start", handleDragStart);
      window.removeEventListener("foss-earth-tab-drag-end", handleDragEnd);
    };
  }, [side]);

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const panelElement = containerRef.current;
    if (!panelElement) return;

    const rect = panelElement.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      pointerId: event.pointerId,
      moved: false,
      resizing: false,
      fitKey: contentFit?.key ?? null,
    };

    hold.arm(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (
      Math.abs(event.clientX - drag.startX) > resizeClickThresholdPx
      || Math.abs(event.clientY - drag.startY) > resizeClickThresholdPx
    ) {
      if (!drag.resizing) {
        drag.resizing = true;
        containerRef.current?.ownerDocument.defaultView?.dispatchEvent(new Event("foss-earth-panel-resize-start"));
      }
      drag.moved = true;
      hold.cancel();
    }

    if (resizeAxes === "both") {
      const deltaX = event.clientX - drag.startX;
      const rawW = drag.startW + (isRightPanel ? -deltaX : deltaX);
      if (rawW < minWidth) {
        finishResize(drag);
        onCollapsedChange(true);
        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        return;
      }
      onWidthChange(Math.min(Math.max(minWidth, maxWidth), rawW));
    }

    const maxH = heightLimit();
    const resizedHeight = Math.max(minHeight, Math.min(maxH, drag.startH + (event.clientY - drag.startY)));
    const resizeFitKey = drag.fitKey;
    if (resizeFitKey !== null) {
      if (drag.moved) setFitState(current => ({
        key: resizeFitKey,
        measuredHeight: current?.key === resizeFitKey ? current.measuredHeight : null,
        manualHeight: resizedHeight,
      }));
    } else setPanelHeight(resizedHeight);
  };

  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const wasHold = hold.take();
    if (!drag.moved && !wasHold) onCollapsedChange(true);
    finishResize(drag);

    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  // The browser took the pointer, as for a page gesture: the drag ends where it is, and it was no click.
  const onHandlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    finishResize(drag);
    dragRef.current = null;
  };

  useLayoutEffect(() => {
    const grip = gripRef.current;
    const panel = containerRef.current;
    if (!liftResizeHandle || !grip || !panel) return;
    const place = (): void => {
      const rect = panel.getBoundingClientRect();
      const size = 24;
      const hang = 13;
      // The circle is centered on the panel's bottom border, matching the in-panel grip.
      const top = rect.bottom - size / 2;
      const left = resizeAxes === "height"
        ? rect.left + rect.width / 2 - size / 2
        : side === "right"
          ? rect.left - hang
          : rect.right - (size - hang);
      grip.style.left = `${left}px`;
      grip.style.top = `${top}px`;
    };
    place();
    const view = panel.ownerDocument.defaultView;
    const Observer = view?.ResizeObserver;
    const observer = typeof Observer === "function" ? new Observer(place) : null;
    observer?.observe(panel);
    view?.addEventListener("resize", place);
    view?.visualViewport?.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      view?.removeEventListener("resize", place);
      view?.visualViewport?.removeEventListener("resize", place);
      grip.style.left = "";
      grip.style.top = "";
    };
  }, [liftResizeHandle, resizeAxes, side, collapsed, panelHeight, width]);

  const positionStyle: CSSProperties = {
    position: "absolute",
    top: resolvedTop,
    ...(isRightPanel ? { right: edgeOffsetPx } : { left: edgeOffsetPx }),
  };

  const expandedStyle: CSSProperties = collapsed
    ? { maxWidth: width }
    : {
        width,
        height: contentFit && fitState?.key === contentFit.key ? fitState.manualHeight ?? fitState.measuredHeight ?? panelHeight : panelHeight,
        maxWidth,
        maxHeight: resolvedMaxHeight,
      };

  return (
    <div
      ref={containerRef}
      className={cx(
        "foss-earth-dock-panel",
        dragActive && "foss-earth-dock-panel-drop-active",
        classNames?.container,
        addMenuOpen ? classNames?.raisedZ : classNames?.defaultZ,
        collapsed ? classNames?.collapsed : classNames?.expanded,
      )}
      style={{
        ...positionStyle,
        ...expandedStyle,
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-side={side}
      data-collapsed={collapsed ? "true" : "false"}
      data-occlude-world=""
    >
      {/* The contents clip to the rounded corners; the grip sits across the edge, outside this. */}
      <div className="foss-earth-dock-panel-clip">
        {header ? (
          <div
            ref={headerRef}
            className={cx(
              "foss-earth-dock-panel-header",
              classNames?.header,
              collapsed ? classNames?.headerCollapsed : classNames?.headerExpanded,
            )}
          >
            {header}
          </div>
        ) : null}

        {collapsed ? null : (
          <div ref={bodyRef} className={cx("foss-earth-dock-panel-body", classNames?.body)}>
            {children}
          </div>
        )}
      </div>

      {collapsed ? null : (() => {
        const handle = (
          <div
            ref={gripRef}
            role="separator"
            aria-label={resizeAriaLabel}
            title={resizeTitle}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
            onContextMenu={onHoldPresentation ? (event) => event.preventDefault() : undefined}
            data-axes={resizeAxes}
            data-side={side}
            data-lifted={liftResizeHandle ? "true" : undefined}
            className={cx(
              "foss-earth-dock-panel-resize-handle",
              classNames?.resizeHandle,
              isRightPanel ? classNames?.resizeHandleForRightPanel : classNames?.resizeHandleForLeftPanel,
            )}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              className={cx("foss-earth-dock-panel-resize-dots", classNames?.resizeDots)}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={RESIZE_ICON_PATHS[resizeAxes === "height" ? "height" : side]} />
            </svg>
          </div>
        );
        return liftResizeHandle ? createPortal(handle, containerRef.current?.ownerDocument.body ?? document.body) : handle;
      })()}
    </div>
  );
}
