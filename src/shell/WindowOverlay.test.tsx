// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FixtureOverlay as WindowOverlay, type FixtureOverlayHandle as WindowOverlayHandle, type SphereTabs, type SphereTabsSnapshot } from "../../tests/fixtures/earthOverlay.js";
import { SAVED_WORKSPACE_STORAGE_KEY } from "../browser/workspace.js";
import { GAME_LOG_SIZE_EVENT, type GameLogSizeChange } from "../log/createGameLog.js";
import { WindowOverlay as SharedWindowOverlay, type WindowOverlayHandle as ShellHandle } from "./WindowOverlay.js";
import { browserOverlayLayout } from "../browser/overlay.js";
import type { WindowOverlayGeometry } from "../windowing/core/overlayPorts.js";

// Each test starts from a device with nothing saved.
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("follows a manually selected phone split's height and restores both wider window homes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["left-tab"], activeTab: "left-tab", collapsed: false, width: 340 },
    secondary: { tabs: ["right-tab"], activeTab: "right-tab", collapsed: false, width: 300 },
  }));
  let changeWidth: ((width: number) => void) | undefined;
  let heightElement: HTMLElement | null = null;
  const expandedHeight = 260;
  const geometry: WindowOverlayGeometry = {
    observeWidth(_element, listener) { changeWidth = listener; listener(1200); return () => {}; },
    observeHeight(element, listener) {
      heightElement = element;
      listener(element.dataset.collapsed === "false" ? expandedHeight : 30);
      return () => { heightElement = null; };
    },
    menuBottom: () => null,
  };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const slot = (side: "left" | "right") => host.querySelector<HTMLElement>(`[data-side="${side}"]`);
  const labels = (side: "left" | "right") => Array.from(slot(side)?.querySelectorAll(".foss-earth-tab-button") ?? [], button => button.textContent);
  const logTop = () => document.documentElement.style.getPropertyValue("--foss-log-top");
  const resize = async (width: number) => act(async () => changeWidth!(width));
  const selectedTab = () => slot("right")!.querySelector<HTMLButtonElement>(".foss-earth-tab-shell-selected .foss-earth-tab-button")!;
  const render = (choice: "overlay" | "split") => root.render(<SharedWindowOverlay<"left-tab" | "right-tab">
    tabDefinitions={[{ id: "left-tab", label: "Left tab" }, { id: "right-tab", label: "Right tab" }]}
    renderTabContent={tabId => <p>{tabId}</p>} geometry={geometry}
    presentation={{ choice, onChoice() {}, tabsBehindToolbar: false, edges: "inset" }}
    context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "left-tab" }}
    restorableTabs={new Set(["left-tab", "right-tab"])} storage={localStorage}
    logSize={{ getWidth: () => null, subscribe: () => () => {} }} layoutPort={browserOverlayLayout(document.documentElement)}
  />);
  await act(async () => render("overlay"));
  try {
    expect(labels("left")).toEqual(["Left tab"]);
    expect(labels("right")).toEqual(["Right tab"]);
    await act(async () => render("split"));
    await resize(390);
    expect(document.documentElement.dataset.dockLayout).toBe("stacked");
    expect(document.documentElement.dataset.logVisible).toBe("false");
    expect(document.documentElement.dataset.worldPresentation).toBe("split");
    expect(slot("left")).toBeNull();
    expect(labels("right")).toEqual(["Right tab", "Left tab"]);
    expect(heightElement).toBe(slot("right"));
    expect(slot("right")!.style.width).toBe("390px");
    expect(slot("right")!.style.maxWidth).toBe("390px");
    expect(slot("right")!.style.maxHeight).toBe("50dvh");
    expect(logTop()).toBe("0px");
    // The full-width window's grip changes only its height: a sideways drag past the minimum width neither narrows nor minimizes it.
    const grip = document.querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!;
    expect(grip.dataset.axes).toBe("height");
    grip.setPointerCapture = () => {}; grip.releasePointerCapture = () => {};
    slot("right")!.getBoundingClientRect = () => ({ left: 12, top: 12, width: 366, height: 260, right: 378, bottom: 272, x: 12, y: 12, toJSON() {} });
    const point = (type: string, clientX: number, clientY: number) => act(async () => { grip.dispatchEvent(new PointerEvent(type, { button: 0, clientX, clientY, pointerId: 1, bubbles: true })); });
    await point("pointerdown", 195, 268); await point("pointermove", 445, 308); await point("pointerup", 445, 308);
    expect(slot("right")!.dataset.collapsed).toBe("false");
    expect(slot("right")!.style.width).toBe("390px");
    expect(slot("right")!.style.height).toBe("300px");
    // A touch the browser takes for itself is no click on the grip, which would minimize.
    await point("pointerdown", 195, 308); await point("pointercancel", 195, 308);
    expect(slot("right")!.dataset.collapsed).toBe("false");
    await act(async () => selectedTab().click());
    expect(slot("right")!.dataset.collapsed).toBe("true");
    await act(async () => selectedTab().click());
    expect(slot("right")!.dataset.collapsed).toBe("false");
    await act(async () => render("overlay"));
    await resize(700);
    expect(document.documentElement.dataset.dockLayout).toBe("columns");
    expect(document.documentElement.dataset.logVisible).toBe("false");
    expect(labels("left")).toEqual(["Left tab"]);
    expect(labels("right")).toEqual(["Right tab"]);
    expect(heightElement).toBeNull();
    await resize(1200);
    expect(document.documentElement.dataset.dockLayout).toBe("dual");
    expect(document.documentElement.dataset.logVisible).toBe("true");
    expect(labels("left")).toEqual(["Left tab"]);
    expect(labels("right")).toEqual(["Right tab"]);
    expect(slot("left")!.style.width).toBe("340px");
    expect(slot("right")!.style.width).toBe("300px");
    expect(slot("right")!.querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!.dataset.axes).toBe("both");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Left tab tab"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Right tab tab"]')!.click());
    await act(async () => render("split"));
    await resize(390);
    expect(heightElement?.classList.contains("foss-earth-workspace-slot-launcher")).toBe(true);
    expect(document.documentElement.dataset.logVisible).toBe("false");
  } finally { await act(async () => root.unmount()); }
  expect(document.documentElement.style.getPropertyValue("--foss-log-top")).toBe("");
});

