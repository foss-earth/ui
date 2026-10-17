// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SAVED_WORKSPACE_STORAGE_KEY } from "../browser/workspace.js";
import { browserOverlayLayout } from "../browser/overlay.js";
import { WindowOverlay } from "./WindowOverlay.js";

type Tab = "a" | "b";
type Open = "both" | "left" | "right";
type Choice = "auto" | "overlay" | "split" | undefined;
type Side = "left" | "right";
const opposite = (side: Side): Side => side === "left" ? "right" : "left";
const outward = (side: Side, px: number): number => side === "left" ? px : -px;
const slotKey = (side: Side) => side === "left" ? "primary" : "secondary";

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The shipped grip placement, so the tests read where the stylesheet puts each grip.
  const style = document.createElement("style");
  style.textContent = readFileSync(join(import.meta.dirname, "../windowing/styles/windowing.css"), "utf8");
  document.head.append(style);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.head.replaceChildren(); document.body.replaceChildren(); });

/** jsdom has no layout: a panel's box is its inline size, against the screen edge on its side. */
function layOutPanels(screenWidth: () => number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const panel = this.classList.contains("foss-earth-dock-panel");
    const width = panel ? (this.style.width.endsWith("px") ? Number.parseFloat(this.style.width) : screenWidth()) : 0;
    const height = panel ? Number.parseFloat(this.style.height) || 30 : 0;
    const left = panel && this.dataset.side === "right" ? screenWidth() - width : 0;
    return { left, top: 0, width, height, right: left + width, bottom: height, x: left, y: 0, toJSON() {} } as DOMRect;
  });
}

/** Mounts on a device whose saved workspace has the tabs `open`, or, with "saved", whatever the last mount saved. */
async function mount(screenWidth: number, choice: Choice, open: Open | "saved", edges: "inset" | "flush" = "inset") {
  const slot = (tabs: Tab[]) => ({ tabs, activeTab: tabs[0] ?? null, collapsed: false });
  if (open !== "saved") stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: slot(open === "both" ? ["a"] : open === "left" ? ["a", "b"] : []),
    secondary: slot(open === "both" ? ["b"] : open === "right" ? ["a", "b"] : []),
  }));
  let currentWidth = screenWidth;
  let observeWidth: ((width: number) => void) | undefined;
  layOutPanels(() => currentWidth);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<WindowOverlay<Tab>
    tabDefinitions={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
    renderTabContent={tabId => <p>{tabId}</p>}
    context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "a" }}
    restorableTabs={new Set<Tab>(["a", "b"])} storage={localStorage}
    geometry={{ observeWidth(_element, listener) { observeWidth = listener; listener(currentWidth); return () => {}; }, observeHeight(_element, listener) { listener(240); return () => {}; }, menuBottom: () => null }}
    logSize={{ getWidth: () => null, subscribe: () => () => {} }}
    layoutPort={browserOverlayLayout(document.documentElement)}
    presentation={choice === undefined ? undefined : { choice, onChoice: () => {}, tabsBehindToolbar: false, toolbarEdge: "bottom", edges }}
  />));
  const panel = (side: "left" | "right") => host.querySelector<HTMLElement>(`.foss-earth-dock-panel[data-side="${side}"]`);
  // A split grip is painted on the body, above the toolbar.
  const grip = (side: "left" | "right") => document.querySelector<HTMLElement>(`.foss-earth-dock-panel-resize-handle[data-side="${side}"]`);
  const resizeScreen = (width: number) => act(async () => { currentWidth = width; observeWidth!(width); });
  const launcher = (side: Side) => host.querySelector<HTMLElement>(`.foss-earth-workspace-slot-launcher-${side}`);
  return { root, panel, grip, resizeScreen, launcher };
}

function pointer(grip: HTMLElement, type: string, dx = 0, dy = 0, pointerId = 1): Promise<void> {
  return act(async () => {
    grip.dispatchEvent(new PointerEvent(type, { button: 0, clientX: 200 + dx, clientY: 200 + dy, pointerId, bubbles: true }));
  });
}

