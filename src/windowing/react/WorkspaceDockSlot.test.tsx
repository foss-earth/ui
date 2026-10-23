// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWindowWorkspaceState } from "../core/workspaceState.js";
import type { WindowWorkspaceState } from "../core/types.js";
import { WorkspaceDockSlot } from "./WorkspaceDockSlot.js";

type Tab = "map" | "attitude" | "settings" | "hidden";
const definitions = [
  { id: "map" as const, label: "Map" },
  { id: "attitude" as const, label: "Attitude" },
  { id: "settings" as const, label: "Interface settings" },
  { id: "hidden" as const, label: "Hidden", available: false },
];
let roots: Root[];
beforeEach(() => { roots = []; vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

async function mount({
  state = createWindowWorkspaceState<Tab>({ primary: { tabs: ["map"] }, secondary: { tabs: ["attitude"] } }),
  picker,
  slotId = "primary",
  restoreOnTabSelect = true,
}: {
  state?: WindowWorkspaceState<Tab>;
  picker?: "tab" | "dropdown";
  slotId?: "primary" | "secondary";
  restoreOnTabSelect?: boolean;
} = {}) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const changes = vi.fn();
  const pickerChanges = vi.fn();
  const beforeClose = vi.fn();
  let current = state;
  function Host() {
    const [workspace, setWorkspace] = useState(state);
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState(picker);
    return <WorkspaceDockSlot<Tab>
      side={slotId === "primary" ? "left" : "right"} slotId={slotId}
      workspaceState={workspace} onWorkspaceStateChange={next => { current = next; changes(next); setWorkspace(next); }}
      tabDefinitions={definitions} getTabLabel={id => definitions.find(tab => tab.id === id)!.label}
      renderTabContent={id => <p data-content={id}>{id}</p>}
      width={320} maxWidth={600} addMenuOpen={open} onAddMenuOpenChange={setOpen}
      tabPicker={mode} onTabPickerChange={next => { pickerChanges(next); setMode(next); }}
      restoreOnTabSelect={restoreOnTabSelect} onBeforeCloseTab={beforeClose}
    />;
  }
  await act(async () => root.render(<Host />));
  return { host, changes, pickerChanges, beforeClose, workspace: () => current };
}

async function click(target: Element | null) {
  expect(target).not.toBeNull();
  await act(async () => (target as HTMLElement).click());
}

it("opens a real New tab page by default and replaces it with an available tab on the same side", async () => {
  const { host, changes, workspace } = await mount();
  await click(host.querySelector(".foss-earth-tab-add"));
  expect(host.querySelector('[data-new-tab="true"]')?.textContent).toContain("New tab");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  const choices = host.querySelectorAll<HTMLButtonElement>(".foss-earth-new-tab-choice");
  expect([...choices].map(button => button.textContent)).toEqual(["Interface settings"]);
  expect(host.querySelector("[data-content]")).toBeNull();
  // The transient picker never enters persisted host tabs.
  expect(changes).not.toHaveBeenCalled();
  await click(choices[0]);
  expect(host.querySelector("[data-new-tab]")).toBeNull();
  expect(host.querySelector('[data-content="settings"]')).not.toBeNull();
  expect(workspace().primary.tabs).toEqual(["map", "settings"]);
  expect(workspace().secondary.tabs).toEqual(["attitude"]);
});

it("selects the picker once, returns to the existing active tab without minimizing, and closes independently", async () => {
  const { host, beforeClose, workspace } = await mount();
  await click(host.querySelector(".foss-earth-tab-add"));
  await click(host.querySelector(".foss-earth-tab-add"));
  expect(host.querySelectorAll("[data-new-tab]")).toHaveLength(1);
  await click(host.querySelector('.foss-earth-tab-button[data-tab-id="map"]'));
  expect(host.querySelector("[data-new-tab]")).toBeNull();
  expect(host.querySelector('[data-content="map"]')).not.toBeNull();
  expect(workspace().primary.collapsed).toBe(false);
  await click(host.querySelector(".foss-earth-tab-add"));
  await click(host.querySelector('[aria-label="Close New tab tab"]'));
  expect(host.querySelector('[data-content="map"]')).not.toBeNull();
  expect(beforeClose).not.toHaveBeenCalled();
  expect(workspace().primary.tabs).toEqual(["map"]);
});

it("minimizes and restores from the selected New tab, as from any selected tab, while + only ever shows it", async () => {
  const { host, workspace } = await mount();
  await click(host.querySelector(".foss-earth-tab-add"));
  await click(host.querySelector('[data-new-tab="true"] .foss-earth-tab-button'));
  expect(workspace().primary.collapsed).toBe(true);
  expect(host.querySelector('[data-new-tab="true"]')).not.toBeNull();
  await click(host.querySelector('[data-new-tab="true"] .foss-earth-tab-button'));
  expect(workspace().primary.collapsed).toBe(false);
  await click(host.querySelector(".foss-earth-tab-add"));
  expect(workspace().primary.collapsed).toBe(false);
  expect(host.querySelector(".foss-earth-new-tab-grid")).not.toBeNull();
  expect(workspace().primary.tabs).toEqual(["map"]);
});

it("expands a minimized window to show the picker", async () => {
  const { host, workspace } = await mount({ state: createWindowWorkspaceState<Tab>({ primary: { tabs: ["map"], collapsed: true } }) });
  await click(host.querySelector(".foss-earth-tab-add"));
  expect(workspace().primary.collapsed).toBe(false);
  expect(host.querySelector(".foss-earth-new-tab-grid")).not.toBeNull();
});

it("opens the empty side as a New tab window, then opens its choice on that side", async () => {
  const { host, workspace } = await mount({ state: createWindowWorkspaceState<Tab>({ primary: { tabs: ["attitude"] } }), slotId: "secondary" });
  expect(host.querySelector(".foss-earth-dock-panel")).toBeNull();
  await click(host.querySelector(".foss-earth-panel-launcher-button"));
  expect(host.querySelector('.foss-earth-dock-panel[data-side="right"]')).not.toBeNull();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await click(host.querySelector('.foss-earth-new-tab-choice[data-tab-id="map"]'));
  expect(workspace().secondary.tabs).toEqual(["map"]);
  expect(workspace().primary.tabs).toEqual(["attitude"]);
});

it("keeps the dropdown opt-in and lets its menu return to the New tab page", async () => {
  const { host, pickerChanges } = await mount({ picker: "dropdown" });
  await click(host.querySelector(".foss-earth-tab-add"));
  expect(host.querySelector("[data-new-tab]")).toBeNull();
  expect(document.querySelector('[role="menuitem"][data-tab-id="settings"]')?.textContent).toBe("Interface settings");
  await click(document.querySelector(".foss-earth-window-menu-picker"));
  expect(pickerChanges).toHaveBeenLastCalledWith("tab");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(host.querySelector(".foss-earth-new-tab-grid")).not.toBeNull();

  await click(host.querySelector('input[value="dropdown"]'));
  expect(pickerChanges).toHaveBeenLastCalledWith("dropdown");
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
});

it("lets an empty-side dropdown switch back to the New tab page", async () => {
  const { host, pickerChanges } = await mount({ state: createWindowWorkspaceState<Tab>(), picker: "dropdown", slotId: "secondary" });
  await click(host.querySelector(".foss-earth-panel-launcher-button"));
  await click(host.querySelector(".foss-earth-window-menu-picker"));
  expect(pickerChanges).toHaveBeenCalledWith("tab");
  expect(host.querySelector('.foss-earth-dock-panel[data-side="right"] .foss-earth-new-tab-grid')).not.toBeNull();
});
