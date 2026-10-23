/**
 * A pointer the page does not have: a headset's laser on a panel, or a tap on
 * a cockpit's screen, played on the page's own interface at a point of its
 * viewport. The page's handlers get the events a mouse would give them, in
 * the same order: over and out, down, move and up, then the click, with
 * pointer capture kept for this pointer as for a real one. A native range
 * input follows the pointer while it is held, as it would under a finger.
 *
 * Not reached: a native select's list, which opens only for the browser's own
 * input, and typing into a text box, which needs a keyboard. `:hover` styles
 * stay off, as no real pointer is over the element.
 */

export interface DomPointerOptions {
  document: Document;
  /** False lets the pointer pass through an element and what is in it, as `pointer-events: none` does. */
  include?(element: Element): boolean;
  /** As the page's handlers see it. A laser hovers, as a mouse does: "mouse" by default. */
  pointerType?: "mouse" | "pen" | "touch";
  /** Whether this is the primary pointer of its type; a second hand is not. */
  primary?: boolean;
}

export interface DomPointer {
  /** The element the pointer is over, or null when it is off the page's interface. */
  readonly hovered: Element | null;
  /** Whether a button is held. */
  readonly pressed: boolean;
  /** The page's element at a point of the viewport in CSS px, for the pointer, or null where the interface lets it through. */
  hit(x: number, y: number): Element | null;
  /** Moves the pointer to a point of the viewport, in CSS px; returns what it is over. */
  move(x: number, y: number): Element | null;
  /** Presses a button there; returns what it pressed, or null when the press is not on the interface. */
  down(x: number, y: number, button?: number): Element | null;
  /** Lets the button go there: the page sees the click on what it was pressed on. */
  up(x: number, y: number, button?: number): void;
  /** Scrolls there by CSS px. What does not handle it scrolls as a wheel would. */
  wheel(x: number, y: number, deltaX: number, deltaY: number): void;
  /** The pointer left the page's interface; a held button is cancelled. */
  leave(): void;
  dispose(): void;
}

/** The pointer ids a page's handlers see, far above any the browser gives. */
const FIRST_POINTER_ID = 0x4f53_0000;
let nextPointerId = FIRST_POINTER_ID;

/** Pointer capture as the page asks for it on these pointers, which the browser does not know. */
interface CaptureRegistry {
  captured: Map<number, Element>;
  ours: Set<number>;
  restore(): void;
}
const registries = new WeakMap<Window, CaptureRegistry>();

function captureRegistry(view: Window & typeof globalThis): CaptureRegistry {
  const existing = registries.get(view);
  if (existing) return existing;
  const prototype = view.Element.prototype;
  const names = ["setPointerCapture", "releasePointerCapture", "hasPointerCapture"] as const;
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(prototype, name));
  const original = {
    set: prototype.setPointerCapture,
    release: prototype.releasePointerCapture,
    has: prototype.hasPointerCapture,
  };
  const registry: CaptureRegistry = {
    captured: new Map(),
    ours: new Set(),
    restore() {
      names.forEach((name, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(prototype, name, descriptor);
        else delete (prototype as Partial<Element>)[name];
      });
      registries.delete(view);
    },
  };
  prototype.setPointerCapture = function (this: Element, pointerId: number) {
    if (!registry.ours.has(pointerId)) return original.set?.call(this, pointerId);
    const previous = registry.captured.get(pointerId);
    if (previous === this) return;
    registry.captured.set(pointerId, this);
    if (previous) previous.dispatchEvent(pointerEvent(view, "lostpointercapture", pointerId, {}));
    this.dispatchEvent(pointerEvent(view, "gotpointercapture", pointerId, {}));
  };
  prototype.releasePointerCapture = function (this: Element, pointerId: number) {
    if (!registry.ours.has(pointerId)) return original.release?.call(this, pointerId);
    if (registry.captured.get(pointerId) !== this) return;
    registry.captured.delete(pointerId);
    this.dispatchEvent(pointerEvent(view, "lostpointercapture", pointerId, {}));
  };
  prototype.hasPointerCapture = function (this: Element, pointerId: number) {
    if (!registry.ours.has(pointerId)) return original.has?.call(this, pointerId) ?? false;
    return registry.captured.get(pointerId) === this;
  };
  registries.set(view, registry);
  return registry;
}

