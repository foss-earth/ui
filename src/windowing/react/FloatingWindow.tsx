import { useRef, useState, type ReactNode } from "react";

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
}

export interface FloatingWindowClassNames {
  overlay?: string;
  panel?: string;
  body?: string;
  resizeHandle?: string;
  resizeDots?: string;
}

export interface FloatingWindowProps {
  children: ReactNode;
  classNames?: FloatingWindowClassNames;
  minWidth?: number;
  minHeight?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  maxWidthViewportPaddingPx?: number;
  maxHeightViewportPaddingPx?: number;
  resizeClickThresholdPx?: number;
  resizeAriaLabel?: string;
  resizeTitle?: string;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function FloatingWindow(props: FloatingWindowProps) {
  const {
    children,
    classNames,
    minWidth = 400,
    minHeight = 320,
    defaultWidth = 980,
    defaultHeight = 760,
    maxWidthViewportPaddingPx = 48,
    maxHeightViewportPaddingPx = 72,
    resizeClickThresholdPx = 6,
    resizeAriaLabel = "Resize panel, click to toggle size",
    resizeTitle = "Drag to resize; click default size to fullscreen, otherwise reset to default",
  } = props;

  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ResizeDragState | null>(null);

  const maxWidth = () => Math.max(minWidth, window.innerWidth - maxWidthViewportPaddingPx);
  const maxHeight = () => Math.max(minHeight, window.innerHeight - maxHeightViewportPaddingPx);
  const defaultClampedWidth = () => Math.min(defaultWidth, maxWidth());
  const defaultClampedHeight = () => Math.min(defaultHeight, maxHeight());

  const [panelWidth, setPanelWidth] = useState(defaultClampedWidth);
  const [panelHeight, setPanelHeight] = useState(defaultClampedHeight);

  const isDefaultSize = (width: number, height: number): boolean => (
    Math.abs(width - defaultClampedWidth()) < 2
    && Math.abs(height - defaultClampedHeight()) < 2
  );

  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const panelElement = panelRef.current;
    if (!panelElement) return;

    const rect = panelElement.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      pointerId: event.pointerId,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (
      Math.abs(event.clientX - drag.startX) > resizeClickThresholdPx
      || Math.abs(event.clientY - drag.startY) > resizeClickThresholdPx
    ) {
      drag.moved = true;
    }

    const nextW = clampNumber(drag.startW + (event.clientX - drag.startX), minWidth, maxWidth());
    const nextH = clampNumber(drag.startH + (event.clientY - drag.startY), minHeight, maxHeight());
    setPanelWidth(nextW);
    setPanelHeight(nextH);
  };

  const onResizePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.moved) {
      const rect = panelRef.current?.getBoundingClientRect();
      const currentW = rect?.width ?? panelWidth;
      const currentH = rect?.height ?? panelHeight;

      if (isDefaultSize(currentW, currentH)) {
        setPanelWidth(maxWidth());
        setPanelHeight(maxHeight());
      } else {
        setPanelWidth(defaultClampedWidth());
        setPanelHeight(defaultClampedHeight());
      }
    }

    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className={cx("foss-earth-floating-window-overlay", classNames?.overlay)}>
      <div
        ref={panelRef}
        className={cx("foss-earth-floating-window-panel", classNames?.panel)}
        style={{
          width: panelWidth,
          height: panelHeight,
          maxWidth: `calc(100vw - ${maxWidthViewportPaddingPx}px)`,
          maxHeight: `calc(100vh - ${maxHeightViewportPaddingPx}px)`,
        }}
      >
        <div className={cx("foss-earth-floating-window-body", classNames?.body)}>
          {children}
        </div>

        <div
          role="separator"
          aria-label={resizeAriaLabel}
          title={resizeTitle}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          className={cx("foss-earth-floating-window-resize-handle", classNames?.resizeHandle)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 10 10"
            className={cx("foss-earth-floating-window-resize-dots", classNames?.resizeDots)}
            fill="currentColor"
          >
            <circle cx="8" cy="8" r="1.2" />
            <circle cx="5" cy="8" r="1.2" />
            <circle cx="8" cy="5" r="1.2" />
          </svg>
        </div>
      </div>
    </div>
  );
}