it.each(["left", "right"] as const)("keeps the %s window widened out of two on its side, with the log beside it and then under it, in one drag", async (side) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["left-tab"], activeTab: "left-tab", collapsed: false, width: 320 },
    secondary: { tabs: ["right-tab"], activeTab: "right-tab", collapsed: false, width: 320 },
  }));
  let heightElement: HTMLElement | null = null;
  const geometry: WindowOverlayGeometry = {
    observeWidth(_element, listener) { listener(1280); return () => {}; },
    observeHeight(element, listener) { heightElement = element; listener(260); return () => { heightElement = null; }; },
    menuBottom: () => null,
  };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const html = document.documentElement;
  const other = side === "left" ? "right" : "left";
  const slot = (name: "left" | "right") => host.querySelector<HTMLElement>(`[data-side="${name}"]`);
  const labels = (name: "left" | "right") => Array.from(slot(name)?.querySelectorAll(".foss-earth-tab-button") ?? [], button => button.textContent);
  const variable = (name: string) => html.style.getPropertyValue(name);
  await act(async () => root.render(<SharedWindowOverlay<"left-tab" | "right-tab">
    tabDefinitions={[{ id: "left-tab", label: "Left tab" }, { id: "right-tab", label: "Right tab" }]}
    renderTabContent={tabId => <p>{tabId}</p>} geometry={geometry}
    presentation={{ choice: "auto", onChoice() {}, tabsBehindToolbar: false, edges: "inset" }}
    context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "left-tab" }}
    restorableTabs={new Set(["left-tab", "right-tab"])} storage={localStorage}
    logSize={{ getWidth: () => null, subscribe: () => () => {} }} layoutPort={browserOverlayLayout(html)}
  />));
  try {
    expect(html.dataset.dockLayout).toBe("dual");
    const panel = slot(side)!;
    const grip = panel.querySelector<HTMLElement>(".foss-earth-dock-panel-resize-handle")!;
    grip.setPointerCapture = () => {}; grip.releasePointerCapture = () => {};
    const left = side === "left" ? 12 : 1280 - 12 - 320;
    panel.getBoundingClientRect = () => ({ left, top: 12, width: 320, height: 260, right: left + 320, bottom: 272, x: left, y: 12, toJSON() {} });
    // The grip is on the window's inner corner; widening moves it toward the middle.
    const startX = side === "left" ? left + 320 : left;
    const widenTo = (width: number) => act(async () => { grip.dispatchEvent(new PointerEvent("pointermove", { button: 0, clientX: startX + (side === "left" ? 1 : -1) * (width - 320), clientY: 272, pointerId: 1, bubbles: true })); });
    await act(async () => { grip.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: startX, clientY: 272, pointerId: 1, bubbles: true })); });

    await widenTo(536);
    expect(html.dataset.dockLayout).toBe("dual");
    await widenTo(537);
    expect(html.dataset.dockLayout).toBe("columns");
    expect(html.dataset.logVisible).toBe("false");
    expect(html.dataset.dockSide).toBe(side);
    expect(slot(other)).not.toBeNull();
    expect(slot(side)).toBe(panel);
    expect(panel.querySelector(".foss-earth-dock-panel-resize-handle")).toBe(grip);
    expect(labels(side)).toEqual(side === "left" ? ["Left tab"] : ["Right tab"]);
    expect(labels(other)).toEqual(side === "left" ? ["Right tab"] : ["Left tab"]);
    expect(panel.style.width).toBe("537px");
    expect(variable("--foss-log-width")).toBe("0px");

    await widenTo(1085);
    expect(html.dataset.dockLayout).toBe("columns");
    expect(panel.style.width).toBe("1084px");
    expect(slot(other)).not.toBeNull();
    expect(grip.dataset.axes).toBe("both");
    expect(heightElement).toBeNull();

    // Narrowed in the same drag, both windows stay, then the log returns between them.
    await widenTo(700);
    expect(html.dataset.dockLayout).toBe("columns");
    await widenTo(420);
    await act(async () => { grip.dispatchEvent(new PointerEvent("pointerup", { button: 0, clientX: startX, clientY: 272, pointerId: 1, bubbles: true })); });
    expect(html.dataset.dockLayout).toBe("dual");
    expect(labels("left")).toEqual(["Left tab"]);
    expect(labels("right")).toEqual(["Right tab"]);
    expect(slot(side)!.style.width).toBe("420px");
    expect(slot(other)!.style.width).toBe("320px");
  } finally { await act(async () => root.unmount()); }
  expect(html.dataset.dockSide).toBeUndefined();
});