interface PointerDetail { x?: number; y?: number; button?: number; buttons?: number; pointerType?: string; primary?: boolean; bubbles?: boolean; cancelable?: boolean; relatedTarget?: Element | null }

function pointerEvent(view: Window & typeof globalThis, type: string, pointerId: number, detail: PointerDetail): Event {
  const init = {
    bubbles: detail.bubbles ?? !["pointerenter", "pointerleave"].includes(type),
    cancelable: detail.cancelable ?? !["pointerenter", "pointerleave", "gotpointercapture", "lostpointercapture", "pointercancel"].includes(type),
    composed: true,
    clientX: detail.x ?? 0, clientY: detail.y ?? 0, screenX: detail.x ?? 0, screenY: detail.y ?? 0,
    button: detail.button ?? -1, buttons: detail.buttons ?? 0,
    relatedTarget: detail.relatedTarget ?? null,
    pointerId, pointerType: detail.pointerType ?? "mouse", isPrimary: detail.primary ?? true,
    width: 1, height: 1, pressure: (detail.buttons ?? 0) ? 0.5 : 0,
  };
  // Where there is no PointerEvent, a MouseEvent carrying a pointer's fields stands in.
  if (typeof view.PointerEvent === "function") return new view.PointerEvent(type, init);
  const event = new view.MouseEvent(type, init);
  for (const key of ["pointerId", "pointerType", "isPrimary", "width", "height", "pressure"] as const) {
    Object.defineProperty(event, key, { value: init[key] });
  }
  return event;
}

function mouseEvent(view: Window & typeof globalThis, type: string, detail: PointerDetail): MouseEvent {
  return new view.MouseEvent(type, {
    bubbles: !["mouseenter", "mouseleave"].includes(type), cancelable: !["mouseenter", "mouseleave"].includes(type), composed: true,
    clientX: detail.x ?? 0, clientY: detail.y ?? 0, screenX: detail.x ?? 0, screenY: detail.y ?? 0,
    button: Math.max(0, detail.button ?? 0), buttons: detail.buttons ?? 0, detail: type === "click" ? 1 : 0,
    relatedTarget: detail.relatedTarget ?? null,
  });
}

const FOCUSABLE = "button, input, select, textarea, a[href], summary, [tabindex]";

function ancestors(element: Element | null): Element[] {
  const chain: Element[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) chain.push(node);
  return chain;
}

function commonAncestor(a: Element, b: Element): Element | null {
  const chain = new Set(ancestors(a));
  for (let node: Element | null = b; node; node = node.parentElement) if (chain.has(node)) return node;
  return null;
}

/** A range input's value at a point, as dragging its thumb there would set it. */
export function rangeValueAt(input: HTMLInputElement, x: number, y: number): string {
  const rect = input.getBoundingClientRect();
  const style = input.ownerDocument.defaultView!.getComputedStyle(input);
  const writing = style.writingMode ?? "";
  const vertical = writing.startsWith("vertical") || writing.startsWith("sideways")
    || input.getAttribute("aria-orientation") === "vertical" || rect.height > rect.width;
  let along: number;
  if (vertical) {
    // A vertical range runs from the bottom unless its direction runs it down from the top.
    const fromTop = writing.startsWith("vertical") && style.direction !== "rtl";
    along = rect.height > 0 ? (y - rect.top) / rect.height : 0;
    if (!fromTop) along = 1 - along;
  } else {
    along = rect.width > 0 ? (x - rect.left) / rect.width : 0;
    if (style.direction === "rtl") along = 1 - along;
  }
  along = Math.min(1, Math.max(0, along));
  const min = Number.isFinite(parseFloat(input.min)) ? parseFloat(input.min) : 0;
  const max = Number.isFinite(parseFloat(input.max)) ? parseFloat(input.max) : 100;
  const value = min + along * (max - min);
  if (input.step === "any") return String(value);
  const step = parseFloat(input.step) > 0 ? parseFloat(input.step) : 1;
  const stepped = Math.min(max, Math.max(min, min + Math.round((value - min) / step) * step));
  // Steps such as 0.01 leave a float's remainder: keep the step's own decimals.
  const decimals = (String(step).split(".")[1] ?? "").length;
  return String(Number(stepped.toFixed(decimals)));
}

