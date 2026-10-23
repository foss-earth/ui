import { useEffect, useMemo, useRef, type DOMAttributes } from "react";

/** A swipe or a scroll must not turn into a button press on release. */
const TAP_MOVE_PX = 8;
const COMPATIBILITY_CLICK_MS = 800;
const CLICKABLE = 'button, input[type="checkbox"], input[type="radio"], a[href], summary';

interface TouchPress {
  element: HTMLElement;
  area: HTMLElement;
  x: number;
  y: number;
  moved: boolean;
}

interface CompatibilityClick {
  pointerId: number;
  x: number;
  y: number;
  until: number;
}

function clickable(target: EventTarget | null): { element: HTMLElement; area: HTMLElement } | null {
  if (!(target instanceof Element)) return null;
  const direct = target.closest<HTMLElement>(CLICKABLE);
  const label = direct ? null : target.closest("label");
  const element = direct ?? label?.control;
  const area = direct ?? label;
  return element instanceof HTMLElement && area && element.matches(CLICKABLE) && !element.matches(":disabled")
    && !element.closest('[aria-disabled="true"], [inert]') && !area.closest('[aria-disabled="true"], [inert]')
    ? { element, area } : null;
}

function moved(press: TouchPress, event: { clientX: number; clientY: number }): boolean {
  return Math.hypot(event.clientX - press.x, event.clientY - press.y) >= TAP_MOVE_PX;
}

/**
 * Native compatibility clicks are not guaranteed for the second finger. Let a
 * still secondary touch activate the same native control as a mouse/keyboard
 * click, while the primary finger keeps steering or dragging elsewhere.
 *
 * Spread these capture handlers once on the window overlay. React portals are
 * included, so tab menus work too. Text/range/select gestures remain native.
 */
export function useSecondaryTouchClick(): Pick<DOMAttributes<HTMLElement>, "onPointerDownCapture" | "onClickCapture"> {
  const presses = useRef(new Map<number, TouchPress>());
  const compatibilityClicks = useRef(new Map<HTMLElement, CompatibilityClick>());
  const forwarding = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const pending = presses.current;
    const compatibility = compatibilityClicks.current;
    const clear = (): void => { pending.clear(); compatibility.clear(); };
    const onMove = (event: PointerEvent): void => {
      const press = pending.get(event.pointerId);
      if (press && moved(press, event)) press.moved = true;
    };
    const onCancel = (event: PointerEvent): void => { pending.delete(event.pointerId); };
    const onScroll = (event: Event): void => {
      for (const [pointerId, press] of pending) {
        const target = event.target;
        if (target === document || target instanceof Element && target.contains(press.area)) pending.delete(pointerId);
      }
    };
    const onUp = (event: PointerEvent): void => {
      const press = pending.get(event.pointerId);
      if (!press) return;
      pending.delete(event.pointerId);
      const element = press.element;
      if (press.moved || moved(press, event) || !element.isConnected || !press.area.isConnected || clickable(element)?.element !== element) return;
      const rect = press.area.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      compatibility.set(element, {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        until: performance.now() + COMPATIBILITY_CLICK_MS,
      });
      event.preventDefault();
      element.focus({ preventScroll: true });
      forwarding.current = element;
      try { element.click(); } finally { forwarding.current = null; }
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("lostpointercapture", onCancel, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      document.removeEventListener("lostpointercapture", onCancel, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", clear);
    };
  }, []);

  return useMemo(() => ({
    onPointerDownCapture(event) {
      const target = clickable(event.target);
      const element = target?.element;
      for (const [control, previous] of compatibilityClicks.current) {
        if (performance.now() > previous.until || !control.isConnected) compatibilityClicks.current.delete(control);
      }
      // A new deliberate press must never be mistaken for a delayed click
      // from an earlier secondary touch, including a primary touch or mouse.
      if (element) compatibilityClicks.current.delete(element);
      if (event.pointerType !== "touch" || event.isPrimary || event.button !== 0 || !element || !target) return;
      presses.current.set(event.pointerId, { element, area: target.area, x: event.clientX, y: event.clientY, moved: false });
    },
    onClickCapture(event) {
      const element = clickable(event.target)?.element;
      if (!element || forwarding.current === element) return;
      const previous = compatibilityClicks.current.get(element);
      if (!previous) return;
      if (performance.now() > previous.until) { compatibilityClicks.current.delete(element); return; }
      const native = event.nativeEvent as MouseEvent & Partial<Pick<PointerEvent, "pointerType" | "pointerId">> & {
        sourceCapabilities?: { firesTouchEvents: boolean } | null;
      };
      // Newer browsers identify the touch. Older ones expose a mouse-shaped
      // compatibility click; detail 0 is a keyboard/programmatic activation.
      const duplicate = native.pointerType === "touch"
        ? native.pointerId === previous.pointerId
        : !native.pointerType && native.detail > 0 && native.sourceCapabilities?.firesTouchEvents !== false
          && Math.hypot(native.clientX - previous.x, native.clientY - previous.y) < TAP_MOVE_PX;
      if (!duplicate) return;
      compatibilityClicks.current.delete(element);
      event.preventDefault();
      event.stopPropagation();
    },
  }), []);
}
