// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay.js";
import { browserOverlayLayout } from "../browser/overlay.js";
import { SAVED_WORKSPACE_STORAGE_KEY } from "../browser/workspace.js";
import type { WindowTabDefinition } from "../windowing/core/types.js";

type Tab = "settings" | "image-a" | "image-b" | "log" | "opened";

let stored: Map<string, string>;
let changeWidth: ((width: number) => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const IMAGE_TABS: readonly WindowTabDefinition<Tab>[] = [
  { id: "settings", label: "Settings" },
  { id: "image-a", label: "Photo A", surface: { joinGroup: "images" } },
  { id: "image-b", label: "Photo B", surface: { joinGroup: "images" } },
];

/** A host like the app: the Log tab exists only while the layout does not float the log. */
function Host({ api, extra = [] }: { api: { current: WindowOverlayHandle<Tab> | null }; extra?: readonly WindowTabDefinition<Tab>[] }) {
  const root = document.documentElement;
  const [logIsTab, setLogIsTab] = useState(root.dataset.logVisible === "false");
  useEffect(() => {
    const observer = new MutationObserver(() => setLogIsTab(root.dataset.logVisible === "false"));
    observer.observe(root, { attributes: true, attributeFilter: ["data-log-visible"] });
    return () => observer.disconnect();
  }, [root]);
  const [geometry] = useState(() => ({
    observeWidth(_element: HTMLElement, listener: (width: number) => void) { changeWidth = listener; listener(1280); return () => {}; },
    menuBottom: () => null,
  }));
  const tabs: WindowTabDefinition<Tab>[] = [...(logIsTab ? [{ id: "log" as const, label: "Log" }] : []), ...IMAGE_TABS, ...extra];
  return <WindowOverlay<Tab>
    tabDefinitions={tabs}
    renderTabContent={tabId => <p className="content">{tabId}</p>}
    surfaces={{ renderJoined: ({ left, right }) => <p className="joined">{left} | {right}</p>, logTab: "log" }}
    context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "settings" }}
    restorableTabs={new Set(["settings", "image-a", "image-b"])} storage={localStorage} overlayApiRef={api}
    geometry={geometry}
    logSize={{ getWidth: () => null, subscribe: () => () => {} }} layoutPort={browserOverlayLayout(document.documentElement)}
  />;
}

async function mount(api: { current: WindowOverlayHandle<Tab> | null }, extra: readonly WindowTabDefinition<Tab>[] = []) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<Host api={api} extra={extra} />));
  // The Log tab arrives on the host's next render, as it does in the app.
  await act(async () => {});
  return { host, root, rerender: (next: readonly WindowTabDefinition<Tab>[]) => act(async () => root.render(<Host api={api} extra={next} />)) };
}

const panel = (host: HTMLElement, side: "left" | "right") => host.querySelector<HTMLElement>(`.foss-earth-dock-panel[data-side="${side}"]`)!;
const labels = (host: HTMLElement, side: "left" | "right") => Array.from(panel(host, side).querySelectorAll(".foss-earth-tab-button"), button => button.textContent);
const selected = (host: HTMLElement, side: "left" | "right") => panel(host, side).querySelector(".foss-earth-tab-shell-selected .foss-earth-tab-button")?.textContent;
const click = (host: HTMLElement, side: "left" | "right", label: string) => act(async () => {
  [...panel(host, side).querySelectorAll<HTMLButtonElement>(".foss-earth-tab-button")].find(button => button.textContent === label)!.click();
});

it("joins two selected image tabs into one body, keeps the log a tab without selecting it, and restores the floating log after", async () => {
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["settings", "image-a"], activeTab: "image-a", collapsed: false, width: 320 },
    secondary: { tabs: ["image-b"], activeTab: "image-b", collapsed: false, width: 320 },
  }));
  const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
  const { host, root } = await mount(api);
  const html = document.documentElement;
  try {
    // At a width that floats the log, a join keeps it a tab.
    expect(html.dataset.dockLayout).toBe("columns");
    expect(html.dataset.logVisible).toBe("false");
    expect(host.querySelector(".foss-earth-joined-surface .joined")?.textContent).toBe("image-a | image-b");
    expect(panel(host, "left").dataset.bodyless).toBe("true");
    expect(panel(host, "right").dataset.bodyless).toBe("true");
    expect(host.querySelector(".foss-earth-dock-panel-body")).toBeNull();
    expect(labels(host, "left")).toEqual(["Settings", "Photo A", "Log"]);
    expect(selected(host, "left")).toBe("Photo A");
    expect(selected(host, "right")).toBe("Photo B");
    expect(api.current!.workspace.getSnapshot().primary.activeTab).toBe("image-a");

    // Ordinary content on one side leaves one image on the other, in its own window body.
    await click(host, "left", "Settings");
    expect(host.querySelector(".foss-earth-joined-surface")).toBeNull();
    expect(panel(host, "right").dataset.surface).toBe("true");
    expect(panel(host, "right").querySelector(".foss-earth-dock-panel-body-surface .content")?.textContent).toBe("image-b");
    expect(panel(host, "left").dataset.surface).toBeUndefined();
    // Ending the join brings back what the width chooses: the floating log, and no Log tab.
    await act(async () => {});
    expect(html.dataset.dockLayout).toBe("dual");
    expect(html.dataset.logVisible).toBe("true");
    expect(labels(host, "left")).toEqual(["Settings", "Photo A"]);

    // The log returns to the side it last occupied; choosing it is ordinary content and leaves one image.
    await click(host, "left", "Photo A");
    await act(async () => {});
    expect(labels(host, "left")).toEqual(["Settings", "Photo A", "Log"]);
    await click(host, "left", "Log");
    await act(async () => {});
    expect(host.querySelector(".foss-earth-joined-surface")).toBeNull();
    expect(html.dataset.logVisible).toBe("false");
    expect(selected(host, "left")).toBe("Log");
    expect(panel(host, "right").dataset.surface).toBe("true");
  } finally { await act(async () => root.unmount()); }
});