function setRangeValue(input: HTMLInputElement, value: string): boolean {
  if (input.value === value) return false;
  // Through the native setter, so a framework that watches the value property still sees the input.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  if (setter) setter.call(input, value); else input.value = value;
  input.dispatchEvent(new (input.ownerDocument.defaultView!.Event)("input", { bubbles: true, composed: true }));
  return true;
}

function scrollable(element: Element, deltaX: number, deltaY: number): boolean {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const canY = deltaY !== 0 && /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
  const canX = deltaX !== 0 && /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
  return canX || canY;
}

export function createDomPointer(options: DomPointerOptions): DomPointer {
  const { document } = options;
  const view = document.defaultView as Window & typeof globalThis;
  const pointerType = options.pointerType ?? "mouse";
  const primary = options.primary ?? true;
  const pointerId = nextPointerId++;
  const registry = captureRegistry(view);
  registry.ours.add(pointerId);
  let hovered: Element | null = null;
  let pressedOn: Element | null = null;
  let pressedButton = 0;
  let range: HTMLInputElement | null = null;
  let rangeChanged = false;
  let disposed = false;

  const included = (element: Element): boolean => {
    if (!options.include) return true;
    for (let node: Element | null = element; node; node = node.parentElement) if (!options.include(node)) return false;
    return true;
  };
  const hit = (x: number, y: number): Element | null => {
    if (x < 0 || y < 0 || x > view.innerWidth || y > view.innerHeight) return null;
    for (const element of document.elementsFromPoint(x, y)) {
      if (element === document.documentElement || element === document.body) return null;
      if (included(element)) return element;
    }
    return null;
  };
  const buttons = (): number => (pressedOn ? 1 << [0, 2, 1, 3, 4][pressedButton]! : 0);
  const detail = (x: number, y: number, extra: PointerDetail = {}): PointerDetail =>
    ({ x, y, pointerType, primary, buttons: buttons(), ...extra });

  const hoverTo = (target: Element | null, x: number, y: number): void => {
    if (target === hovered) return;
    const previous = hovered;
    const leaving = ancestors(previous), entering = ancestors(target);
    const kept = new Set(leaving.filter(element => entering.includes(element)));
    if (previous) {
      previous.dispatchEvent(pointerEvent(view, "pointerout", pointerId, detail(x, y, { relatedTarget: target })));
      for (const element of leaving) if (!kept.has(element)) element.dispatchEvent(pointerEvent(view, "pointerleave", pointerId, detail(x, y, { relatedTarget: target })));
      previous.dispatchEvent(mouseEvent(view, "mouseout", detail(x, y, { relatedTarget: target })));
      for (const element of leaving) if (!kept.has(element)) element.dispatchEvent(mouseEvent(view, "mouseleave", detail(x, y, { relatedTarget: target })));
    }
    hovered = target;
    if (target) {
      // Enter runs from the outermost element in, as leave runs from the innermost out.
      const entered = entering.filter(element => !kept.has(element)).reverse();
      target.dispatchEvent(pointerEvent(view, "pointerover", pointerId, detail(x, y, { relatedTarget: previous })));
      for (const element of entered) element.dispatchEvent(pointerEvent(view, "pointerenter", pointerId, detail(x, y, { relatedTarget: previous })));
      target.dispatchEvent(mouseEvent(view, "mouseover", detail(x, y, { relatedTarget: previous })));
      for (const element of entered) element.dispatchEvent(mouseEvent(view, "mouseenter", detail(x, y, { relatedTarget: previous })));
    }
  };

  const releaseCapture = (): void => {
    const captured = registry.captured.get(pointerId);
    if (!captured) return;
    registry.captured.delete(pointerId);
    captured.dispatchEvent(pointerEvent(view, "lostpointercapture", pointerId, {}));
  };
  const finishRange = (): void => {
    if (range && rangeChanged) range.dispatchEvent(new view.Event("change", { bubbles: true }));
    range = null;
    rangeChanged = false;
  };

  const pointer: DomPointer = {
    get hovered() { return hovered; },
    get pressed() { return pressedOn !== null; },
    hit,
    move(x, y) {
      if (disposed) return null;
      const over = hit(x, y);
      const target = registry.captured.get(pointerId) ?? over;
      hoverTo(target, x, y);
      if (target) {
        target.dispatchEvent(pointerEvent(view, "pointermove", pointerId, detail(x, y)));
        target.dispatchEvent(mouseEvent(view, "mousemove", detail(x, y)));
      }
      if (range && setRangeValue(range, rangeValueAt(range, x, y))) rangeChanged = true;
      return over;
    },
    down(x, y, button = 0) {
      if (disposed) return null;
      if (pressedOn) pointer.up(x, y, pressedButton);
      const target = hit(x, y);
      hoverTo(target, x, y);
      if (!target) return null;
      pressedOn = target;
      pressedButton = button;
      const down = pointerEvent(view, "pointerdown", pointerId, detail(x, y, { button }));
      target.dispatchEvent(down);
      // A cancelled pointerdown leaves out the mouse's events, as the browser does.
      let mouseDown: MouseEvent | null = null;
      if (!down.defaultPrevented) {
        mouseDown = mouseEvent(view, "mousedown", detail(x, y, { button }));
        target.dispatchEvent(mouseDown);
      }
      if (!mouseDown?.defaultPrevented) {
        const focusable = target.closest(FOCUSABLE) as HTMLElement | null;
        if (focusable && !(focusable as HTMLButtonElement).disabled) focusable.focus({ preventScroll: true });
        else (document.activeElement as HTMLElement | null)?.blur?.();
      }
      const input = target.closest("input") as HTMLInputElement | null;
      if (button === 0 && input?.type === "range" && !input.disabled && !down.defaultPrevented && !mouseDown?.defaultPrevented) {
        range = input;
        rangeChanged = setRangeValue(input, rangeValueAt(input, x, y));
      }
      return target;
    },
    up(x, y, button = pressedButton) {
      if (disposed || !pressedOn) return;
      const over = hit(x, y);
      const captured = registry.captured.get(pointerId);
      const target = captured ?? over;
      if (range && setRangeValue(range, rangeValueAt(range, x, y))) rangeChanged = true;
      const downOn = pressedOn;
      pressedOn = null;
      if (target) {
        target.dispatchEvent(pointerEvent(view, "pointerup", pointerId, detail(x, y, { button })));
        target.dispatchEvent(mouseEvent(view, "mouseup", detail(x, y, { button })));
      }
      releaseCapture();
      finishRange();
      const clicked = target ? commonAncestor(downOn, target) : null;
      if (clicked && button === 0) clicked.dispatchEvent(mouseEvent(view, "click", detail(x, y, { button })));
      else if (clicked && button === 1) clicked.dispatchEvent(mouseEvent(view, "auxclick", detail(x, y, { button })));
      hoverTo(over, x, y);
    },
    wheel(x, y, deltaX, deltaY) {
      if (disposed) return;
      const target = hit(x, y);
      if (!target) return;
      const event = new view.WheelEvent("wheel", {
        bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, deltaX, deltaY, deltaMode: 0,
      });
      target.dispatchEvent(event);
      if (event.defaultPrevented) return;
      for (let node: Element | null = target; node; node = node.parentElement) {
        if (!scrollable(node, deltaX, deltaY)) continue;
        node.scrollBy({ left: deltaX, top: deltaY });
        return;
      }
    },
    leave() {
      if (disposed) return;
      if (pressedOn) {
        const target = registry.captured.get(pointerId) ?? pressedOn;
        target.dispatchEvent(pointerEvent(view, "pointercancel", pointerId, detail(0, 0)));
        pressedOn = null;
        releaseCapture();
        finishRange();
      }
      hoverTo(null, 0, 0);
    },
    dispose() {
      if (disposed) return;
      pointer.leave();
      disposed = true;
      registry.ours.delete(pointerId);
      registry.captured.delete(pointerId);
      if (registry.ours.size === 0) registry.restore();
    },
  };
  return pointer;
}
