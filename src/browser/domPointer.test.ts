// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createDomPointer, rangeValueAt } from "./domPointer.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function box(element: Element, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () => ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON() {} });
}

/** jsdom lays nothing out: the element at a point is the innermost whose box holds it. */
function layOut(): void {
  document.elementsFromPoint = (x: number, y: number) => Array.from(document.body.querySelectorAll("*"))
    .filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    })
    .reverse();
}

function record(target: EventTarget, types: string[]): string[] {
  const seen: string[] = [];
  for (const type of types) target.addEventListener(type, event => {
    const element = event.currentTarget as Element;
    seen.push(`${type}@${element.id || element.localName}`);
  });
  return seen;
}

describe("a pointer the page does not have", () => {
  it("gives the page a mouse's events in order, and the click on what it pressed", () => {
    document.body.innerHTML = `<div id="panel"><button id="go">Go</button></div><div id="other"></div>`;
    const panel = document.getElementById("panel")!, button = document.getElementById("go")!, other = document.getElementById("other")!;
    box(panel, 0, 0, 100, 100);
    box(button, 10, 10, 40, 20);
    box(other, 200, 0, 50, 50);
    layOut();
    const seen = record(button, ["pointerover", "pointerenter", "mouseover", "pointermove", "pointerdown", "mousedown", "pointerup", "mouseup", "click", "pointerout", "pointerleave"]);
    const panelSeen = record(panel, ["pointerenter", "pointerleave", "click"]);
    const pointer = createDomPointer({ document });

    expect(pointer.move(20, 20)).toBe(button);
    expect(pointer.hovered).toBe(button);
    expect(pointer.down(20, 20)).toBe(button);
    expect(document.activeElement).toBe(button);
    pointer.up(22, 21);
    expect(seen).toEqual(["pointerover@go", "pointerenter@go", "mouseover@go", "pointermove@go", "pointerdown@go", "mousedown@go", "pointerup@go", "mouseup@go", "click@go"]);
    expect(panelSeen).toEqual(["pointerenter@panel", "click@panel"]);

    seen.length = 0;
    expect(pointer.move(300, 300)).toBeNull();
    expect(seen).toEqual(["pointerout@go", "pointerleave@go"]);
    expect(panelSeen.at(-1)).toBe("pointerleave@panel");
    pointer.dispose();
  });

  it("clicks only what holds both the press and the release, and nothing when it lets go off the interface", () => {
    document.body.innerHTML = `<div id="row"><button id="a"></button><button id="b"></button></div>`;
    const row = document.getElementById("row")!, a = document.getElementById("a")!, b = document.getElementById("b")!;
    box(row, 0, 0, 100, 20);
    box(a, 0, 0, 50, 20);
    box(b, 50, 0, 50, 20);
    layOut();
    const aClicks = record(a, ["click"]), rowClicks = record(row, ["click"]);
    const pointer = createDomPointer({ document });
    pointer.down(10, 10);
    pointer.up(70, 10);
    expect(aClicks).toEqual([]);
    expect(rowClicks).toEqual(["click@row"]);
    pointer.down(10, 10);
    pointer.up(500, 500);
    expect(rowClicks).toEqual(["click@row"]);
    expect(aClicks).toEqual([]);
    pointer.dispose();
  });

  it("passes through what the page lets through, and what it leaves out", () => {
    document.body.innerHTML = `<canvas id="view"></canvas><div id="ui"><span id="label"></span></div>`;
    const view = document.getElementById("view")!, ui = document.getElementById("ui")!, label = document.getElementById("label")!;
    box(view, 0, 0, 500, 500);
    box(ui, 0, 0, 100, 100);
    box(label, 0, 0, 50, 50);
    layOut();
    const pointer = createDomPointer({ document, include: element => element.id !== "ui" && element.id !== "view" });
    expect(pointer.hit(10, 10)).toBeNull();
    expect(pointer.down(10, 10)).toBeNull();
    expect(pointer.pressed).toBe(false);
    pointer.dispose();
  });

  it("keeps the page's pointer capture for itself, and lets it go on release", () => {
    document.body.innerHTML = `<div id="pad"></div><div id="elsewhere"></div>`;
    const pad = document.getElementById("pad")!, elsewhere = document.getElementById("elsewhere")!;
    box(pad, 0, 0, 50, 50);
    box(elsewhere, 100, 0, 50, 50);
    layOut();
    const seen = record(pad, ["pointermove", "pointerup", "gotpointercapture", "lostpointercapture"]);
    pad.addEventListener("pointerdown", event => pad.setPointerCapture((event as PointerEvent).pointerId));
    const native = Element.prototype.hasPointerCapture;
    const pointer = createDomPointer({ document });
    pointer.down(10, 10);
    const id = (() => { let captured = 0; pad.addEventListener("pointermove", event => { captured = (event as PointerEvent).pointerId; }, { once: true }); pointer.move(120, 10); return captured; })();
    expect(pad.hasPointerCapture(id)).toBe(true);
    expect(elsewhere.hasPointerCapture(id)).toBe(false);
    pointer.up(120, 10);
    expect(seen).toEqual(["gotpointercapture@pad", "pointermove@pad", "pointerup@pad", "lostpointercapture@pad"]);
    expect(pad.hasPointerCapture(id)).toBe(false);
    pointer.dispose();
    // The browser's own pointer capture is the browser's again.
    expect(Element.prototype.hasPointerCapture).toBe(native);
  });

  it("drags a range input's value with it, and changes it once on release", () => {
    document.body.innerHTML = `<input id="trim" type="range" min="-1" max="1" step="0.01" value="0">`;
    const trim = document.getElementById("trim") as HTMLInputElement;
    box(trim, 0, 0, 200, 20);
    layOut();
    const values: string[] = [];
    trim.addEventListener("input", () => values.push(trim.value));
    const changes = record(trim, ["change"]);
    const pointer = createDomPointer({ document });
    pointer.down(150, 10);
    pointer.move(180, 10);
    pointer.move(400, 10);
    pointer.up(400, 10);
    expect(values).toEqual(["0.5", "0.8", "1"]);
    expect(changes).toEqual(["change@trim"]);
    pointer.dispose();
  });

  it("scrolls what a wheel would, unless the page takes the wheel", () => {
    document.body.innerHTML = `<div id="list" style="overflow-y: auto"><p id="row"></p></div>`;
    const list = document.getElementById("list")!, row = document.getElementById("row")!;
    box(list, 0, 0, 100, 100);
    box(row, 0, 0, 100, 20);
    Object.defineProperty(list, "scrollHeight", { value: 400 });
    Object.defineProperty(list, "clientHeight", { value: 100 });
    const scrolled: ScrollToOptions[] = [];
    list.scrollBy = ((options: ScrollToOptions) => { scrolled.push(options); }) as typeof list.scrollBy;
    layOut();
    const pointer = createDomPointer({ document });
    pointer.wheel(10, 10, 0, 30);
    expect(scrolled).toEqual([{ left: 0, top: 30 }]);
    row.addEventListener("wheel", event => event.preventDefault());
    pointer.wheel(10, 10, 0, 30);
    expect(scrolled).toHaveLength(1);
    pointer.dispose();
  });
});

describe("a range input's value at a point", () => {
  it("runs left to right, or bottom to top when it stands upright, in its steps", () => {
    document.body.innerHTML = `<input id="h" type="range" min="0" max="10" step="1"><input id="v" type="range" min="0" max="1" step="0.25" aria-orientation="vertical">`;
    const h = document.getElementById("h") as HTMLInputElement, v = document.getElementById("v") as HTMLInputElement;
    box(h, 100, 0, 100, 10);
    box(v, 0, 0, 10, 100);
    expect(rangeValueAt(h, 100, 5)).toBe("0");
    expect(rangeValueAt(h, 136, 5)).toBe("4");
    expect(rangeValueAt(h, 999, 5)).toBe("10");
    expect(rangeValueAt(v, 5, 100)).toBe("0");
    expect(rangeValueAt(v, 5, 20)).toBe("0.75");
    expect(rangeValueAt(v, 5, 0)).toBe("1");
  });
});