it("owns responsive launchers, cross-side tab moves, minimize/restore, and injected host content", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let width = 1200;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const apply = vi.fn();
  let beforeUnmount = 0;
  const click = async (selector: string) => {
    const button = host.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  };
  const open = async (side: string, label: string) => {
    await click(`[aria-label="Open ${side} panel"]`);
    const item = Array.from(host.querySelectorAll<HTMLButtonElement>(".foss-earth-new-tab-choice")).find(button => button.textContent === label)!;
    await act(async () => item.click());
  };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={apply}
    additionalTabs={[{ id: "aircraft", label: "Aircraft" }]}
    renderAdditionalTab={() => <p>Aircraft controls</p>}
  />));
  try {
    expect(host.querySelector('[aria-label="Open left panel"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Open right panel"]')).not.toBeNull();
    await open("left", "Location");
    await open("right", "Aircraft");
    const right = host.querySelector<HTMLElement>('[data-side="right"]')!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "location" } });
    await act(async () => right.dispatchEvent(drop));
    expect(host.querySelector('[aria-label="Open left panel"]')).not.toBeNull();
    expect(right.querySelectorAll(".foss-earth-tab-button")).toHaveLength(2);
    await click('[data-side="right"] .foss-earth-tab-shell-selected .foss-earth-tab-button');
    expect(right.dataset.collapsed).toBe("true");
    await click('[data-side="right"] .foss-earth-tab-shell-selected .foss-earth-tab-button');
    expect(right.dataset.collapsed).toBe("false");
    await click('[aria-label="Close Location tab"]');
    await open("left", "Location");
    width = 390;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector('[aria-label="Open right panel"]')).toBeNull();
    expect(host.querySelector('[data-side="right"]')).toBeNull();
    expect(host.querySelector('[data-side="left"]')!.querySelectorAll(".foss-earth-tab-button")).toHaveLength(2);
    // Location/search behavior stays in engine; this fixture renders host content only.
    width = 1200;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector('[data-side="left"] .foss-earth-tab-button')?.textContent).toBe("Location");
    await click('[aria-label="Close Location tab"]');
    await click('[aria-label="Close Aircraft tab"]');
    expect(host.querySelector('[aria-label="Open right panel"]')).not.toBeNull();
    beforeUnmount = disconnect.mock.calls.length;
  } finally { await act(async () => root.unmount()); }
  expect(disconnect.mock.calls.length).toBeGreaterThan(beforeUnmount);
});

