// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay.js";

it("fits an entry tab on a phone, honors its resize, and restores the ordinary window height", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerHeight", 844);
  const observers: { refresh(): void; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn();
    constructor(public refresh: () => void) { observers.push(this); }
    observe() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.classList.contains("foss-earth-dock-panel-header") ? 30
      : this.classList.contains("foss-earth-dock-panel") ? Math.min(Number.parseFloat(this.style.height) || 30, 422) : 0;
    return { left: 12, top: 12, right: 378, bottom: 12 + height, width: 366, height, x: 12, y: 12, toJSON() {} };
  });
  const style = document.createElement("style");
  style.textContent = ".foss-earth-dock-panel { border: 1px solid; }";
  document.head.append(style);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  type Tab = "map" | "entry" | "settings";
  const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
  let desiredHeight: number | null = 60;
  const measureEntry = vi.fn((body: HTMLElement) => body.querySelector("[data-photograph]") ? desiredHeight : null);
  const geometry = { observeWidth(_element: HTMLElement, listener: (width: number) => void) { listener(390); return () => {}; }, menuBottom: () => null };
  const logSize = { getWidth: () => null, subscribe: () => () => {} };
  const layoutPort = { publish() {}, clear() {} };
  const render = (active: boolean, ready = true) => act(async () => root.render(<WindowOverlay<Tab>
    tabDefinitions={[{ id: "map", label: "Map" }, { id: "entry", label: "Entry" }, { id: "settings", label: "Settings" }]}
    renderTabContent={id => id === "entry" ? <div><p data-photograph>Photograph information</p><details><summary>Links</summary><p>Linked images</p></details></div> : <p>{id}</p>}
    context={{ active, ready, entryTabId: "entry", baseOnlyTabs: new Set(["map"]), contextOnlyTabs: new Set(["entry", "settings"]), measureEntry }}
    restorableTabs={new Set(["map"])} storage={null} overlayApiRef={api} geometry={geometry} logSize={logSize} layoutPort={layoutPort}
  />));
  const panel = () => host.querySelector<HTMLElement>('.foss-earth-dock-panel[data-side="right"]')!;
  const resize = async (height: number) => {
    const grip = panel().querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!;
    grip.setPointerCapture = () => {}; grip.releasePointerCapture = () => {};
    const start = panel().getBoundingClientRect().height;
    const point = (type: string, clientY: number) => act(async () => {
      grip.dispatchEvent(new PointerEvent(type, { button: 0, clientX: 195, clientY, pointerId: 1, bubbles: true }));
    });
    await point("pointerdown", start); await point("pointermove", height); await point("pointerup", height);
  };
  const changePhotograph = (text: string) => act(async () => { panel().querySelector<HTMLElement>("[data-photograph]")!.textContent = text; });
  try {
    await render(false);
    await act(async () => api.current!.openOrSelectTab("map"));
    await resize(340);
    expect(panel().style.height).toBe("340px");

    await render(true, false);
    expect(panel().dataset.collapsed).toBe("true");
    expect(measureEntry).not.toHaveBeenCalled();
    await render(true);
    expect(panel().style.height).toBe("92px"); // 60 px of photograph plus actual header and borders; fitting may be below the drag minimum.
    expect(panel().style.maxHeight).toBe("50dvh");

    desiredHeight = 80;
    await changePhotograph("The host replaced its image metadata");
    expect(panel().style.height).toBe("112px");
    desiredHeight = 100;
    await act(async () => { for (const observer of observers) observer.refresh(); });
    expect(panel().style.height).toBe("132px");
    await act(async () => { panel().querySelector("details")!.open = true; });
    expect(panel().style.height).toBe("132px"); // Expanding another section leaves photograph-only fitting intact.

    await resize(240);
    desiredHeight = 500;
    await changePhotograph("More text after a manual resize");
    expect(panel().style.height).toBe("240px");
    await act(async () => api.current!.openOrSelectTab("settings"));
    expect(panel().style.height).toBe("340px");
    await act(async () => api.current!.openOrSelectTab("entry"));
    expect(panel().style.height).toBe("240px");
    await render(false);
    expect(panel().style.height).toBe("340px");

    // A new visit fits again. Its desired height can exceed the phone cap without corrupting its header measurement.
    await render(true);
    expect(panel().style.height).toBe("532px");
    expect(panel().getBoundingClientRect().height).toBe(422);
    desiredHeight = 200;
    await changePhotograph("Shorter text while the window is capped");
    expect(panel().style.height).toBe("232px");
    desiredHeight = null;
    await changePhotograph("An unavailable measurement leaves the last valid fit alone");
    expect(panel().style.height).toBe("232px");
    desiredHeight = 0;
    await changePhotograph("An unmeasurable DOM also leaves the fit alone");
    expect(panel().style.height).toBe("232px");
  } finally {
    await act(async () => root.unmount()); host.remove(); style.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
  for (const observer of observers) expect(observer.disconnect).toHaveBeenCalled();
});
