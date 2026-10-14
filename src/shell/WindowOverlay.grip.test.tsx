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
function layOutPanels(screenWidth: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const panel = this.classList.contains("foss-earth-dock-panel");
    const width = panel ? (this.style.width.endsWith("px") ? Number.parseFloat(this.style.width) : screenWidth) : 0;
    const height = panel ? Number.parseFloat(this.style.height) || 30 : 0;
    const left = panel && this.dataset.side === "right" ? screenWidth - width : 0;
    return { left, top: 0, width, height, right: left + width, bottom: height, x: left, y: 0, toJSON() {} } as DOMRect;
  });
}

async function mount(screenWidth: number, choice: Choice, open: Open) {
  const slot = (tabs: Tab[]) => ({ tabs, activeTab: tabs[0] ?? null, collapsed: false });
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: slot(open === "both" ? ["a"] : open === "left" ? ["a", "b"] : []),
    secondary: slot(open === "both" ? ["b"] : open === "right" ? ["a", "b"] : []),
  }));
  layOutPanels(screenWidth);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<WindowOverlay<Tab>
    tabDefinitions={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
    renderTabContent={tabId => <p>{tabId}</p>}
    context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "a" }}
    restorableTabs={new Set<Tab>(["a", "b"])} storage={localStorage}
    geometry={{ observeWidth(_element, listener) { listener(screenWidth); return () => {}; }, observeHeight(_element, listener) { listener(240); return () => {}; }, menuBottom: () => null }}
    logSize={{ getWidth: () => null, subscribe: () => () => {} }}
    layoutPort={browserOverlayLayout(document.documentElement)}
    presentation={choice === undefined ? undefined : { choice, onChoice: () => {}, tabsBehindToolbar: false, toolbarEdge: "bottom" }}
  />));
  const panel = (side: "left" | "right") => host.querySelector<HTMLElement>(`.foss-earth-dock-panel[data-side="${side}"]`);
  // A split grip is painted on the body, above the toolbar.
  const grip = (side: "left" | "right") => document.querySelector<HTMLElement>(`.foss-earth-dock-panel-resize-handle[data-side="${side}"]`);
  return { root, panel, grip };
}

/** A press, a drag and a release on a grip, by its center. */
async function drag(grip: HTMLElement, dx: number, dy: number): Promise<void> {
  grip.setPointerCapture = () => {}; grip.releasePointerCapture = () => {};
  const send = (type: string, x: number, y: number) => act(async () => {
    grip.dispatchEvent(new PointerEvent(type, { button: 0, clientX: x, clientY: y, pointerId: 1, bubbles: true }));
  });
  await send("pointerdown", 200, 200);
  await send("pointermove", 200 + dx, 200 + dy);
  await send("pointerup", 200 + dx, 200 + dy);
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

it("lets a Galaxy Note 20 Ultra narrow its overlay window from a grip mid-bottom, and keeps that width", async () => {
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
    // Back past the full width, it stops at the screen's edges.
    await drag(grip("right")!, -400, 0);
    expect(panel("right")!.style.width).toBe("400px");
  } finally { await act(async () => root.unmount()); }
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