/** A press, a drag and a release on a grip, by its center. */
async function drag(grip: HTMLElement, dx: number, dy: number): Promise<void> {
  grip.setPointerCapture = () => {}; grip.releasePointerCapture = () => {};
  await pointer(grip, "pointerdown");
  await pointer(grip, "pointermove", dx, dy);
  await pointer(grip, "pointerup", dx, dy);
}

/** Whether the grip's icon draws a sideways stroke: an arrow promising the width. */
const iconShowsWidth = (grip: HTMLElement): boolean => /h/i.test(grip.querySelector("path")?.getAttribute("d") ?? "");

it("draws sideways arrows on a grip exactly when dragging it changes the window's width", async () => {
  const seen = new Set<string>();
  for (const screenWidth of [360, 412, 515, 516, 700, 900, 1280]) {
    for (const choice of [undefined, "auto", "overlay", "split"] as const) {
      for (const open of ["both", "left", "right"] as const) {
        for (const side of ["left", "right"] as const) {
          const { root, panel, grip } = await mount(screenWidth, choice, open);
          try {
            const dock = panel(side), handle = grip(side);
            if (!dock || !handle) continue;
            const context = `${side} grip at ${screenWidth} px, ${choice ?? "no"} choice, ${open} open`;
            const before = { width: dock.style.width, height: dock.style.height };
            const promisesWidth = iconShowsWidth(handle);
            expect(handle.dataset.axes, context).toBe(promisesWidth ? "both" : "height");
            // Narrow it, toward the side it is anchored on, and shorten it.
            await drag(handle, side === "right" ? 40 : -40, -30);
            const after = panel(side)!;
            expect(after.dataset.collapsed, context).toBe("false");
            expect(after.style.height, context).not.toBe(before.height);
            expect(after.style.width !== before.width, context).toBe(promisesWidth);
            seen.add(`${handle.dataset.axes}/${handle.dataset.at}`);
          } finally { await act(async () => root.unmount()); }
        }
      }
    }
  }
  // Every kind of grip was driven: corner, a phone's mid-bottom, and height only.
  expect([...seen].sort()).toEqual(["both/bottom", "both/corner", "height/bottom"]);
});

it("lets a Galaxy Note 20 Ultra narrow its overlay window from a grip mid-bottom, and locks back to full width", async () => {
  // 412 CSS px wide in portrait: one window, floating on the world.
  const { root, panel, grip } = await mount(412, "overlay", "right");
  try {
    expect(document.documentElement.dataset.dockLayout).toBe("stacked");
    expect(document.documentElement.dataset.worldPresentation).toBe("overlay");
    const dock = panel("right")!, handle = grip("right")!;
    expect(dock.style.width).toBe("400px");
    expect(handle.dataset).toMatchObject({ axes: "both", at: "bottom" });
    expect(iconShowsWidth(handle)).toBe(true);
    // In the middle of the bottom edge, not on the corner at the screen's edge.
    expect(getComputedStyle(handle).left).toBe("calc(50% - 12px)");
    expect(getComputedStyle(handle).bottom).toBe("-13px");
    await drag(handle, 120, 0);
    expect(panel("right")!.style.width).toBe("280px");
    expect(JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!).secondary.width).toBe(280);
    // Slightly past full width, it stays snapped there and follows the next screen width.
    await drag(grip("right")!, -130, 0);
    expect(panel("right")!.style.width).toBe("400px");
    expect(JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!).secondary.width).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it.each(["left", "right"] as const)("keeps a lone %s window on its side through phone and desktop widths", async side => {
  for (const choice of ["overlay", "split"] as const) {
    const mounted = await mount(900, choice, side, "flush");
    try {
      expect(mounted.launcher(opposite(side))).not.toBeNull();
      for (const width of [412, 280, 515, 900, 390]) {
        await mounted.resizeScreen(width);
        expect(mounted.panel(side), `${choice} at ${width}`).not.toBeNull();
        expect(mounted.panel(opposite(side)), `${choice} at ${width}`).toBeNull();
        expect(mounted.launcher(opposite(side)) === null, `${choice} at ${width}`).toBe(width < 516);
        if (width < 516) {
          expect(mounted.grip(side)!.dataset).toMatchObject({ at: "bottom", axes: choice === "split" ? "height" : "both" });
        }
      }
      const saved = JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!);
      expect(saved[slotKey(side)].tabs).toEqual(["a", "b"]);
      expect(saved[slotKey(opposite(side))].tabs).toEqual([]);
    } finally { await act(async () => mounted.root.unmount()); }
  }
});