it("folds tabs for a growing log and restores their homes without resurrecting closed tabs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const api: { current: WindowOverlayHandle<"debug"> | null } = { current: null };
  const logSize = async (width: number) => act(async () => {
    window.dispatchEvent(new CustomEvent<GameLogSizeChange>(GAME_LOG_SIZE_EVENT, { detail: { width, resized: true } }));
  });
  await act(async () => root.render(<WindowOverlay
    getViewState={() => null} setViewState={() => {}} overlayApiRef={api}
    additionalTabs={[{ id: "debug", label: "Debug" }]} renderAdditionalTab={() => <p>Debug</p>}
  />));
  try {
    await act(async () => api.current!.openOrSelectTab("debug"));
    await logSize(960);
    expect(document.documentElement.dataset.dockLayout).toBe("columns");
    expect(document.documentElement.dataset.logVisible).toBe("false");
    expect(host.querySelector('[data-side="left"] .foss-earth-tab-button')?.textContent).toBe("Debug");
    await logSize(860);
    expect(document.documentElement.dataset.dockLayout).toBe("dual");
    expect(document.documentElement.style.getPropertyValue("--foss-log-center")).toBe("640px");
    expect(host.querySelector('[data-side="left"] .foss-earth-tab-button')?.textContent).toBe("Debug");
    await logSize(960);
    await act(async () => api.current!.toggleTab("debug"));
    await logSize(860);
    expect(host.querySelector('[aria-label="Open left panel"]')).not.toBeNull();
    expect(host.querySelector('[data-side="right"] .foss-earth-tab-button')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("opens or selects a tab on the left and keeps it there when the browser narrows", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let width = 1200;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const overlayApiRef: { current: WindowOverlayHandle<"debug"> | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    additionalTabs={[{ id: "debug", label: "Debug" }]}
    renderAdditionalTab={() => <p>Debug panel</p>}
    overlayApiRef={overlayApiRef}
  />));
  try {
    expect(overlayApiRef.current).not.toBeNull();
    await act(async () => overlayApiRef.current!.openOrSelectTab("debug"));
    const left = host.querySelector<HTMLElement>('[data-side="left"]')!;
    expect(left.querySelector(".foss-earth-tab-button")?.textContent).toBe("Debug");
    expect(document.documentElement.dataset.dockLayout).toBe("dual");
    expect(left.dataset.collapsed).toBe("false");
    await act(async () => left.querySelector<HTMLButtonElement>(".foss-earth-tab-button")!.click());
    expect(left.dataset.collapsed).toBe("true");
    await act(async () => overlayApiRef.current!.openOrSelectTab("debug"));
    expect(left.dataset.collapsed).toBe("false");
    expect(left.querySelector(".foss-earth-tab-shell-selected .foss-earth-tab-button")?.textContent).toBe("Debug");
    width = 390;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(host.querySelector('[data-side="right"]')).toBeNull();
    expect(document.documentElement.dataset.dockLayout).toBe("stacked");
    expect(host.querySelector('[data-side="left"] .foss-earth-tab-button')?.textContent).toBe("Debug");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Debug tab"]')!.click());
    await act(async () => overlayApiRef.current!.openOrSelectTab("debug"));
    expect(host.querySelector('[data-side="right"]')).toBeNull();
    expect(host.querySelector('[data-side="left"] .foss-earth-tab-button')?.textContent).toBe("Debug");
  } finally { await act(async () => root.unmount()); }
});

it("lets the host veto a tab close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const allowClose = vi.fn(() => false);
  const overlayApiRef: { current: WindowOverlayHandle<"debug"> | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    additionalTabs={[{ id: "debug", label: "Debug" }]}
    renderAdditionalTab={() => <p>Debug panel</p>}
    overlayApiRef={overlayApiRef}
    onBeforeCloseTab={allowClose}
  />));
  try {
    await act(async () => overlayApiRef.current!.openOrSelectTab("debug"));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Debug tab"]')!.click());
    expect(allowClose).toHaveBeenCalledWith("debug");
    expect(host.querySelector(".foss-earth-tab-button")?.textContent).toBe("Debug");
    allowClose.mockReturnValueOnce(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Debug tab"]')!.click());
    expect(host.querySelector(".foss-earth-tab-button")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("toggles a tab for a toolbar button: shows it, then closes it once it is showing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const allowClose = vi.fn((): boolean | void => undefined);
  const overlayApiRef: { current: WindowOverlayHandle<"debug"> | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    additionalTabs={[{ id: "debug", label: "Debug" }]}
    renderAdditionalTab={() => <p>Debug panel</p>}
    overlayApiRef={overlayApiRef}
    onBeforeCloseTab={allowClose}
  />));
  const toggle = async (tabId: "location" | "debug") => act(async () => overlayApiRef.current!.toggleTab(tabId));
  const tabs = () => Array.from(host.querySelectorAll(".foss-earth-tab-button"), (button) => button.textContent);
  const selected = () => host.querySelector(".foss-earth-tab-shell-selected .foss-earth-tab-button")?.textContent;
  try {
    await toggle("location");
    expect(tabs()).toEqual(["Location"]);
    await toggle("debug");
    expect(tabs()).toEqual(["Location", "Debug"]);
    expect(selected()).toBe("Debug");

    // Open but behind another tab: the button brings it forward rather than closing it.
    await toggle("location");
    expect(tabs()).toEqual(["Location", "Debug"]);
    expect(selected()).toBe("Location");
    await toggle("location");
    expect(tabs()).toEqual(["Debug"]);
    expect(allowClose).toHaveBeenLastCalledWith("location");

    // A collapsed panel is not showing its tab either, so the button restores it.
    const left = host.querySelector<HTMLElement>('[data-side="left"]')!;
    await act(async () => left.querySelector<HTMLButtonElement>(".foss-earth-tab-button")!.click());
    expect(left.dataset.collapsed).toBe("true");
    await toggle("debug");
    expect(left.dataset.collapsed).toBe("false");
    expect(tabs()).toEqual(["Debug"]);

    allowClose.mockReturnValueOnce(false);
    await toggle("debug");
    expect(tabs()).toEqual(["Debug"]);
    await toggle("debug");
    expect(tabs()).toEqual([]);
  } finally { await act(async () => root.unmount()); }
});

it("adds Map and Renderer tabs showing the elements a host hands over", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const mapTab = document.createElement("div");
  mapTab.textContent = "Basemaps";
  const rendererTab = document.createElement("div");
  rendererTab.textContent = "Renderers";
  const overlayApiRef: { current: WindowOverlayHandle | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    mapTab={mapTab}
    rendererTab={rendererTab}
    overlayApiRef={overlayApiRef}
  />));
  try {
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open right panel"]')!.click());
    expect(Array.from(host.querySelectorAll(".foss-earth-new-tab-choice"), (item) => item.textContent))
      .toEqual(expect.arrayContaining(["Map", "Renderer"]));
    await act(async () => overlayApiRef.current!.toggleTab("map"));
    expect(host.contains(mapTab)).toBe(true);
    await act(async () => overlayApiRef.current!.toggleTab("renderer"));
    expect(host.contains(rendererTab)).toBe(true);
    await act(async () => overlayApiRef.current!.toggleTab("renderer"));
    expect(rendererTab.isConnected).toBe(false);
    expect(host.contains(mapTab)).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

/**
 * Someone wanting to know which version runs looked for an About tab under +,
 * and found none: it was the last section of Settings. It is a tab of its own,
 * offered on the globe and inside a sphere alike.
 */
it("offers an About tab under +, on the globe and in a sphere", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const element = (text: string) => Object.assign(document.createElement("div"), { textContent: text });
  const [aboutTab, sphereTab, settingsTab, bugReportTab] = ["Built from", "Photograph", "Looking", "Bug form"].map(element);
  let snapshot: SphereTabsSnapshot = { title: null, onScreen: false };
  const listeners = new Set<() => void>();
  const sphereTabs: SphereTabs = {
    sphere: sphereTab, settings: settingsTab, leave() {}, destroy() {},
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const overlayApiRef: { current: WindowOverlayHandle | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    aboutTab={aboutTab}
    bugReportTab={bugReportTab}
    sphereTabs={sphereTabs}
    overlayApiRef={overlayApiRef}
  />));
  const menu = async () => {
    const plus = () => host.querySelector<HTMLButtonElement>('[aria-label="Open right panel"], [data-side="right"] [aria-label="Open new tab"]')!;
    await act(async () => plus().click());
    const items = Array.from(host.querySelectorAll(".foss-earth-new-tab-choice"), (item) => item.textContent);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close New tab tab"]')!.click());
    return items;
  };
  try {
    expect(await menu()).toContain("About");
    expect(await menu()).toContain("Bug report");
    await act(async () => { snapshot = { title: "Northrop Mall", onScreen: true }; for (const listener of listeners) listener(); });
    expect(await menu()).toContain("About");
    expect(await menu()).toContain("Bug report");
    await act(async () => overlayApiRef.current!.toggleTab("about"));
    expect(host.contains(aboutTab)).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

it("prepares the Bug report tab only as it becomes visible and toggles it closed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const bugReportTab = document.createElement("div");
  bugReportTab.textContent = "The report form";
  const onBugReportShow = vi.fn();
  const overlayApiRef: { current: WindowOverlayHandle | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    bugReportTab={bugReportTab}
    onBugReportShow={onBugReportShow}
    overlayApiRef={overlayApiRef}
  />));
  try {
    expect(onBugReportShow).not.toHaveBeenCalled();
    await act(async () => overlayApiRef.current!.toggleTab("bug-report"));
    expect(host.contains(bugReportTab)).toBe(true);
    expect(onBugReportShow).toHaveBeenCalledOnce();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-side="left"] .foss-earth-tab-button')!.click());
    expect(onBugReportShow).toHaveBeenCalledOnce();
    await act(async () => overlayApiRef.current!.toggleTab("bug-report"));
    expect(onBugReportShow).toHaveBeenCalledTimes(2);
    await act(async () => overlayApiRef.current!.toggleTab("bug-report"));
    expect(host.querySelector('[aria-label="Close Bug report tab"]')).toBeNull();
    expect(onBugReportShow).toHaveBeenCalledTimes(2);
    await act(async () => overlayApiRef.current!.toggleTab("bug-report"));
    expect(onBugReportShow).toHaveBeenCalledTimes(3);
  } finally { await act(async () => root.unmount()); }
});

it("opens a sphere's tab on entering, hides the map's tabs meanwhile, and leaves the sphere when the tab closes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const element = (text: string) => Object.assign(document.createElement("div"), { textContent: text });
  const [mapTab, scenesTab, sphereTab, settingsTab, skyTab, timeTab] = ["Basemaps", "Scenes list", "Photograph", "Looking", "Atmosphere", "Dials"].map(element);
  let snapshot: SphereTabsSnapshot = { title: null, onScreen: false };
  const listeners = new Set<() => void>();
  const leave = vi.fn();
  const sphereTabs: SphereTabs = {
    sphere: sphereTab, settings: settingsTab, leave, destroy() {},
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const enter = (title: string | null) => act(async () => { snapshot = { title, onScreen: title !== null }; for (const listener of listeners) listener(); });
  const overlayApiRef: { current: WindowOverlayHandle | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    mapTab={mapTab}
    skyTab={skyTab}
    timeTab={timeTab}
    scenesTab={scenesTab}
    sphereTabs={sphereTabs}
    overlayApiRef={overlayApiRef}
  />));
  const side = (name: "left" | "right") => Array.from(host.querySelectorAll(`[data-side="${name}"] .foss-earth-tab-button`), (button) => button.textContent);
  const selected = (name: "left" | "right") => host.querySelector(`[data-side="${name}"] .foss-earth-tab-shell-selected .foss-earth-tab-button`)?.textContent;
  const menu = async (name: "left" | "right") => {
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-side="${name}"] [aria-label="Open new tab"]`)!.click());
    const items = Array.from(host.querySelectorAll(`[data-side="${name}"] .foss-earth-new-tab-choice`), (item) => item.textContent);
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-side="${name}"] [aria-label="Close New tab tab"]`)!.click());
    return items;
  };
  try {
    await act(async () => overlayApiRef.current!.toggleTab("map"));
    await act(async () => overlayApiRef.current!.toggleTab("location"));
    await act(async () => overlayApiRef.current!.toggleTab("map"));
    expect(side("left")).toEqual(["Map", "Location"]);
    expect(selected("left")).toBe("Map");
    expect(await menu("left")).not.toContain("360 image settings");
    expect(await menu("left")).toEqual(expect.arrayContaining(["Sky", "Date and time"]));

    // Entering: the map's tabs go, and the sky's and its time, which a sphere does not draw; the sphere's opens and shows.
    await enter("Northrop Mall");
    expect(side("left")).toEqual(["Northrop Mall"]);
    expect(host.contains(sphereTab)).toBe(true);
    expect(await menu("left")).toEqual(expect.arrayContaining(["360 image settings", "Scenes"]));
    for (const hidden of ["Map", "Location", "Sky", "Date and time"]) expect(await menu("left")).not.toContain(hidden);
    await act(async () => overlayApiRef.current!.openOrSelectTab("panorama-settings"));
    expect(side("left")).toEqual(["Northrop Mall", "360 image settings"]);

    // Following a link retitles the same tab.
    await enter("Walter Library");
    expect(side("left")).toEqual(["Walter Library", "360 image settings"]);

    // Escape: the sphere's tabs go and the map's come back where they were.
    await enter(null);
    expect(side("left")).toEqual(["Map", "Location"]);
    expect(selected("left")).toBe("Map");
    expect(leave).not.toHaveBeenCalled();

    // Entering again preserves the previously selected image settings; closing the photograph leaves it.
    await enter("Northrop Mall");
    expect(side("left")).toEqual(["Northrop Mall", "360 image settings"]);
    expect(selected("left")).toBe("360 image settings");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Northrop Mall tab"]')!.click());
    expect(leave).toHaveBeenCalledOnce();
    await enter(null);
    expect(side("left")).toEqual(["Map", "Location"]);
  } finally { await act(async () => root.unmount()); }
});

