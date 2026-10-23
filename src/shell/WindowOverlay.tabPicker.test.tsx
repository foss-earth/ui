// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WindowOverlay, type WindowOverlayHandle, type WindowOverlayProps } from "./WindowOverlay.js";
import { SAVED_WORKSPACE_STORAGE_KEY } from "../browser/workspace.js";
import type { DockLayout } from "./dockLayout.js";
import type { WindowTabDefinition } from "../windowing/core/types.js";

type Tab = "a" | "b" | "c" | "image-a" | "image-b";
const TABS: readonly WindowTabDefinition<Tab>[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Bravo" },
  { id: "c", label: "Charlie" },
  { id: "image-a", label: "Photo A", surface: { joinGroup: "images" }, icon: "image" },
  { id: "image-b", label: "Photo B", surface: { joinGroup: "images" }, icon: "image" },
];

let stored: Map<string, string>;
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

function save(primary: readonly Tab[], secondary: readonly Tab[]): void {
  stored.set(SAVED_WORKSPACE_STORAGE_KEY, JSON.stringify({
    primary: { tabs: primary, activeTab: primary[0] ?? null, collapsed: false, width: 320 },
    secondary: { tabs: secondary, activeTab: secondary[0] ?? null, collapsed: false, width: 320 },
  }));
}

async function mount(props: Partial<WindowOverlayProps<Tab>> = {}) {
  const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
  const published: DockLayout[] = [];
  const observed = new Set<HTMLElement>();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = (next: Partial<WindowOverlayProps<Tab>> = {}) => root.render(<WindowOverlay<Tab>
    tabDefinitions={TABS}
    renderTabContent={tabId => <p data-content={tabId}>{tabId}</p>}
    context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "a" }}
    restorableTabs={new Set(TABS.map(tab => tab.id))} storage={localStorage} overlayApiRef={api}
    geometry={{
      observeWidth(_element, listener) { listener(1280); return () => {}; },
      observeHeight(element, listener) { observed.add(element); listener(200); return () => { observed.delete(element); }; },
      menuBottom: () => null,
    }}
    logSize={{ getWidth: () => null, subscribe: () => () => {} }}
    layoutPort={{ publish: layout => { published.push(layout); }, clear() {} }}
    {...props} {...next}
  />);
  await act(async () => render());
  const unmount = () => act(async () => root.unmount());
  return { host, api, published, observed, unmount, rerender: (next: Partial<WindowOverlayProps<Tab>>) => act(async () => render(next)) };
}

const panel = (host: HTMLElement, side: "left" | "right") => host.querySelector<HTMLElement>(`.foss-earth-dock-panel[data-side="${side}"]`);
const press = (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  return act(async () => (element as HTMLElement).click());
};
const choice = (host: HTMLElement, label: string) => [...host.querySelectorAll(".foss-earth-new-tab-choice")].find(button => button.textContent === label);
const savedTabs = () => {
  const saved = JSON.parse(stored.get(SAVED_WORKSPACE_STORAGE_KEY)!) as Record<"primary" | "secondary", { tabs: string[]; activeTab: string | null }>;
  return { primary: saved.primary.tabs, secondary: saved.secondary.tabs, active: [saved.primary.activeTab, saved.secondary.activeTab] };
};

it("gives a split screen's empty side a New tab window of its own, then opens the choice there without saving the picker", async () => {
  save(["a"], []);
  const { host, published, observed, unmount } = await mount({ presentation: { choice: "split", onChoice() {}, tabsBehindToolbar: false, edges: "inset" } });
  try {
    // The lone window spans the split screen; the empty side is a launcher.
    expect(published.at(-1)).toMatchObject({ side: "left", windowWidthFixed: true, primaryWidth: 1280 });
    await press(host.querySelector('[aria-label="Open right panel"]'));
    const right = panel(host, "right");
    expect(right?.querySelector(".foss-earth-new-tab-grid")).not.toBeNull();
    // Two windows now share the width, and the world starts under the new one as well.
    expect(published.at(-1)).toMatchObject({ windowWidthFixed: false });
    expect(published.at(-1)!.primaryWidth).toBeLessThan(1280);
    expect(observed.has(right!)).toBe(true);
    expect(savedTabs()).toEqual({ primary: ["a"], secondary: [], active: ["a", null] });

    await press(choice(host, "Charlie"));
    expect(panel(host, "right")!.querySelector('[data-content="c"]')).not.toBeNull();
    expect(host.querySelector(".foss-earth-new-tab")).toBeNull();
    expect(savedTabs()).toEqual({ primary: ["a"], secondary: ["c"], active: ["a", "c"] });
  } finally { await unmount(); }
});

it("hides the tab New tab covers, and a toolbar toggle or link shows that tab rather than closing it", async () => {
  save(["a", "b"], ["c"]);
  const visibility = vi.fn();
  const { host, api, unmount } = await mount({ onTabVisibility: visibility });
  try {
    expect(visibility).toHaveBeenCalledWith("a", true);
    await press(host.querySelector('[data-side="left"] [aria-label="Open new tab"]'));
    expect(visibility).toHaveBeenLastCalledWith("a", false);
    expect(host.querySelector('[data-content="a"]')).toBeNull();
    expect(host.querySelector('[data-content="c"]')).not.toBeNull();

    await act(async () => api.current!.toggleTab("a"));
    expect(host.querySelector(".foss-earth-new-tab")).toBeNull();
    expect(host.querySelector('[data-content="a"]')).not.toBeNull();
    expect(visibility).toHaveBeenLastCalledWith("a", true);
    expect(savedTabs().primary).toEqual(["a", "b"]);

    await press(host.querySelector('[data-side="left"] [aria-label="Open new tab"]'));
    await act(async () => api.current!.openOrSelectTab("b"));
    expect(host.querySelector(".foss-earth-new-tab")).toBeNull();
    expect(host.querySelector('[data-content="b"]')).not.toBeNull();
  } finally { await unmount(); }
});

