// @vitest-environment jsdom
import { act, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSecondaryTouchClick } from "./useSecondaryTouchClick.js";

let root: Root;
let host: HTMLDivElement;

function pointer(target: EventTarget, type: string, init: Partial<PointerEventInit> = {}): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 0, ...init });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 2 },
    pointerType: { value: init.pointerType ?? "touch" },
    isPrimary: { value: init.isPrimary ?? false },
  });
  target.dispatchEvent(event);
  return event;
}

function Controls({ onClick }: { onClick: () => void }) {
  const touchClick = useSecondaryTouchClick();
  const [open, setOpen] = useState(false);
  return <div {...touchClick}>
    <button onClick={() => { onClick(); setOpen(!open); }}><span>+</span></button>
    <button disabled onClick={onClick}>Disabled</button>
    <input type="checkbox" aria-label="Checkbox" />
    <input type="radio" aria-label="Radio" />
    <input type="range" aria-label="Range" />
    <input type="text" aria-label="Text" />
    <details><summary>Details</summary>Content</details>
    <a href="#target" onClick={onClick}>Link</a>
    {open ? createPortal(<button onPointerDown={(event) => event.stopPropagation()} onClick={onClick}>Portal item</button>, document.body) : null}
  </div>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("activates a secondary finger's native button and a stopped-propagation portal menu while the first finger stays down", async () => {
  const onClick = vi.fn();
  await act(async () => root.render(<Controls onClick={onClick} />));
  const joystick = document.createElement("div");
  document.body.append(joystick);
  pointer(joystick, "pointerdown", { pointerId: 1, isPrimary: true });
  const child = host.querySelector("span")!;
  await act(async () => {
    pointer(child, "pointerdown");
    pointer(joystick, "pointermove", { pointerId: 1, isPrimary: true, clientX: 200 });
    joystick.dispatchEvent(new Event("scroll")); // An unrelated scrolling log/joystick cannot cancel the UI tap.
    pointer(child, "pointerup");
  });
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(host.querySelector("button"));
  const item = [...document.querySelectorAll("button")].find((button) => button.textContent === "Portal item")!;
  await act(async () => { pointer(item, "pointerdown", { pointerId: 3 }); pointer(item, "pointerup", { pointerId: 3 }); });
  expect(onClick).toHaveBeenCalledTimes(2);
});

it("deduplicates either form of compatibility click, while later primary, mouse and keyboard activations still work", async () => {
  const onClick = vi.fn();
  await act(async () => root.render(<Controls onClick={onClick} />));
  const button = host.querySelector("button")!;
  await act(async () => {
    pointer(button, "pointerdown"); pointer(button, "pointerup");
    pointer(button, "click", { detail: 1 });
  });
  expect(onClick).toHaveBeenCalledTimes(1);
  await act(async () => {
    pointer(button, "pointerdown", { pointerId: 3 }); pointer(button, "pointerup", { pointerId: 3 });
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 20, clientY: 20 }));
  });
  expect(onClick).toHaveBeenCalledTimes(2);
  await act(async () => {
    pointer(button, "pointerdown", { pointerId: 4 }); pointer(button, "pointerup", { pointerId: 4 });
    button.click(); // Keyboard/programmatic clicks have detail 0.
    pointer(button, "pointerdown", { pointerId: 1, isPrimary: true });
    pointer(button, "pointerup", { pointerId: 1, isPrimary: true });
    pointer(button, "click", { pointerId: 1, isPrimary: true, detail: 1 });
    pointer(button, "pointerdown", { pointerId: 9, pointerType: "mouse", isPrimary: true });
    pointer(button, "pointerup", { pointerId: 9, pointerType: "mouse", isPrimary: true });
    pointer(button, "click", { pointerId: 9, pointerType: "mouse", isPrimary: true, detail: 1 });
  });
  expect(onClick).toHaveBeenCalledTimes(6);
});

it("cancels taps after movement, scrolling, pointer cancellation, capture loss, blur or releasing outside the control", async () => {
  const onClick = vi.fn();
  await act(async () => root.render(<Controls onClick={onClick} />));
  const button = host.querySelector("button")!;
  await act(async () => {
    pointer(button, "pointerdown"); pointer(button, "pointermove", { clientX: 28 }); pointer(button, "pointermove"); pointer(button, "pointerup");
    pointer(button, "pointerdown"); pointer(button, "pointerup", { clientX: 28 });
    pointer(button, "pointerdown"); host.dispatchEvent(new Event("scroll")); pointer(button, "pointerup");
    pointer(button, "pointerdown"); pointer(button, "pointercancel"); pointer(button, "pointerup");
    pointer(button, "pointerdown"); pointer(button, "lostpointercapture"); pointer(button, "pointerup");
    pointer(button, "pointerdown"); window.dispatchEvent(new Event("blur")); pointer(button, "pointerup");
    pointer(button, "pointerdown", { clientX: 98 }); pointer(button, "pointerup", { clientX: 102 });
  });
  expect(onClick).not.toHaveBeenCalled();
});

it("uses native checkbox/radio, summary and link activation, and leaves disabled, text and range inputs alone", async () => {
  const onClick = vi.fn();
  await act(async () => root.render(<Controls onClick={onClick} />));
  const checkbox = host.querySelector<HTMLInputElement>('[type="checkbox"]')!;
  const radio = host.querySelector<HTMLInputElement>('[type="radio"]')!;
  const details = host.querySelector("details")!;
  const summary = host.querySelector("summary")!;
  await act(async () => {
    for (const control of [checkbox, radio, summary, host.querySelector("a")!]) {
      pointer(control, "pointerdown"); pointer(control, "pointerup");
    }
  });
  expect(checkbox.checked).toBe(true);
  expect(radio.checked).toBe(true);
  expect(details.open).toBe(true);
  expect(onClick).toHaveBeenCalledTimes(1);
  const otherControls = [...host.querySelectorAll<HTMLElement>('button:disabled, input[type="range"], input[type="text"]')];
  const clicks = otherControls.map((element) => vi.spyOn(element, "click"));
  await act(async () => { for (const control of otherControls) { pointer(control, "pointerdown"); pointer(control, "pointerup"); } });
  for (const click of clicks) expect(click).not.toHaveBeenCalled();
});

it("forgets pending touches when unmounted", async () => {
  const onClick = vi.fn();
  await act(async () => root.render(<Controls onClick={onClick} />));
  const button = host.querySelector("button")!;
  pointer(button, "pointerdown");
  await act(async () => root.render(null));
  pointer(document, "pointerup");
  expect(onClick).not.toHaveBeenCalled();
});

it("activates checkbox/radio controls through their labels, including label text beyond the input bounds", async () => {
  const onChange = vi.fn();
  function Choices() {
    const touchClick = useSecondaryTouchClick();
    return <div {...touchClick}>
      <label><input type="checkbox" onChange={onChange} /><span>Choice</span></label>
      <input id="radio-choice" type="radio" onChange={onChange} />
      <label htmlFor="radio-choice"><span>Radio choice</span></label>
    </div>;
  }
  await act(async () => root.render(<Choices />));
  const inputs = [...host.querySelectorAll("input")];
  for (const input of inputs) vi.spyOn(input, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 10, 10));
  await act(async () => {
    for (const span of host.querySelectorAll("span")) {
      pointer(span, "pointerdown"); pointer(span, "pointerup");
      // A browser may click the label afterwards; prevent its default from toggling twice.
      pointer(span, "click", { detail: 1 });
    }
  });
  expect(inputs.map((input) => input.checked)).toEqual([true, true]);
  expect(onChange).toHaveBeenCalledTimes(2);
});
