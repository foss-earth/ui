// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DockPanel } from "./DockPanel.js";
import { panelHeightLimit } from "./panelHeight.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("pulls a fullscreen-tall panel back onto the screen when the window gets shorter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const viewport = {
    height: 2000,
    listeners: new Set<() => void>(),
    addEventListener(_type: string, listener: () => void) { this.listeners.add(listener); },
    removeEventListener(_type: string, listener: () => void) { this.listeners.delete(listener); },
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 2000 });

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DockPanel
      side="right"
      width={320}
      maxWidth={320}
      onWidthChange={() => {}}
      collapsed={false}
      onCollapsedChange={() => {}}
      initialHeight={1800}
    />);
  });
  const panel = host.querySelector<HTMLElement>(".foss-earth-dock-panel")!;
  expect(panel.style.height).toBe("1800px");

  viewport.height = 500;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
  await act(async () => { document.dispatchEvent(new Event("fullscreenchange")); });
  expect(panel.style.height).toBe(`${panelHeightLimit(500, 6, 80, 128)}px`);
  await act(async () => root.unmount());
});

it("holds the world resize until the pointer is released", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: string[] = [];
  const onStart = () => seen.push("start");
  const onEnd = () => seen.push("end");
  window.addEventListener("foss-earth-panel-resize-start", onStart);
  window.addEventListener("foss-earth-panel-resize-end", onEnd);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DockPanel side="right" width={320} maxWidth={320} onWidthChange={() => {}} collapsed={false} onCollapsedChange={() => {}} resizeAxes="height" />);
  });
  const handle = host.querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!;
  const point = (type: string, clientY: number) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientY, button: 0 }));
  await act(async () => { point("pointerdown", 40); point("pointermove", 80); });
  expect(seen).toEqual(["start"]);
  await act(async () => { point("pointerup", 80); });
  expect(seen).toEqual(["start", "end"]);
  window.removeEventListener("foss-earth-panel-resize-start", onStart);
  window.removeEventListener("foss-earth-panel-resize-end", onEnd);
  await act(async () => root.unmount());
});

it("paints the split grip above the toolbar, on the window's bottom edge", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DockPanel side="right" width={390} maxWidth={390} onWidthChange={() => {}} collapsed={false} onCollapsedChange={() => {}} resizeAxes="height" liftResizeHandle />);
  });
  const panel = host.querySelector<HTMLElement>(".foss-earth-dock-panel")!;
  panel.getBoundingClientRect = () => ({ left: 0, top: 12, width: 390, height: 200, right: 390, bottom: 212, x: 0, y: 12, toJSON() {} });
  const grip = document.body.querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!;
  expect(panel.contains(grip)).toBe(false);
  expect(grip.dataset.lifted).toBe("true");
  await act(async () => { window.dispatchEvent(new Event("resize")); });
  expect(grip.style.left).toBe("183px");
  expect(grip.style.top).toBe("200px");
  await act(async () => root.unmount());
  expect(document.body.querySelector(".foss-earth-dock-panel-resize-handle")).toBeNull();
});
