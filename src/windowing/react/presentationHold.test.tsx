// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DockPanel } from "./DockPanel.js";
import { TabStrip } from "./TabStrip.js";
import { placePresentationSwitch, PRESENTATION_HOLD_MS } from "./presentationHold.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { button: 0, clientX: x, clientY: y, pointerId: 1, bubbles: true });
}

it("keeps the overlay switch on screen when the press is at the top edge", () => {
  const size = { width: 160, height: 40 };
  const viewport = { width: 390, height: 700 };
  expect(placePresentationSwitch({ x: 40, y: 8 }, size, viewport).top).toBeGreaterThanOrEqual(8);
  expect(placePresentationSwitch({ x: 200, y: 360 }, size, viewport)).toEqual({ left: 120, top: 308 });
  expect(placePresentationSwitch({ x: 4, y: 400 }, size, viewport).left).toBe(8);
});

it("opens the presentation menu from a still press on the resize grip, and still minimizes a tap", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const onHold = vi.fn();
  const onCollapsed = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DockPanel
      side="right" width={320} maxWidth={320} onWidthChange={() => {}}
      collapsed={false} onCollapsedChange={onCollapsed} onHoldPresentation={onHold}
    />);
  });
  const grip = host.querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!;
  await act(async () => { grip.dispatchEvent(pointer("pointerdown", 40, 80)); });
  await act(async () => { vi.advanceTimersByTime(PRESENTATION_HOLD_MS); });
  expect(onHold).toHaveBeenCalledWith({ x: 40, y: 80 });
  await act(async () => { grip.dispatchEvent(pointer("pointerup", 40, 80)); });
  expect(onCollapsed).not.toHaveBeenCalled();

  onHold.mockClear();
  await act(async () => {
    grip.dispatchEvent(pointer("pointerdown", 40, 80));
    grip.dispatchEvent(pointer("pointerup", 40, 80));
  });
  expect(onHold).not.toHaveBeenCalled();
  expect(onCollapsed).toHaveBeenCalledWith(true);
  await act(async () => root.unmount());
});

it("does not open the menu when the press moves, and opens it from a still tab", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const onHold = vi.fn();
  const onSelect = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<TabStrip
      openTabs={["map"]} activeTab="map" availableTabs={[]} addMenuOpen={false}
      onSelectTab={onSelect} onCloseTab={() => {}} onOpenTab={() => {}}
      onAddMenuOpenChange={() => {}} getLabel={(id) => id} onHoldPresentation={onHold}
    />);
  });
  const tab = host.querySelector<HTMLElement>(".foss-earth-tab-shell")!;
  await act(async () => {
    tab.dispatchEvent(pointer("pointerdown", 10, 10));
    window.dispatchEvent(pointer("pointermove", 30, 10));
  });
  await act(async () => { vi.advanceTimersByTime(PRESENTATION_HOLD_MS); });
  expect(onHold).not.toHaveBeenCalled();

  await act(async () => { tab.dispatchEvent(pointer("pointerdown", 12, 14)); });
  await act(async () => { vi.advanceTimersByTime(PRESENTATION_HOLD_MS); });
  expect(onHold).toHaveBeenCalledWith({ x: 12, y: 14 });
  await act(async () => { tab.querySelector("button")!.click(); });
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
