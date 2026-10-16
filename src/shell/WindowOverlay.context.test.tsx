// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SAVED_WORKSPACE_STORAGE_KEY } from "../browser/workspace.js";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay.js";

type Tab = "map" | "controls" | "entry";

it.each([390, 1280])("leaves open or minimized tabs alone throughout picture entry at %i px", async screenWidth => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const api: { current: WindowOverlayHandle<Tab> | null } = { current: null };
  const geometry = { observeWidth(_element: HTMLElement, listener: (width: number) => void) { listener(screenWidth); return () => {}; }, menuBottom: () => null };
  const logSize = { getWidth: () => null, subscribe: () => () => {} };
  const layoutPort = { publish() {}, clear() {} };
  try {
    for (const selected of ["controls", "entry"] as const) {
      for (const collapsed of [false, true]) {
        const saved = JSON.stringify({
          primary: { tabs: [selected], activeTab: selected, collapsed, width: 340, height: 280 },
          secondary: { tabs: [], activeTab: null, collapsed: true, width: 300, height: 280 },
        });
        const storage = { getItem: (key: string) => key === SAVED_WORKSPACE_STORAGE_KEY ? saved : null, setItem() {} };
        const root = createRoot(host);
        const render = (active: boolean, ready: boolean) => act(async () => root.render(<WindowOverlay<Tab>
          tabDefinitions={[{ id: "map", label: "Map" }, { id: "controls", label: "Controls" }, { id: "entry", label: "Photograph" }]}
          renderTabContent={id => <p>{id}</p>}
          context={{ active, ready, entryTabId: "entry", baseOnlyTabs: new Set(["map"]), contextOnlyTabs: new Set(selected === "entry" && !active ? [] : ["entry"]) }}
          restorableTabs={new Set<Tab>(["map", "controls", "entry"])} storage={storage} overlayApiRef={api}
          geometry={geometry} logSize={logSize} layoutPort={layoutPort}
        />));
        const state = () => api.current!.workspace.getSnapshot();
        const shown = () => [state().primary, state().secondary].find(slot => slot.tabs.includes(selected))!;
        try {
          await render(false, false);
          expect(shown()).toMatchObject({ activeTab: selected, collapsed });
          await render(true, false);
          expect(shown()).toMatchObject({ activeTab: selected, collapsed });
          await render(true, true);
          expect(shown()).toMatchObject({ activeTab: selected, collapsed });
          if (selected === "controls") expect([...state().primary.tabs, ...state().secondary.tabs]).not.toContain("entry");
          await render(false, false);
          if (selected === "controls") {
            await render(true, true);
            expect(shown()).toMatchObject({ activeTab: selected, collapsed });
          }
        } finally { await act(async () => root.unmount()); }
      }
    }
    // With no tabs open, entry waits until the photograph is on screen.
    const root = createRoot(host);
    const render = (ready: boolean, active = true) => act(async () => root.render(<WindowOverlay<Tab>
      tabDefinitions={[{ id: "controls", label: "Controls" }, { id: "entry", label: "Photograph" }]}
      renderTabContent={id => <p>{id}</p>}
      context={{ active, ready, entryTabId: "entry", baseOnlyTabs: new Set(), contextOnlyTabs: new Set(["entry"]) }}
      restorableTabs={new Set()} storage={null} overlayApiRef={api} geometry={geometry} logSize={logSize} layoutPort={layoutPort}
    />));
    try {
      await render(false);
      expect(host.querySelector(".foss-earth-dock-panel")).toBeNull();
      await render(true);
      expect(host.querySelector<HTMLElement>(".foss-earth-dock-panel")!.dataset.collapsed).toBe("false");
      expect(host.textContent).toContain("Photograph");
      await render(false, false);
      // A remembered photograph must not steal selection from a tab opened on the map.
      await act(async () => api.current!.openOrSelectTab("controls"));
      await render(false);
      await render(true);
      expect([api.current!.workspace.getSnapshot().primary.activeTab, api.current!.workspace.getSnapshot().secondary.activeTab]).toContain("controls");
    } finally { await act(async () => root.unmount()); }
  } finally {
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