it("keeps tabs stable during flight and opens the photograph on arrival only when no other tabs remain", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const element = (text: string) => Object.assign(document.createElement("div"), { textContent: text });
  const [mapTab, scenesTab, sphereTab, settingsTab] = ["Basemaps", "Scenes list", "Photograph", "Looking"].map(element);
  let snapshot: SphereTabsSnapshot = { title: null, onScreen: false };
  const listeners = new Set<() => void>();
  const sphereTabs: SphereTabs = {
    sphere: sphereTab, settings: settingsTab, leave() {}, destroy() {},
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const show = (next: SphereTabsSnapshot) => act(async () => { snapshot = next; for (const listener of listeners) listener(); });
  const overlayApiRef: { current: WindowOverlayHandle | null } = { current: null };
  await act(async () => root.render(<WindowOverlay
    getViewState={() => ({ latDeg: 45, lonDeg: -93 })}
    setViewState={() => {}}
    mapTab={mapTab}
    scenesTab={scenesTab}
    sphereTabs={sphereTabs}
    overlayApiRef={overlayApiRef}
  />));
  const left = () => host.querySelector<HTMLElement>('[data-side="left"]')!;
  const selected = () => host.querySelector('[data-side="left"] .foss-earth-tab-shell-selected .foss-earth-tab-button')?.textContent;
  const flying = { title: "Northrop Mall", onScreen: false };
  const inside = { title: "Northrop Mall", onScreen: true };
  const outside = { title: null, onScreen: false };
  try {
    await act(async () => overlayApiRef.current!.toggleTab("map"));
    expect(left().dataset.collapsed).toBe("false");

    // The map stays selected during flight; the photograph replaces it on arrival.
    await show(flying);
    expect(selected()).toBe("Map");
    expect(left().dataset.collapsed).toBe("false");
    await show(inside);
    expect(selected()).toBe("Northrop Mall");
    expect(left().dataset.collapsed).toBe("false");
    // Following a link keeps it showing.
    await show({ title: "Walter Library", onScreen: true });
    expect(left().dataset.collapsed).toBe("false");
    await show(outside);
    expect(selected()).toBe("Map");
    expect(left().dataset.collapsed).toBe("false");

    // A flight cut short: the panel comes back as it was, not minimized.
    await show(flying);
    expect(left().dataset.collapsed).toBe("false");
    await show(outside);
    expect(selected()).toBe("Map");
    expect(left().dataset.collapsed).toBe("false");

    // Arriving in one step, with no flight: it shows at once.
    await show(inside);
    expect(left().dataset.collapsed).toBe("false");
    await show(outside);

    // What the person chose during the flight stands.
    await show(flying);
    await act(async () => overlayApiRef.current!.openOrSelectTab("scenes"));
    expect(selected()).toBe("Scenes");
    await show(inside);
    expect(selected()).toBe("Scenes");
    expect(left().dataset.collapsed).toBe("false");
  } finally { await act(async () => root.unmount()); }
});