it("parts two joined images while one window shows New tab, and joins them again when it closes", async () => {
  save(["image-a"], ["image-b"]);
  const { host, unmount } = await mount({
    surfaces: { renderJoined: ({ left, right }) => <p className="joined">{left} | {right}</p> },
  });
  try {
    expect(host.querySelector(".joined")?.textContent).toBe("image-a | image-b");
    await press(host.querySelector('[data-side="left"] [aria-label="Open new tab"]'));
    expect(host.querySelector(".joined")).toBeNull();
    expect(panel(host, "left")!.dataset.surface).not.toBe("true");
    expect(panel(host, "left")!.querySelector(".foss-earth-new-tab-grid")).not.toBeNull();
    expect(panel(host, "right")!.querySelector('[data-content="image-b"]')).not.toBeNull();
    await press(host.querySelector('[aria-label="Close New tab tab"]'));
    expect(host.querySelector(".joined")?.textContent).toBe("image-a | image-b");
  } finally { await unmount(); }
});

it("keeps the dropdown as an explicit preference with a way back to New tab", async () => {
  save(["a"], []);
  const onTabPickerChange = vi.fn();
  const { host, rerender, unmount } = await mount({ tabPicker: "dropdown", onTabPickerChange });
  try {
    await press(host.querySelector('[aria-label="Open right panel"]'));
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(host.querySelector(".foss-earth-new-tab")).toBeNull();
    await press(host.querySelector(".foss-earth-window-menu-picker"));
    expect(onTabPickerChange).toHaveBeenCalledWith("tab");
    await rerender({ tabPicker: "tab", onTabPickerChange });
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(panel(host, "right")!.querySelector(".foss-earth-new-tab-grid")).not.toBeNull();
  } finally { await unmount(); }
});

it("opens New tab from a second finger's still tap on + while the first finger holds a control outside the windows", async () => {
  save(["a"], ["c"]);
  const { host, unmount } = await mount();
  const touch = (target: EventTarget, type: string, pointerId: number, isPrimary: boolean) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0 });
    Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: "touch" }, isPrimary: { value: isPrimary } });
    target.dispatchEvent(event);
  };
  try {
    const joystick = document.body.appendChild(document.createElement("div"));
    const plus = host.querySelector<HTMLButtonElement>('[data-side="right"] [aria-label="Open new tab"]')!;
    vi.spyOn(plus, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 32, 32));
    touch(joystick, "pointerdown", 1, true);
    await act(async () => { touch(plus, "pointerdown", 2, false); touch(plus, "pointerup", 2, false); });
    expect(panel(host, "right")!.querySelector(".foss-earth-new-tab-grid")).not.toBeNull();
    const bravo = choice(host, "Bravo") as HTMLButtonElement;
    vi.spyOn(bravo, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 64, 32));
    await act(async () => { touch(bravo, "pointerdown", 3, false); touch(bravo, "pointerup", 3, false); });
    expect(savedTabs().secondary).toEqual(["c", "b"]);
    expect(panel(host, "right")!.querySelector('[data-content="b"]')).not.toBeNull();
  } finally { await unmount(); }
});

it("scrolls a window under a second finger's drag while the first holds a control outside the windows, without choosing what the drag crossed", async () => {
  save(["a"], ["c"]);
  const { host, unmount } = await mount();
  const touch = (target: EventTarget, type: string, pointerId: number, isPrimary: boolean, clientY = 150) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY, button: 0 });
    Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: "touch" }, isPrimary: { value: isPrimary } });
    target.dispatchEvent(event);
  };
  try {
    const joystick = document.body.appendChild(document.createElement("div"));
    touch(joystick, "pointerdown", 1, true);
    await press(host.querySelector('[data-side="right"] [aria-label="Open new tab"]'));
    const body = panel(host, "right")!.querySelector<HTMLElement>(".foss-earth-dock-panel-body")!;
    // jsdom has no layout: the window's stylesheet and sizes, as a phone draws a long tab.
    body.style.overflowY = "auto";
    Object.defineProperties(body, { clientHeight: { value: 200 }, scrollHeight: { value: 900 } });
    const bravo = choice(host, "Bravo") as HTMLButtonElement;
    vi.spyOn(bravo, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 140, 64, 32));
    await act(async () => {
      touch(bravo, "pointerdown", 2, false, 150);
      for (const y of [130, 110, 90]) touch(bravo, "pointermove", 2, false, y);
      touch(bravo, "pointerup", 2, false, 90);
    });
    expect(body.scrollTop).toBe(60);
    expect(host.querySelector(".foss-earth-new-tab")).not.toBeNull();
    expect(savedTabs().secondary).toEqual(["c"]);
    // A still tap after the scroll still chooses.
    await act(async () => { touch(bravo, "pointerdown", 3, false); touch(bravo, "pointerup", 3, false); });
    expect(savedTabs().secondary).toEqual(["c", "b"]);
  } finally { await unmount(); }
});