it.each(["left", "right"] as const)("folds two windows toward the focused %s side without changing their saved homes", async side => {
  const mounted = await mount(900, "overlay", "both", "flush");
  try {
    await pointer(mounted.panel(side)!, "pointerdown");
    await mounted.resizeScreen(390);
    expect(mounted.panel(side)).not.toBeNull();
    expect(mounted.panel(opposite(side))).toBeNull();
    expect(mounted.launcher(opposite(side))).toBeNull();
    expect(mounted.panel(side)!.querySelectorAll(".foss-earth-tab-button")).toHaveLength(2);
    const saved = JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!);
    expect(saved.primary.tabs).toEqual(["a"]);
    expect(saved.secondary.tabs).toEqual(["b"]);
    await mounted.resizeScreen(900);
    expect(mounted.panel("left")!.querySelector(".foss-earth-tab-button")!.textContent).toBe("A");
    expect(mounted.panel("right")!.querySelector(".foss-earth-tab-button")!.textContent).toBe("B");
  } finally { await act(async () => mounted.root.unmount()); }
});

it.each(["left", "right"] as const)("snaps the %s overlay window to full width and follows the compact screen after a reload", async side => {
  for (const edges of ["flush", "inset"] as const) {
    const mounted = await mount(412, "overlay", side, edges);
    const full = 412 - (edges === "inset" ? 12 : 0);
    try {
      await drag(mounted.grip(side)!, -outward(side, 120), 0);
      expect(mounted.panel(side)!.style.width).toBe(`${full - 120}px`);
      await drag(mounted.grip(side)!, outward(side, 110), 0);
      expect(mounted.panel(side)!.style.width).toBe(`${full}px`);
      expect(JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!)[slotKey(side)].width).toBeNull();
      await mounted.resizeScreen(430);
      expect(mounted.panel(side)!.style.width).toBe(`${430 - (edges === "inset" ? 12 : 0)}px`);
    } finally { await act(async () => mounted.root.unmount()); }
    const reloaded = await mount(390, "overlay", "saved", edges);
    try {
      expect(reloaded.panel(side)!.style.width).toBe(`${390 - (edges === "inset" ? 12 : 0)}px`);
      expect(reloaded.panel(opposite(side))).toBeNull();
    } finally { await act(async () => reloaded.root.unmount()); }
  }
});

it.each(["left", "right"] as const)("continues one compact %s grip gesture through full width onto the other side, and remembers the move", async side => {
  const mounted = await mount(412, "overlay", side);
  const other = opposite(side);
  try {
    await drag(mounted.grip(side)!, -outward(side, 120), 0);
    const handle = mounted.grip(side)!;
    const height = Number.parseFloat(mounted.panel(side)!.style.height);
    await pointer(handle, "pointerdown");
    await pointer(handle, "pointermove", outward(side, 100), 0);
    expect(mounted.panel(side)!.style.width).toBe("400px");
    await pointer(handle, "pointermove", outward(side, 130), 0);
    expect(mounted.panel(side)!.style.width).toBe("400px");
    expect(mounted.panel(other)).toBeNull();
    await pointer(handle, "pointermove", outward(side, 180), 30);
    expect(mounted.panel(side)).toBeNull();
    expect(mounted.panel(other)!.style.width).toBe("340px");
    expect(mounted.panel(other)!.style.height).toBe(`${height + 30}px`);
    expect(mounted.grip(other)).toBe(handle);
    await pointer(handle, "pointermove", outward(side, 200), 40);
    expect(mounted.panel(other)!.style.width).toBe("320px");
    await pointer(handle, "pointerup", outward(side, 200), 40);
    const saved = JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!);
    expect(saved[slotKey(side)].tabs).toEqual([]);
    expect(saved[slotKey(other)]).toMatchObject({ tabs: ["a", "b"], width: 320, height: height + 40 });
  } finally { await act(async () => mounted.root.unmount()); }
  const reloaded = await mount(900, "overlay", "saved");
  try {
    expect(reloaded.panel(side)).toBeNull();
    expect(reloaded.panel(other)!.style.width).toBe("320px");
    expect(reloaded.panel(other)!.querySelectorAll(".foss-earth-tab-button")).toHaveLength(2);
  } finally { await act(async () => reloaded.root.unmount()); }
});