it("comes back after a reload with the same tabs in the same windows, dropping tabs the app no longer offers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  type Tab = "aircraft" | "debug";
  const mount = async (tabs: readonly { id: Tab; label: string }[]) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
    await act(async () => root.render(<WindowOverlay<Tab>
      getViewState={() => ({ latDeg: 45, lonDeg: -93 })} setViewState={() => {}} overlayApiRef={api}
      additionalTabs={tabs} renderAdditionalTab={(tabId) => <p>{tabId}</p>}
    />));
    return { host, root, api };
  };
  const side = (host: HTMLElement, name: "left" | "right") => Array.from(host.querySelectorAll(`[data-side="${name}"] .foss-earth-tab-button`), (button) => button.textContent);
  const selected = (host: HTMLElement, name: "left" | "right") => host.querySelector(`[data-side="${name}"] .foss-earth-tab-shell-selected .foss-earth-tab-button`)?.textContent;

  const first = await mount([{ id: "aircraft", label: "Aircraft" }, { id: "debug", label: "Debug" }]);
  try {
    await act(async () => first.api.current!.openOrSelectTab("location"));
    await act(async () => first.api.current!.openOrSelectTab("debug"));
    await act(async () => first.host.querySelector<HTMLButtonElement>('[aria-label="Open right panel"]')!.click());
    const aircraft = Array.from(first.host.querySelectorAll<HTMLButtonElement>(".foss-earth-new-tab-choice")).find((item) => item.textContent === "Aircraft")!;
    await act(async () => aircraft.click());
    await act(async () => first.host.querySelector<HTMLButtonElement>('[data-side="right"] .foss-earth-tab-shell-selected .foss-earth-tab-button')!.click());
    expect(side(first.host, "left")).toEqual(["Location", "Debug"]);
    expect(selected(first.host, "left")).toBe("Debug");
    expect(side(first.host, "right")).toEqual(["Aircraft"]);
    expect(first.host.querySelector<HTMLElement>('[data-side="right"]')!.dataset.collapsed).toBe("true");
  } finally { await act(async () => first.root.unmount()); }

  // The reload: the same windows, the same tab showing, the right one still minimized.
  const second = await mount([{ id: "aircraft", label: "Aircraft" }, { id: "debug", label: "Debug" }]);
  try {
    expect(side(second.host, "left")).toEqual(["Location", "Debug"]);
    expect(selected(second.host, "left")).toBe("Debug");
    expect(side(second.host, "right")).toEqual(["Aircraft"]);
    expect(second.host.querySelector<HTMLElement>('[data-side="right"]')!.dataset.collapsed).toBe("true");
  } finally { await act(async () => second.root.unmount()); }

  // A version without Debug: its tab is gone and its window shows the one beside it.
  const third = await mount([{ id: "aircraft", label: "Aircraft" }]);
  try {
    expect(side(third.host, "left")).toEqual(["Location"]);
    expect(selected(third.host, "left")).toBe("Location");
    expect(side(third.host, "right")).toEqual(["Aircraft"]);
  } finally { await act(async () => third.root.unmount()); }
});

