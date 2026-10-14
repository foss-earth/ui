// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TabStrip } from "./TabStrip.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

/**
 * The panel around a tab strip clips what passes its edges (overflow: hidden).
 * With many tabs the + button sits at the strip's right end, so a menu drawn
 * inside the panel was cut off there, and the globe or the sphere showed
 * where it should have been.
 */
it("draws the + menu outside the panel that clips it, fixed to the window where the button is", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 700);
  const layer = document.createElement("div");
  const panel = document.createElement("div");
  panel.style.overflow = "hidden";
  document.body.append(layer, panel);
  let buttonLeft = 300;
  vi.spyOn(HTMLButtonElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLButtonElement) {
    return this.classList.contains("foss-earth-tab-add")
      ? { left: buttonLeft, right: buttonLeft + 30, top: 12, bottom: 42, width: 30, height: 30, x: buttonLeft, y: 12, toJSON() {} } as DOMRect
      : new DOMRect();
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(150);
  const root = createRoot(panel);
  const render = (open: boolean) => act(async () => root.render(<TabStrip
    openTabs={["map", "scenes"]}
    activeTab="map"
    availableTabs={["location"]}
    addMenuOpen={open}
    onSelectTab={() => {}}
    onCloseTab={() => {}}
    onOpenTab={() => {}}
    onAddMenuOpenChange={() => {}}
    getLabel={(id) => id}
    menuContainer={layer}
  />));
  try {
    await render(true);
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(panel.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(layer);
    expect(menu.classList.contains("foss-earth-window-menu-floating")).toBe(true);
    expect(menu.style).toMatchObject({ position: "fixed", top: "12px", left: "300px", visibility: "" });

    // Near the window's right edge it ends at the button's right edge instead.
    await render(false);
    buttonLeft = 900;
    await render(true);
    const flipped = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(flipped.style.right).toBe("70px");
    expect(flipped.style.left).toBe("");
    expect(flipped.classList.contains("foss-earth-window-menu-align-right")).toBe(true);
  } finally { await act(async () => root.unmount()); }
});

/**
 * Escape closed nothing: the + menu stayed open until a click elsewhere. It
 * now closes the menu and nothing else, so a sphere behind it is not left
 * and no key binding reads the key, and focus goes back to the + button.
 */
it("closes the + menu on Escape, and the key goes no further", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const panel = document.createElement("div");
  document.body.append(panel);
  const onAddMenuOpenChange = vi.fn();
  const behind = vi.fn();
  window.addEventListener("keydown", behind);
  const root = createRoot(panel);
  try {
    await act(async () => root.render(<TabStrip
      openTabs={["map"]}
      activeTab="map"
      availableTabs={["location", "scenes"]}
      addMenuOpen
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      onOpenTab={() => {}}
      onAddMenuOpenChange={onAddMenuOpenChange}
      getLabel={(id) => id}
    />));
    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    item.focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    item.dispatchEvent(escape);
    expect(onAddMenuOpenChange).toHaveBeenCalledWith(false);
    expect(escape.defaultPrevented).toBe(true);
    expect(behind).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(panel.querySelector(".foss-earth-tab-add"));

    // Other keys are the menu's to ignore, as before.
    onAddMenuOpenChange.mockClear();
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(onAddMenuOpenChange).not.toHaveBeenCalled();
    expect(behind).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("keydown", behind);
    await act(async () => root.unmount());
  }
});

/**
 * On 2026-10-07 the + menu of a short window ran under the map source chip at
 * the window's bottom, which 0sfs draws above the panels, and About, last in
 * it, was out of sight: it read as not there. The menu ends above what the
 * host draws there, and takes another column for what does not fit.
 */