it.each(["left", "right"] as const)("reverses a compact %s side switch in the same pointer gesture and cancels without minimizing", async side => {
  for (const cancellation of ["pointercancel", "lostpointercapture"]) {
    const mounted = await mount(412, "overlay", side);
    const resizeStart = vi.fn(), resizeEnd = vi.fn();
    window.addEventListener("foss-earth-panel-resize-start", resizeStart);
    window.addEventListener("foss-earth-panel-resize-end", resizeEnd);
    try {
      await drag(mounted.grip(side)!, -outward(side, 120), 0);
      resizeStart.mockClear(); resizeEnd.mockClear();
      const handle = mounted.grip(side)!;
      await pointer(handle, "pointerdown");
      await pointer(handle, "pointermove", outward(side, 180), 0);
      expect(mounted.panel(opposite(side))!.style.width).toBe("340px");
      await pointer(handle, "pointermove", outward(side, 70), 0);
      expect(mounted.panel(side)!.style.width).toBe("350px");
      expect(mounted.grip(side)).toBe(handle);
      await pointer(handle, cancellation, outward(side, 70), 0);
      await pointer(handle, "pointerup", outward(side, 70), 0);
      expect(mounted.panel(side)!.dataset.collapsed).toBe("false");
      expect(mounted.panel(side)!.style.width).toBe("350px");
      expect(resizeStart).toHaveBeenCalledTimes(1);
      expect(resizeEnd).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => mounted.root.unmount());
      window.removeEventListener("foss-earth-panel-resize-start", resizeStart);
      window.removeEventListener("foss-earth-panel-resize-end", resizeEnd);
    }
  }
});

it.each(["left", "right"] as const)("reveals the opposite drop target only while dragging from the compact %s window, then remembers the tab's new side", async side => {
  const mounted = await mount(390, "overlay", side, "flush");
  const other = opposite(side);
  const data = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "",
    getData: (type: string) => data.get(type) ?? "",
    setData: (type: string, value: string) => { data.set(type, value); },
  };
  const send = (target: HTMLElement, type: string) => act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    target.dispatchEvent(event);
  });
  try {
    expect(mounted.launcher(other)).toBeNull();
    const tab = mounted.panel(side)!.querySelector<HTMLElement>('.foss-earth-tab-shell')!;
    await send(tab, "dragstart");
    expect(mounted.launcher(other)!.classList.contains("foss-earth-panel-launcher-drop-active")).toBe(true);
    await send(tab, "dragend");
    expect(mounted.launcher(other)).toBeNull();
    // Start again and drop A, leaving B's canonical home on the original side.
    await send(tab, "dragstart");
    await send(mounted.launcher(other)!, "drop");
    expect(mounted.panel(other)).not.toBeNull();
    expect(mounted.launcher(side)).toBeNull();
    expect(JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!)[slotKey(other)].tabs).toEqual(["a"]);
    expect(JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!)[slotKey(side)].tabs).toEqual(["b"]);
    await mounted.resizeScreen(900);
    expect(mounted.panel(other)!.querySelector(".foss-earth-tab-button")!.textContent).toBe("A");
    expect(mounted.panel(side)!.querySelector(".foss-earth-tab-button")!.textContent).toBe("B");
  } finally { await act(async () => mounted.root.unmount()); }
});