it("places the Log tab on the side it last occupied, and gives the joined body its own height", async () => {
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["image-a"], activeTab: "image-a", collapsed: false, width: 320 },
    secondary: { tabs: ["settings"], activeTab: "settings", collapsed: false, width: 320 },
  }));
  vi.stubGlobal("innerHeight", 900);
  const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
  const { host, root } = await mount(api);
  try {
    // At a width that already keeps the log a tab, the person puts it on the right.
    await act(async () => changeWidth!(700));
    await act(async () => {});
    await act(async () => api.current!.openTabInSlot("log", "secondary"));
    expect(labels(host, "right")).toEqual(["Settings", "Log"]);
    await act(async () => api.current!.closeTab("log"));
    await act(async () => changeWidth!(1280));
    await act(async () => {});
    expect(document.documentElement.dataset.logVisible).toBe("true");
    await act(async () => api.current!.openTabInSlot("image-b", "secondary"));
    await act(async () => {});
    expect(labels(host, "right")).toEqual(["Settings", "Photo B", "Log"]);
    expect(selected(host, "right")).toBe("Photo B");
    const joined = host.querySelector<HTMLElement>(".foss-earth-joined-surface")!;
    // jsdom lays nothing out: the strips end at 0, so the body starts at the usable height under them.
    expect(joined.style.height).toBe(`${900 - 13}px`);
    // The windows keep their own heights for when the join ends.
    expect(panel(host, "left").style.height).toBe("");
  } finally { await act(async () => root.unmount()); }
});

it("opens a newly registered tab on the requested side and publishes canonical sides through narrow widths", async () => {
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["image-a"], activeTab: "image-a", collapsed: false, width: 320 },
    secondary: { tabs: ["settings"], activeTab: "settings", collapsed: false, width: 320 },
  }));
  const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
  const { host, root, rerender } = await mount(api);
  const revisions: number[] = [];
  const workspace = api.current!.workspace;
  const stop = workspace.subscribe(() => revisions.push(workspace.getSnapshot().revision));
  try {
    // Registered in the same update as the request, it opens once its definition arrives.
    await act(async () => api.current!.openTabInSlot("opened", "secondary"));
    expect(labels(host, "right")).toEqual(["Settings"]);
    await rerender([{ id: "opened", label: "Opened" }]);
    expect(labels(host, "right")).toEqual(["Settings", "Opened"]);
    expect(selected(host, "right")).toBe("Opened");
    let snapshot = api.current!.workspace.getSnapshot();
    expect(snapshot.secondary.tabs).toEqual(["settings", "opened"]);
    expect(snapshot.focusedSide).toBe("secondary");
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));

    // A narrow width with an image keeps both strips and moves no tab between sides.
    await act(async () => changeWidth!(390));
    snapshot = api.current!.workspace.getSnapshot();
    expect(snapshot.compact).toBe(true);
    expect(host.querySelector(".foss-earth-window-overlay")?.getAttribute("data-image-compact")).toBe("true");
    expect(labels(host, "left")).toEqual(["Photo A"]);
    expect(labels(host, "right")).toEqual(["Settings", "Opened"]);
    expect(snapshot.primary.tabs).toEqual(["image-a"]);
    expect(snapshot.secondary.tabs).toEqual(["settings", "opened"]);
    // A tab opened for the left side stays there when the width returns.
    await act(async () => api.current!.closeTab("opened"));
    await act(async () => api.current!.openTabInSlot("opened", "primary"));
    expect(api.current!.workspace.getSnapshot().primary.tabs).toEqual(["image-a", "opened"]);
    await act(async () => changeWidth!(1280));
    expect(labels(host, "left")).toEqual(["Photo A", "Opened"]);
    expect(selected(host, "left")).toBe("Opened");
    expect(api.current!.workspace.getSnapshot().compact).toBe(false);
    expect(host.querySelector(".foss-earth-window-overlay")?.hasAttribute("data-image-compact")).toBe(false);
    // Using a window makes its side the focused one.
    await act(async () => { panel(host, "left").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(api.current!.workspace.getSnapshot().focusedSide).toBe("primary");
  } finally { stop(); await act(async () => root.unmount()); }
});

