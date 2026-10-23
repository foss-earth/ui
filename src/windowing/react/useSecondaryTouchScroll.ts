import { useEffect, useMemo, useRef, type DOMAttributes } from "react";

/** A still touch is a tap until it moves this far, as in useSecondaryTouchClick. */
const SCROLL_SLOP_PX = 8;
/** The finger's speed over its last moments sets how far a flick carries on. */
const VELOCITY_WINDOW_MS = 100;
/** A flick slows as a phone's own scroll does: to about a seventh of its speed in a second. */
const FLING_DECAY_PER_MS = 0.998;
const FLING_MIN_PX_PER_MS = 0.05;
/** Gestures a control takes itself: a slider drags, a text field selects. */
const OWN_GESTURE = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable]:not([contenteditable="false"])';

type Axis = "x" | "y";

interface TouchDrag {
  target: Element;
  x: number;
  y: number;
  axis: Axis | null;
  scroller: HTMLElement | null;
  samples: { time: number; position: number }[];
}

interface Fling {
  scroller: HTMLElement;
  frame: number;
}

function scrollRange(element: HTMLElement, axis: Axis): number {
  return axis === "y" ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
}

/** Whether a `touch-action` value lets a finger pan along the axis. */
function pans(touchAction: string | undefined, axis: Axis): boolean {
  if (!touchAction || touchAction === "auto" || touchAction === "manipulation") return true;
  const words = touchAction.split(/\s+/);
  return axis === "y" ? words.some(word => word === "pan-y" || word === "pan-up" || word === "pan-down")
    : words.some(word => word === "pan-x" || word === "pan-left" || word === "pan-right");
}

/** The nearest element that scrolls along the axis, unless something on the way keeps that pan for itself. */
function scrollerFor(target: Element, axis: Axis): HTMLElement | null {
  const view = target.ownerDocument.defaultView;
  if (!view) return null;
  for (let element: Element | null = target; element && element !== target.ownerDocument.body; element = element.parentElement) {
    const style = view.getComputedStyle(element);
    if (!pans(style.touchAction, axis)) return null;
    if (!(element instanceof HTMLElement)) continue;
    const overflow = axis === "y" ? style.overflowY : style.overflowX;
    if (/auto|scroll|overlay/.test(overflow) && scrollRange(element, axis) > 1) return element;
  }
  return null;
}

function scrollBy(element: HTMLElement, axis: Axis, delta: number): boolean {
  const key = axis === "y" ? "scrollTop" : "scrollLeft";
  const before = element[key];
  element[key] = Math.min(Math.max(before + delta, 0), scrollRange(element, axis));
  return element[key] !== before;
}

/**
 * A browser pans for no finger while another holds a `touch-action: none`
 * control, such as the flight attitude stick. Let a second finger's drag
 * scroll the window under it, flick included, while the first keeps steering.
 *
 * Spread the capture handler once on the window overlay, beside
 * useSecondaryTouchClick: a drag that scrolls never presses what it started
 * on. A browser that pans natively cancels the pointer, and this stops.
 */
export function useSecondaryTouchScroll(): Pick<DOMAttributes<HTMLElement>, "onPointerDownCapture"> {
  const drags = useRef(new Map<number, TouchDrag>());
  const fling = useRef<Fling | null>(null);

  useEffect(() => {
    const active = drags.current;
    const stopFling = (): void => {
      if (fling.current) cancelAnimationFrame(fling.current.frame);
      fling.current = null;
    };
    const startFling = (scroller: HTMLElement, axis: Axis, velocity: number): void => {
      stopFling();
      let last = performance.now();
      const step = (now: number): void => {
        const elapsed = Math.max(0, now - last);
        last = now;
        const moved = scrollBy(scroller, axis, velocity * elapsed);
        velocity *= FLING_DECAY_PER_MS ** elapsed;
        if ((!moved && elapsed > 0) || Math.abs(velocity) < FLING_MIN_PX_PER_MS || !scroller.isConnected) { fling.current = null; return; }
        fling.current = { scroller, frame: requestAnimationFrame(step) };
      };
      fling.current = { scroller, frame: requestAnimationFrame(step) };
    };
    const onMove = (event: PointerEvent): void => {
      const drag = active.get(event.pointerId);
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.axis) {
        if (Math.hypot(dx, dy) < SCROLL_SLOP_PX) return;
        drag.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
        drag.scroller = scrollerFor(drag.target, drag.axis);
        if (!drag.scroller) { active.delete(event.pointerId); return; }
      }
      const position = drag.axis === "y" ? event.clientY : event.clientX;
      const previous = drag.axis === "y" ? drag.y : drag.x;
      drag.x = event.clientX;
      drag.y = event.clientY;
      scrollBy(drag.scroller!, drag.axis, previous - position);
      const now = performance.now();
      drag.samples.push({ time: now, position });
      while (drag.samples.length > 2 && now - drag.samples[0].time > VELOCITY_WINDOW_MS) drag.samples.shift();
    };
    const onUp = (event: PointerEvent): void => {
      const drag = active.get(event.pointerId);
      active.delete(event.pointerId);
      if (!drag?.scroller || !drag.axis || drag.samples.length < 2) return;
      const first = drag.samples[0];
      const last = drag.samples[drag.samples.length - 1];
      // A finger that stopped before lifting leaves the scroll where it is.
      if (performance.now() - last.time > VELOCITY_WINDOW_MS / 2 || last.time <= first.time) return;
      const velocity = (first.position - last.position) / (last.time - first.time);
      if (Math.abs(velocity) >= FLING_MIN_PX_PER_MS) startFling(drag.scroller, drag.axis, velocity);
    };
    const onCancel = (event: PointerEvent): void => { active.delete(event.pointerId); };
    // A touch on a flicked window stops it, as it does a native scroll.
    const onDown = (event: PointerEvent): void => {
      if (fling.current && event.target instanceof Node && fling.current.scroller.contains(event.target)) stopFling();
    };
    const clear = (): void => { active.clear(); stopFling(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", clear);
    };
  }, []);

  return useMemo(() => ({
    onPointerDownCapture(event) {
      // A first finger scrolls natively; only one that joins another needs this.
      if (event.pointerType !== "touch" || event.isPrimary || event.button !== 0) return;
      if (!(event.target instanceof Element) || event.target.closest(OWN_GESTURE)) return;
      drags.current.set(event.pointerId, { target: event.target, x: event.clientX, y: event.clientY, axis: null, scroller: null, samples: [] });
    },
  }), []);
}
