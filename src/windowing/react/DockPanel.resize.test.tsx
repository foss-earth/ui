// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DockPanel } from "./DockPanel.js";

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it.each(["left", "right"] as const)("continues a captured resize from %s through full width and back", async startSide => {
  const onWidthChange = vi.fn();
  const onResizeEnd = vi.fn();
  const resized: string[] = [];
  const ended = vi.fn();
  window.addEventListener("foss-earth-panel-resize-end", ended);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Window() {
    const [size, setSize] = useState({ side: startSide, width: 300 });
    return <DockPanel side={size.side} width={size.width} maxWidth={400} onWidthChange={onWidthChange}
      onResizeSideChange={(side, width) => { resized.push("side"); setSize({ side, width }); }} onResizeEnd={onResizeEnd}
      onHeightChange={() => { resized.push("height"); }}
      initialHeight={300} collapsed={false} onCollapsedChange={() => {}} resizeGripAt="bottom" />;
  }
  await act(async () => root.render(<Window />));
  const panel = host.querySelector<HTMLElement>(".foss-earth-dock-panel")!;
  panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300, x: 0, y: 0, toJSON() {} });
  const handle = host.querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!;
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  const direction = startSide === "left" ? 1 : -1;
  const point = async (type: string, distance: number) => act(async () => {
    handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: 200 + direction * distance, clientY: 300 }));
  });
  await point("pointerdown", 0);
  await point("pointermove", 80);
  expect(panel.style.width).toBe("400px");
  await point("pointermove", 150);
  expect(resized).toEqual(["height", "side", "height", "side"]);
  expect(panel.dataset.side).toBe(startSide === "left" ? "right" : "left");
  expect(panel.style.width).toBe("350px");
  expect(host.querySelector(".foss-earth-dock-panel-resize-handle")).toBe(handle);
  await point("pointermove", 0);
  expect(panel.dataset.side).toBe(startSide);
  expect(panel.style.width).toBe("300px");
  await point("pointerup", 0);
  await point("lostpointercapture", 0);
  expect(onWidthChange).not.toHaveBeenCalled();
  expect(onResizeEnd).toHaveBeenCalledTimes(1);
  expect(ended).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  expect(onResizeEnd).toHaveBeenCalledTimes(1);
  window.removeEventListener("foss-earth-panel-resize-end", ended);
});

it.each(["pointercancel", "lostpointercapture", "unmount"])("ends an interrupted resize once on %s", async interruption => {
  const onResizeEnd = vi.fn();
  const onCollapsedChange = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<DockPanel side="right" width={300} maxWidth={400} onWidthChange={() => {}}
    collapsed={false} onCollapsedChange={onCollapsedChange} onResizeEnd={onResizeEnd} resizeAxes="height" />));
  const handle = host.querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!;
  const point = (type: string, y: number) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientY: y }));
  await act(async () => { point("pointerdown", 100); point("pointermove", 150); });
  await act(async () => {
    if (interruption === "unmount") root.unmount();
    else { point(interruption, 150); point("pointerup", 150); }
  });
  expect(onResizeEnd).toHaveBeenCalledTimes(1);
  expect(onCollapsedChange).not.toHaveBeenCalled();
  if (interruption !== "unmount") await act(async () => root.unmount());
  expect(onResizeEnd).toHaveBeenCalledTimes(1);
});