it("ends the + menu above the host's toolbar, in more columns when it has more tabs than fit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 600);
  const panel = document.createElement("div");
  document.body.append(panel);
  vi.spyOn(HTMLButtonElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLButtonElement) {
    return this.classList.contains("foss-earth-tab-add")
      ? { left: 300, right: 330, top: 12, bottom: 42, width: 30, height: 30, x: 300, y: 12, toJSON() {} } as DOMRect
      : new DOMRect();
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(150);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "menuitem" ? 32 : 0;
  });
  const tabs = ["location", "controls", "interface", "settings", "weather", "aircraft", "map", "renderer", "about"];
  let toolbarTop = 190;
  const root = createRoot(panel);
  const render = () => act(async () => root.render(<TabStrip
    openTabs={[]}
    activeTab={null}
    availableTabs={tabs}
    addMenuOpen
    onSelectTab={() => {}}
    onCloseTab={() => {}}
    onOpenTab={() => {}}
    onAddMenuOpenChange={() => {}}
    getLabel={(id) => id}
    menuBottom={() => toolbarTop}
  />));
  try {
    await render();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    // From the button's top at 12 to 8 px above the toolbar at 190: 170 px, five 32 px rows.
    expect(menu.style.maxHeight).toBe("170px");
    expect(menu.style.gridTemplateRows).toBe("repeat(5, auto)");
    expect(menu.style.gridAutoFlow).toBe("column");
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(9);

    // With room for every tab it is one column again.
    toolbarTop = 560;
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(menu.style.maxHeight).toBe("540px");
    expect(menu.style.gridTemplateRows).toBe("");
    expect(menu.style.gridAutoFlow).toBe("");
  } finally { await act(async () => root.unmount()); }
});

/**
 * A tab opened into a full strip was selected past its right end: the strip
 * stayed where it was, and the new tab's title could not be seen. The strip
 * now scrolls just enough to show the selected tab, and only when the
 * selection or the tabs change.
 */
it("brings the selected tab into view, and leaves a strip scrolled by hand alone otherwise", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const panel = document.createElement("div");
  document.body.append(panel);
  // Tabs 100 px wide in a 250 px strip, laid out at the strip's scroll offset.
  let scrollLeft = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("foss-earth-tab-strip-list")) return new DOMRect(0, 0, 250, 30);
    const shells = [...(this.parentElement?.children ?? [])];
    return this.classList.contains("foss-earth-tab-shell") ? new DOMRect(shells.indexOf(this) * 100 - scrollLeft, 0, 100, 30) : new DOMRect();
  });
  const root = createRoot(panel);
  const render = (openTabs: string[], activeTab: string, label = (id: string) => id) => act(async () => root.render(<TabStrip
    openTabs={openTabs}
    activeTab={activeTab}
    availableTabs={[]}
    addMenuOpen={false}
    onSelectTab={() => {}}
    onCloseTab={() => {}}
    onOpenTab={() => {}}
    onAddMenuOpenChange={() => {}}
    getLabel={label}
  />));
  try {
    await render(["a", "b"], "a");
    const list = document.querySelector<HTMLElement>(".foss-earth-tab-strip-list")!;
    Object.defineProperty(list, "scrollLeft", { get: () => scrollLeft, set: (value: number) => { scrollLeft = value; } });

    // Opened and selected at x 300 to 400: its right edge comes to the strip's.
    await render(["a", "b", "c", "d"], "d");
    expect(scrollLeft).toBe(150);

    // Scrolled back by hand, then a label changes: the strip stays.
    scrollLeft = 0;
    await render(["a", "b", "c", "d"], "d", (id) => `${id} (loading)`);
    expect(scrollLeft).toBe(0);

    // Selecting a tab that is already in view scrolls nothing.
    await render(["a", "b", "c", "d"], "b");
    expect(scrollLeft).toBe(0);

    // Selecting one before the strip's start brings its left edge to the strip's.
    scrollLeft = 180;
    await render(["a", "b", "c", "d"], "a");
    expect(scrollLeft).toBe(0);
  } finally { await act(async () => root.unmount()); }
});
