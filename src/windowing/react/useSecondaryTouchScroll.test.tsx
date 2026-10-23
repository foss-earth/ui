// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSecondaryTouchScroll } from "./useSecondaryTouchScroll.js";

let root: Root;
let host: HTMLDivElement;
let now: number;
let frames: Map<number, FrameRequestCallback>;

function pointer(target: EventTarget, type: string, init: Partial<PointerEventInit> = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: 150, button: 0, ...init });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 2 },
    pointerType: { value: init.pointerType ?? "touch" },
    isPrimary: { value: init.isPrimary ?? false },
  });
  target.dispatchEvent(event);
}

/** A finger down on the target, then along the path, `step` ms apart. */
function drag(target: Element, path: [number, number][], init: Partial<PointerEventInit> = {}, step = 16): void {
  const [[x, y], ...rest] = path;
  pointer(target, "pointerdown", { clientX: x, clientY: y, ...init });
  for (const [clientX, clientY] of rest) { now += step; pointer(target, "pointermove", { clientX, clientY, ...init }); }
}

function size(element: HTMLElement, { height = 200, scrollHeight = height, width = 300, scrollWidth = width }: { height?: number; scrollHeight?: number; width?: number; scrollWidth?: number }): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height }, scrollHeight: { configurable: true, value: scrollHeight },
    clientWidth: { configurable: true, value: width }, scrollWidth: { configurable: true, value: scrollWidth },
  });
}

function Window() {
  const touchScroll = useSecondaryTouchScroll();
  return <div {...touchScroll}>
    <div className="body" style={{ overflowY: "auto" }}>
      <div className="strip" style={{ overflowX: "auto" }}><button>Tab</button></div>
      <button className="choice">Choice</button>
      <input type="range" aria-label="Range" />
      <input type="text" aria-label="Text" />
      <span className="grip" style={{ touchAction: "none" }}>Grip</span>
    </div>
  </div>;
}

async function mount() {
  await act(async () => root.render(<Window />));
  const body = host.querySelector<HTMLElement>(".body")!;
  const strip = host.querySelector<HTMLElement>(".strip")!;
  size(body, { height: 200, scrollHeight: 1000 });
  size(strip, { width: 200, scrollWidth: 600 });
  const joystick = document.body.appendChild(document.createElement("div"));
  pointer(joystick, "pointerdown", { pointerId: 1, isPrimary: true });
  return { body, strip, at: (selector: string) => host.querySelector(selector)! };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  now = 1000;
  frames = new Map();
  let nextFrame = 1;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(nextFrame, callback); return nextFrame++; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Runs the animation frames due, `step` ms apart, until none is asked for or `limit` have run. */
function runFrames(step = 16, limit = 1000): number {
  let ran = 0;
  while (frames.size && ran < limit) {
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    now += step; callback(now); ran++;
  }
  return ran;
}

it("scrolls the window under a second finger's drag while the first holds a control elsewhere, within its range", async () => {
  const { body, at } = await mount();
  drag(at(".choice"), [[50, 150], [50, 146]]);
  // A still finger is a tap until it moves the slop.
  expect(body.scrollTop).toBe(0);
  now += 16; pointer(at(".choice"), "pointermove", { clientX: 52, clientY: 100 });
  expect(body.scrollTop).toBe(50);
  now += 16; pointer(at(".choice"), "pointermove", { clientX: 52, clientY: 130 });
  expect(body.scrollTop).toBe(20);
  now += 16; pointer(at(".choice"), "pointermove", { clientX: 52, clientY: -2000 });
  expect(body.scrollTop).toBe(800);
  // A finger that stopped before lifting leaves the window where it is.
  now += 200; pointer(at(".choice"), "pointerup", { clientX: 52, clientY: -2000 });
  expect(frames.size).toBe(0);
  expect(body.scrollTop).toBe(800);
});

it("leaves a first finger, a slider, a text field and a touch-action: none grip to the browser", async () => {
  const { body, at } = await mount();
  drag(at(".choice"), [[50, 150], [50, 120], [50, 60]], { pointerId: 3, isPrimary: true });
  drag(at('[aria-label="Range"]'), [[50, 150], [50, 120], [50, 60]], { pointerId: 4 });
  drag(at('[aria-label="Text"]'), [[50, 150], [50, 120], [50, 60]], { pointerId: 5 });
  drag(at(".grip"), [[50, 150], [50, 120], [50, 60]], { pointerId: 6 });
  drag(at(".choice"), [[50, 150], [50, 120], [50, 60]], { pointerId: 7, pointerType: "mouse" });
  expect(body.scrollTop).toBe(0);
});

it("scrolls a sideways strip for a sideways drag and the window for an upward one, and stops when the browser takes the pan", async () => {
  const { body, strip, at } = await mount();
  drag(at(".strip button"), [[150, 150], [130, 151], [90, 152]]);
  expect(strip.scrollLeft).toBe(60);
  expect(body.scrollTop).toBe(0);
  now += 200; pointer(at(".strip button"), "pointerup", { clientX: 90, clientY: 152 });

  drag(at(".strip button"), [[150, 150], [151, 120]], { pointerId: 3 });
  expect(body.scrollTop).toBe(30);
  expect(strip.scrollLeft).toBe(60);
  pointer(at(".strip button"), "pointercancel", { pointerId: 3 });
  now += 16; pointer(at(".strip button"), "pointermove", { pointerId: 3, clientX: 151, clientY: 20 });
  expect(body.scrollTop).toBe(30);
});

it("carries a flick on after the finger lifts, slowing to a stop, and a touch on the window stops it at once", async () => {
  const { body, at } = await mount();
  drag(at(".choice"), [[50, 150], [50, 134], [50, 118], [50, 102]]);
  pointer(at(".choice"), "pointerup", { clientX: 50, clientY: 102 });
  const lifted = body.scrollTop;
  expect(lifted).toBe(48);
  runFrames(16, 10);
  const carried = body.scrollTop;
  expect(carried).toBeGreaterThan(lifted + 100);
  pointer(at(".choice"), "pointerdown", { pointerId: 3 });
  expect(frames.size).toBe(0);
  expect(body.scrollTop).toBe(carried);

  // Left alone, a flick slows and stops by itself, or at the end of the window.
  pointer(at(".choice"), "pointerup", { pointerId: 3 });
  body.scrollTop = 0;
  drag(at(".choice"), [[50, 150], [50, 134], [50, 118], [50, 102]], { pointerId: 4 });
  pointer(at(".choice"), "pointerup", { pointerId: 4, clientX: 50, clientY: 102 });
  expect(runFrames()).toBeLessThan(1000);
  expect(frames.size).toBe(0);
  expect(body.scrollTop).toBeGreaterThan(48);
  expect(body.scrollTop).toBeLessThanOrEqual(800);
});
