// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay.js";
import { browserOverlayLayout, lowestSplitBand } from "../browser/overlay.js";
import { UI_PARAMETERS, WINDOWS_PRESENTATION_ID, WORLD_EDGES_ID } from "../settings/uiParameters.js";
import type { WindowOverlayGeometry } from "../windowing/core/overlayPorts.js";

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
      presentation={{ choice: "split", onChoice() {}, tabsBehindToolbar: false }}
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

it("keeps the default and manually chosen edges through phone and wide layouts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = Number.parseFloat(this.style.top) || 0;
    const height = this.classList.contains("foss-earth-dock-panel") ? 200 : 30;
    return { left: 0, top, right: 300, bottom: top + height, width: 300, height, x: 0, y: top, toJSON() {} };
  });
  const root = document.documentElement;
  const host = document.createElement("div"); document.body.append(host); const react = createRoot(host);
  const api: { current: WindowOverlayHandle<"left" | "right"> | null } = { current: null };
  const layout = browserOverlayLayout(root);
  let changeWidth: ((width: number) => void) | undefined;
  const geometry: WindowOverlayGeometry = {
    observeWidth(_element, listener) { changeWidth = listener; listener(1440); return () => {}; },
    menuBottom: () => null,
  };
  const defaultFlush = UI_PARAMETERS.find(parameter => parameter.id === WORLD_EDGES_ID)!.default;
  const defaultPresentation = UI_PARAMETERS.find(parameter => parameter.id === WINDOWS_PRESENTATION_ID)!.default;
  expect(defaultFlush).toBe(true);
  expect(defaultPresentation).toBe("overlay");
  const render = (edges?: "inset" | "flush", choice: "overlay" | "split" | "auto" = "auto") => react.render(<WindowOverlay<"left" | "right">
    tabDefinitions={[{ id: "left", label: "Left" }, { id: "right", label: "Right" }]} renderTabContent={(id) => <p>{id}</p>}
    context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "left" }}
    restorableTabs={new Set()} storage={null} overlayApiRef={api}
    geometry={geometry}
    logSize={{ getWidth: () => null, subscribe: () => () => {} }} layoutPort={layout}
    presentation={edges === undefined ? undefined : { choice, onChoice() {}, tabsBehindToolbar: false, edges }}
  />);
  const panel = (side: string) => host.querySelector<HTMLElement>(`.foss-earth-dock-panel[data-side="${side}"]`)!;
  const resize = (width: number) => act(async () => changeWidth!(width));
  const expectEdges = async (edges: "inset" | "flush", presentation: "overlay" | "split" = "overlay") => {
    for (const width of [1440, 700, 390, 515, 516, 1280, 390, 1440]) {
      await resize(width);
      expect(root.dataset.worldEdges, `${edges} at ${width}`).toBe(edges === "flush" ? "flush" : undefined);
      expect(root.dataset.worldPresentation, `${edges} at ${width}`).toBe(presentation);
      if (presentation === "overlay") {
        expect(root.style.getPropertyValue("--foss-world-top")).toBe("");
        expect(root.style.getPropertyValue("--foss-canvas-top")).toBe("");
      } else {
        const bottom = Math.max(...[...host.querySelectorAll<HTMLElement>(".foss-earth-dock-panel")].map(dock => dock.getBoundingClientRect().bottom));
        expect(root.style.getPropertyValue("--foss-world-top"), `${edges} at ${width}`).toBe(`${bottom}px`);
      }
      const shown = width < 516 ? [panel("right")] : [panel("left"), panel("right")];
      for (const dock of shown) expect(dock.style[dock.dataset.side === "left" ? "left" : "right"], `${edges} at ${width}`).toBe(edges === "flush" || presentation === "split" && width < 516 ? "0px" : "6px");
      if (edges === "flush") expect(root.dataset.logVisible).toBe("false");
    }
  };
  try {
    // Omitting presentation uses the same flush edges as a new settings registry.
    await act(async () => render());
    await act(async () => { api.current!.openTabInSlot("left", "primary"); api.current!.openTabInSlot("right", "secondary"); });
    await expectEdges("flush");
    await act(async () => render(defaultFlush ? "flush" : "inset", defaultPresentation as "overlay"));
    await expectEdges("flush");
    // The host changes the prop when the user changes the setting manually.
    await act(async () => render("inset"));
    await expectEdges("inset");
    expect(panel("left").style.left).toBe("6px");
    expect(root.dataset.logVisible).toBe("true");
    expect(root.dataset.worldEdges).toBeUndefined();
    await act(async () => render("flush"));
    await expectEdges("flush");
    expect(panel("left").style.left).toBe("0px");
    expect(panel("right").style.right).toBe("0px");
    expect(root.dataset.worldEdges).toBe("flush");
    expect(root.dataset.logVisible).toBe("false");
    await act(async () => render("inset"));
    await expectEdges("inset");
    expect(panel("left").style.left).toBe("6px");
    expect(root.dataset.worldEdges).toBeUndefined();
    await act(async () => render("flush", "split"));
    await expectEdges("flush", "split");
    await act(async () => render("inset", "split"));
    await expectEdges("inset", "split");
  } finally {
    await act(async () => react.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
  expect(root.dataset.worldEdges).toBeUndefined();
});