it("saves the layout a wide window on the globe would show, even while folded or inside a sphere", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const element = (text: string) => Object.assign(document.createElement("div"), { textContent: text });
  const [mapTab, sphereTab, settingsTab] = ["Basemaps", "Photograph", "Looking"].map(element);
  let snapshot: SphereTabsSnapshot = { title: null, onScreen: false };
  const listeners = new Set<() => void>();
  const sphereTabs: SphereTabs = {
    sphere: sphereTab, settings: settingsTab, leave() {}, destroy() {},
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const show = (next: SphereTabsSnapshot) => act(async () => { snapshot = next; for (const listener of listeners) listener(); });
  const mount = async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const api: { current: WindowOverlayHandle | null } = { current: null };
    await act(async () => root.render(<WindowOverlay
      getViewState={() => ({ latDeg: 45, lonDeg: -93 })} setViewState={() => {}}
      mapTab={mapTab} sphereTabs={sphereTabs} overlayApiRef={api}
    />));
    return { host, root, api };
  };
  const saved = () => JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!) as { primary: { tabs: string[]; activeTab: string | null }; secondary: { tabs: string[] } };

  const first = await mount();
  try {
    await act(async () => first.api.current!.openOrSelectTab("location"));
    await act(async () => first.api.current!.openOrSelectTab("map"));
    // A phone keeps a lone left window and saves its tabs on that same side.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(first.host.querySelector('[data-side="right"]')).toBeNull();
    expect(saved().primary).toMatchObject({ tabs: ["location", "map"], activeTab: "map" });
    // Inside a sphere the map's tabs are hidden; what is saved still has them.
    await show({ title: "Northrop Mall", onScreen: true });
    expect(first.host.querySelector('[data-side="left"] .foss-earth-tab-button')?.textContent).toBe("Northrop Mall");
    expect(saved().primary).toMatchObject({ tabs: ["location", "map"], activeTab: "map" });
    expect(saved().secondary.tabs).toEqual([]);
  } finally { await act(async () => first.root.unmount()); }

  // The reload lands on the globe in a wide window.
  snapshot = { title: null, onScreen: false };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  const second = await mount();
  try {
    expect(Array.from(second.host.querySelectorAll('[data-side="left"] .foss-earth-tab-button'), (button) => button.textContent)).toEqual(["Location", "Map"]);
    expect(second.host.querySelector('[data-side="left"] .foss-earth-tab-shell-selected .foss-earth-tab-button')?.textContent).toBe("Map");
    expect(second.host.querySelector('[data-side="right"] .foss-earth-tab-button')).toBeNull();
  } finally { await act(async () => second.root.unmount()); }
});

