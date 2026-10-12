import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useEscapeToClose } from "./useEscapeToClose.js";
import type { WorldPresentation } from "../../shell/dockLayout.js";

export const PRESENTATION_HOLD_MS = 450;
const HOLD_MOVE_PX = 6;

/**
 * A press that stays still opens `onHold`. Moving past a few pixels, as a tab
 * drag or a window resize does, cancels it. `take` is true for the click that
 * ends the hold, so that click does not also select the tab or minimize the window.
 */
export function usePresentationHold(onHold?: (point: { x: number; y: number }) => void): {
  arm: (x: number, y: number) => void;
  cancel: () => void;
  take: () => boolean;
} {
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const stopListening = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
    stopListening.current?.();
    stopListening.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const arm = useCallback((x: number, y: number) => {
    if (!onHoldRef.current) return;
    held.current = false;
    cancel();
    origin.current = { x, y };
    const onMove = (event: PointerEvent): void => {
      const start = origin.current;
      if (!start) return;
      if (Math.abs(event.clientX - start.x) > HOLD_MOVE_PX || Math.abs(event.clientY - start.y) > HOLD_MOVE_PX) cancel();
    };
    const onUp = (): void => {
      if (timer.current !== null) cancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    stopListening.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      origin.current = null;
      stopListening.current?.();
      stopListening.current = null;
      held.current = true;
      onHoldRef.current?.({ x, y });
    }, PRESENTATION_HOLD_MS);
  }, [cancel]);

  const take = useCallback(() => {
    const value = held.current;
    held.current = false;
    return value;
  }, []);

  return { arm, cancel, take };
}

const SWITCH_MARGIN_PX = 8;
const SWITCH_GAP_PX = 12;

/** Puts the switch above the press, or below it when that would leave the screen. */
export function placePresentationSwitch(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const margin = SWITCH_MARGIN_PX;
  let top = point.y - size.height - SWITCH_GAP_PX;
  if (top < margin) top = point.y + SWITCH_GAP_PX;
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  top = Math.min(Math.max(margin, top), maxTop);
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const left = Math.min(Math.max(margin, point.x - size.width / 2), maxLeft);
  return { left, top };
}

export function PresentationMenu({ point, value, onChange, onClose }: {
  point: { x: number; y: number };
  value: WorldPresentation;
  onChange: (value: WorldPresentation) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useEscapeToClose(true, onClose);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const placeAt = (): void => {
      const rect = menu.getBoundingClientRect();
      setPlace(placePresentationSwitch(point, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight }));
    };
    placeAt();
    window.addEventListener("resize", placeAt);
    return () => window.removeEventListener("resize", placeAt);
  }, [point]);
  const choose = (next: WorldPresentation): void => {
    onChange(next);
    onClose();
  };
  return createPortal(
    <div
      ref={menuRef}
      role="radiogroup"
      aria-label="Windows and the world"
      className="foss-earth-presentation-switch"
      style={{ position: "fixed", left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
    >
      {(["overlay", "split"] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onPointerDown={(event: ReactPointerEvent) => event.stopPropagation()}
          onClick={() => choose(id)}
        >
          {id === "overlay" ? "Overlay" : "Split"}
        </button>
      ))}
    </div>,
    document.body,
  );
}