it("stacks both labelled strips under the breakpoint and folds again only when no image is selected", async () => {
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["settings", "image-a"], activeTab: "image-a", collapsed: false, width: 320 },
    secondary: { tabs: ["image-b"], activeTab: "image-b", collapsed: false, width: 320 },
  }));
  const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
  const { host, root } = await mount(api);
  try {
    const before = api.current!.workspace.getSnapshot();
    await act(async () => changeWidth!(390));
    const narrow = api.current!.workspace.getSnapshot();
    expect(narrow.compact).toBe(true);
    expect(narrow.primary.tabs).toEqual(before.primary.tabs);
    expect(narrow.secondary.tabs).toEqual(before.secondary.tabs);
    expect(narrow.primary.activeTab).toBe("image-a");
    expect(narrow.secondary.activeTab).toBe("image-b");
    expect(panel(host, "left").querySelector(".foss-earth-compact-row-label")?.textContent).toBe("Left");
    expect(panel(host, "right").querySelector(".foss-earth-compact-row-label")?.textContent).toBe("Right");
    expect(panel(host, "left").dataset.flow).toBe("true");
    expect(panel(host, "left").dataset.bodyless).toBe("true");
    expect(panel(host, "right").dataset.bodyless).toBe("true");
    expect(host.querySelector(".foss-earth-joined-surface .joined")?.textContent).toBe("image-a | image-b");
    // Close, add and collapse stay on both strips. A collapsed side keeps its strip.
    expect(panel(host, "left").querySelector('[aria-label="Open new tab"]')).not.toBeNull();
    expect(panel(host, "right").querySelector('[aria-label="Close Photo B tab"]')).not.toBeNull();
    await click(host, "right", "Photo B");
    expect(panel(host, "right").dataset.collapsed).toBe("true");
    expect(panel(host, "right").querySelector(".foss-earth-compact-row-label")?.textContent).toBe("Right");
    expect(panel(host, "right").querySelector('[aria-label="Close Photo B tab"]')).not.toBeNull();
    expect(host.querySelector(".foss-earth-joined-surface")).toBeNull();
    expect(panel(host, "left").querySelector(".content")?.textContent).toBe("image-a");
    await click(host, "right", "Photo B");
    await act(async () => panel(host, "right").querySelector<HTMLButtonElement>('[aria-label="Close Photo B tab"]')!.click());
    await click(host, "left", "Settings");
    expect(host.querySelector(".foss-earth-window-overlay")?.hasAttribute("data-image-compact")).toBe(false);
    expect(host.querySelector('[data-side="left"]')).toBeNull();
    const folded = api.current!.workspace.getSnapshot();
    expect(folded.primary.tabs).toEqual(["settings", "image-a"]);
    expect(folded.primary.activeTab).toBe("settings");
    expect(folded.secondary.tabs).toEqual([]);
    await act(async () => changeWidth!(1280));
    expect(labels(host, "left")).toEqual(["Settings", "Photo A"]);
    expect(selected(host, "left")).toBe("Settings");
    expect(host.querySelector('[aria-label="Open right panel"]')).not.toBeNull();
    expect(host.querySelector(".foss-earth-joined-surface")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("stacks an image beside ordinary content, and keeps one body plus a collapsed or empty side", async () => {
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: ["image-a"], activeTab: "image-a", collapsed: false, width: 320 },
    secondary: { tabs: ["settings"], activeTab: "settings", collapsed: false, width: 320 },
  }));
  const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
  const { host, root } = await mount(api);
  try {
    await act(async () => changeWidth!(390));
    expect(host.querySelector(".foss-earth-joined-surface")).toBeNull();
    expect(panel(host, "left").dataset.surface).toBe("true");
    expect(panel(host, "left").querySelector(".content")?.textContent).toBe("image-a");
    expect(panel(host, "right").dataset.surface).toBeUndefined();
    expect(panel(host, "right").querySelector(".content")?.textContent).toBe("settings");
    expect(panel(host, "left").querySelector(".foss-earth-compact-row-label")?.textContent).toBe("Left");
    expect(panel(host, "right").querySelector(".foss-earth-compact-row-label")?.textContent).toBe("Right");
    const membership = api.current!.workspace.getSnapshot();
    await act(async () => changeWidth!(1280));
    await act(async () => changeWidth!(390));
    expect(api.current!.workspace.getSnapshot().primary.tabs).toEqual(membership.primary.tabs);
    expect(api.current!.workspace.getSnapshot().secondary.tabs).toEqual(membership.secondary.tabs);

    await act(async () => api.current!.closeTab("settings"));
    expect(panel(host, "left").querySelector(".content")?.textContent).toBe("image-a");
    const launcher = host.querySelector<HTMLElement>('[aria-label="Open right panel"]');
    expect(launcher).not.toBeNull();
    expect(launcher!.closest(".foss-earth-compact-row")?.querySelector(".foss-earth-compact-row-label")?.textContent).toBe("Right");
    expect(api.current!.workspace.getSnapshot().primary.tabs).toEqual(["image-a"]);
    expect(api.current!.workspace.getSnapshot().secondary.tabs).toEqual([]);
  } finally { await act(async () => root.unmount()); }
});