it("gives the only split window the full width on a screen that could hold two", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const api: { current: ShellHandle<"map"> | null } = { current: null };
  try {
    await act(async () => root.render(<SharedWindowOverlay<"map">
      tabDefinitions={[{ id: "map", label: "Map" }]}
      renderTabContent={() => <p>Map</p>}
      context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "map" }}
      restorableTabs={new Set(["map"])} storage={null} overlayApiRef={api}
      geometry={{ observeWidth(_element, listener) { listener(1200); return () => {}; }, observeHeight(_element, listener) { listener(240); return () => {}; }, menuBottom: () => null }}
      logSize={{ getWidth: () => null, subscribe: () => () => {} }}
      layoutPort={browserOverlayLayout(document.documentElement)}
      presentation={{ choice: "split", onChoice: () => {}, tabsBehindToolbar: false, toolbarEdge: "bottom" }}
    />));
    await act(async () => api.current!.openOrSelectTab("map"));
    const panel = host.querySelector<HTMLElement>(".foss-earth-dock-panel")!;
    expect(panel.dataset.side).toBe("left");
    expect(panel.style.width).toBe("1200px");
    expect(document.querySelector(".foss-earth-dock-panel-resize-handle")?.getAttribute("data-axes")).toBe("height");
    expect(document.querySelector(".foss-earth-dock-panel-resize-handle")?.getAttribute("data-lifted")).toBe("true");
    expect(host.querySelector(".foss-earth-dock-panel[data-side='right']")).toBeNull();
    expect(host.querySelector(".foss-earth-workspace-slot-launcher-right")).not.toBeNull();
    expect(document.documentElement.dataset.worldPresentation).toBe("split");
  } finally { await act(async () => root.unmount()); }
});