it.each(["left", "right"] as const)("treats a compact %s grip side switch as an explicit move of all folded tabs", async side => {
  const mounted = await mount(900, "overlay", "both");
  const other = opposite(side);
  try {
    await pointer(mounted.panel(side)!, "pointerdown");
    await mounted.resizeScreen(412);
    await drag(mounted.grip(side)!, -outward(side, 120), 0);
    await drag(mounted.grip(side)!, outward(side, 180), 0);
    expect(mounted.panel(side)).toBeNull();
    expect(mounted.panel(other)!.querySelectorAll(".foss-earth-tab-button")).toHaveLength(2);
    const saved = JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!);
    expect(saved[slotKey(side)].tabs).toEqual([]);
    expect(saved[slotKey(other)].tabs.slice().sort()).toEqual(["a", "b"]);
    await mounted.resizeScreen(900);
    expect(mounted.panel(side)).toBeNull();
    expect(mounted.panel(other)!.querySelectorAll(".foss-earth-tab-button")).toHaveLength(2);
  } finally { await act(async () => mounted.root.unmount()); }
});

it("keeps the corner grip wherever two windows fit", async () => {
  for (const choice of ["auto", "overlay"] as const) {
    const { root, grip } = await mount(900, choice, "both");
    try {
      for (const side of ["left", "right"] as const) {
        const handle = grip(side)!;
        expect(handle.dataset, `${side}, ${choice}`).toMatchObject({ axes: "both", at: "corner" });
        expect(getComputedStyle(handle)[side === "right" ? "left" : "right"], side).toBe("-13px");
      }
    } finally { await act(async () => root.unmount()); }
  }
});

it("widens either window by shrinking the other, whichever was widened first, and a reload shows the same", async () => {
  const outward = (side: "left" | "right", px: number) => (side === "right" ? -px : px);
  for (const first of ["right", "left"] as const) {
    const second = first === "right" ? "left" : "right";
    const { root, panel, grip } = await mount(900, "overlay", "both");
    const widths = () => ({ left: Number.parseFloat(panel("left")!.style.width), right: Number.parseFloat(panel("right")!.style.width) });
    let after: { left: number; right: number };
    try {
      const start = widths();
      await drag(grip(first)!, outward(first, 250), 0);
      const widened = widths();
      expect(widened[first], first).toBeGreaterThan(start[first]);
      expect(widened[second], first).toBeLessThan(start[second]);
      // Then the other one: it grows with the drag, and the first gives way.
      await drag(grip(second)!, outward(second, 100), 0);
      after = widths();
      expect(after[second], `${second} after ${first}`).toBe(widened[second] + 100);
      expect(after[first], `${second} after ${first}`).toBe(widened[first] - 100);
    } finally { await act(async () => root.unmount()); }
    const reloaded = await mount(900, "overlay", "saved");
    try {
      expect({ left: reloaded.panel("left")!.style.width, right: reloaded.panel("right")!.style.width }, `reload after ${first}, ${second}`)
        .toEqual({ left: `${after.left}px`, right: `${after.right}px` });
    } finally { await act(async () => reloaded.root.unmount()); }
  }
});

it("gives a window that made way for a wider one its width back when that one narrows again", async () => {
  const { root, panel, grip } = await mount(900, "overlay", "both");
  try {
    await drag(grip("right")!, -250, 0);
    expect(panel("left")!.style.width).toBe("294px");
    await drag(grip("right")!, 250, 0);
    expect(panel("left")!.style.width).toBe("320px");
    expect(panel("right")!.style.width).toBe("320px");
  } finally { await act(async () => root.unmount()); }
});

it.each([390, 1280])("remembers manually resized heights with widths after a reload at %i px", async screenWidth => {
  const first = await mount(screenWidth, "overlay", "both");
  const sizes: Record<string, { width: string; height: string }> = {};
  try {
    for (const side of ["left", "right"] as const) {
      if (!first.panel(side)) continue;
      await drag(first.grip(side)!, side === "right" ? 20 : -20, -60);
      const panel = first.panel(side)!;
      sizes[side] = { width: panel.style.width, height: panel.style.height };
      const saved = JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!)[side === "left" ? "primary" : "secondary"];
      expect(saved.height).toBe(Number.parseFloat(panel.style.height));
    }
  } finally { await act(async () => first.root.unmount()); }
  const reloaded = await mount(screenWidth, "overlay", "saved");
  try {
    for (const [side, size] of Object.entries(sizes)) {
      const panel = reloaded.panel(side as "left" | "right")!;
      expect({ width: panel.style.width, height: panel.style.height }).toEqual(size);
    }
  } finally { await act(async () => reloaded.root.unmount()); }
});
