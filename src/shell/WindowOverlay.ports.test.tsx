// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay.js";
import { lowestSplitBand } from "../browser/overlay.js";

it("releases geometry, log, focus and layout through the supplied host ports", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const geometryStop = vi.fn(); const logStop = vi.fn(); const clear = vi.fn(); const publish = vi.fn();
  const visibility = vi.fn(); const onOpen = vi.fn(); const onClose = vi.fn();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const api: { current: WindowOverlayHandle<"host"> | null } = { current: null };
  try {
    await act(async () => root.render(<WindowOverlay<"host">
      tabDefinitions={[{ id: "host", label: "Host" }]} renderTabContent={() => <p>Host supplied content</p>}
      context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "host" }}
      restorableTabs={new Set(["host"])} storage={null} overlayApiRef={api} onTabVisibility={visibility} focus={{ onOpen, onClose }}
      geometry={{ observeWidth(_element, listener) { listener(1200); return geometryStop; }, menuBottom: () => null }}
      logSize={{ getWidth: () => null, subscribe: () => logStop }} layoutPort={{ publish, clear }}
    />));
    await act(async () => api.current!.openOrSelectTab("host"));
    expect(host.textContent).toContain("Host supplied content"); expect(visibility).toHaveBeenCalledWith("host", true); expect(onOpen).toHaveBeenCalledWith("host");
    await act(async () => api.current!.toggleTab("host")); expect(onClose).toHaveBeenCalledWith("host");
    await act(async () => api.current!.openOrSelectTab("host"));
    expect(publish).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  expect(api.current).toBeNull(); expect(geometryStop).toHaveBeenCalledOnce(); expect(logStop).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
  expect(visibility).toHaveBeenLastCalledWith("host", false);
});

it("observes phone panel height through the browser when the host supplies only width geometry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let panelHeight = 260;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.classList.contains("foss-earth-dock-panel") ? panelHeight : 30;
    return { left: 12, top: 12, right: 378, bottom: 12 + height, width: 366, height, x: 12, y: 12, toJSON() {} };
  });
  const observers: { element: Element | null; refresh: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    element: Element | null = null;
    refresh: () => void;
    disconnect = vi.fn();
    constructor(refresh: () => void) { this.refresh = refresh; observers.push(this); }
    observe(element: Element) { this.element = element; }
  });
  const publish = vi.fn(); const clear = vi.fn(); const geometryStop = vi.fn();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const api: { current: WindowOverlayHandle<"host"> | null } = { current: null };
  try {
    await act(async () => root.render(<WindowOverlay<"host">
      tabDefinitions={[{ id: "host", label: "Host" }]} renderTabContent={() => <p>Host content</p>}
      context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "host" }}
      restorableTabs={new Set(["host"])} storage={null} overlayApiRef={api}
      geometry={{ observeWidth(_element, listener) { listener(390); return geometryStop; }, menuBottom: () => null }}
      logSize={{ getWidth: () => null, subscribe: () => () => {} }} layoutPort={{ publish, clear }}
    />));
    await act(async () => api.current!.openOrSelectTab("host"));
    const panel = host.querySelector<HTMLElement>('.foss-earth-dock-panel[data-side="right"]')!;
    expect(observers.some(observer => observer.element === panel)).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "stacked", presentation: "split", logVisible: false, secondaryWidth: 390 }));
    panelHeight = 180;
    await act(async () => { for (const observer of observers) if (observer.element === panel) observer.refresh(); });
    expect(document.documentElement.style.getPropertyValue("--foss-world-top")).toBe("192px");
    expect(document.documentElement.dataset.hudInBand).toBe("bottom");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
  expect(observers.length).toBeGreaterThan(0);
  for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledOnce();
  expect(geometryStop).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
});

it("keeps the drawing buffer until a split drag or a browser resize ends", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let panelHeight = 260;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.classList.contains("foss-earth-dock-panel") ? panelHeight : 30;
    return { left: 0, top: 12, right: 390, bottom: 12 + height, width: 390, height, x: 0, y: 12, toJSON() {} };
  });
  const observers: { element: Element | null; refresh: () => void }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    element: Element | null = null;
    refresh: () => void;
    disconnect = vi.fn();
    constructor(refresh: () => void) { this.refresh = refresh; observers.push(this); }
    observe(element: Element) { this.element = element; }
  });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const api: { current: WindowOverlayHandle<"host"> | null } = { current: null };
  try {
    await act(async () => root.render(<WindowOverlay<"host">
      tabDefinitions={[{ id: "host", label: "Host" }]} renderTabContent={() => <p>Host content</p>}
      context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "host" }}
      restorableTabs={new Set(["host"])} storage={null} overlayApiRef={api}
      presentation={{ choice: "split", onChoice() {}, tabsBehindToolbar: false, worldResize: "release" }}
      geometry={{ observeWidth(_element, listener) { listener(390); return () => {}; }, menuBottom: () => null }}
      logSize={{ getWidth: () => null, subscribe: () => () => {} }} layoutPort={{ publish: () => {}, clear: () => {} }}
    />));
    await act(async () => api.current!.openOrSelectTab("host"));
    const panel = host.querySelector<HTMLElement>('.foss-earth-dock-panel[data-side="right"]')!;
    const refresh = () => { for (const observer of observers) if (observer.element === panel) observer.refresh(); };
    await act(async () => refresh());
    expect(document.documentElement.dataset.worldResize).toBe("release");
    expect(document.documentElement.style.getPropertyValue("--foss-world-top")).toBe("272px");
    expect(document.documentElement.style.getPropertyValue("--foss-canvas-top")).toBe("272px");
    window.dispatchEvent(new Event("foss-earth-panel-resize-start"));
    panelHeight = 180;
    await act(async () => refresh());
    expect(document.documentElement.style.getPropertyValue("--foss-world-top")).toBe("192px");
    expect(document.documentElement.style.getPropertyValue("--foss-canvas-top")).toBe("272px");
    window.dispatchEvent(new Event("foss-earth-panel-resize-end"));
    expect(document.documentElement.style.getPropertyValue("--foss-canvas-top")).toBe("192px");
    document.documentElement.dataset.worldDrawHeld = "true";
    panelHeight = 100;
    await act(async () => refresh());
    expect(document.documentElement.style.getPropertyValue("--foss-world-top")).toBe("112px");
    expect(document.documentElement.style.getPropertyValue("--foss-canvas-top")).toBe("192px");
    delete document.documentElement.dataset.worldDrawHeld;
    window.dispatchEvent(new Event("foss-earth-world-draw-commit"));
    expect(document.documentElement.style.getPropertyValue("--foss-canvas-top")).toBe("112px");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--foss-world-top");
    document.documentElement.style.removeProperty("--foss-canvas-top");
    delete document.documentElement.dataset.worldResize;
    delete document.documentElement.dataset.worldDrawHeld;
  }
});

it("follows the lower window and ignores the drop preview", () => {
  const preview = document.createElement("div");
  preview.className = "foss-earth-panel-launcher-drop-active";
  const windowBand = document.createElement("div");
  windowBand.className = "foss-earth-dock-panel";
  const launcher = document.createElement("div");
  launcher.className = "foss-earth-workspace-slot-launcher";
  vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({ bottom: 500 } as DOMRect);
  vi.spyOn(launcher, "getBoundingClientRect").mockReturnValue({ bottom: 40 } as DOMRect);
  vi.spyOn(windowBand, "getBoundingClientRect").mockReturnValue({ bottom: 220 } as DOMRect);
  expect(lowestSplitBand([preview, launcher, windowBand])).toBe(windowBand);
});
