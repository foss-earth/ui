// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry, type SettingsStorage } from "../src/index.js";
import { createParameterSection, createSectionsElement, PANEL_SECTIONS_OPEN_STORAGE_KEY } from "../src/browser/index.js";
import { SectionsPanel } from "../src/react.js";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function storage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

describe("optional widget host ports", () => {
  it("edits the supplied registry and persists Show all in injected presentation storage", () => {
    const panels = storage();
    const settings = createSettingsRegistry();
    settings.register([{
      id: "host.show", label: "Show", description: "Host-owned visibility.", unit: "none", kind: "boolean",
      default: false, defaultReason: "Off initially.", home: { tab: "host", section: "display", level: "main" },
      appliesLive: true, source: "src/host.ts",
    }]);
    const section = createParameterSection(settings, { tab: "host", section: "display", panelStorage: panels });
    document.body.append(section.element);
    try {
      section.element.querySelector<HTMLInputElement>('[data-parameter="host.show"] input')!.click();
      expect(settings.get("host.show")).toBe(true);
      const toggle = section.element.querySelector<HTMLInputElement>('input[name^="foss-earth-show-all-"]')!;
      toggle.click();
      expect(JSON.parse(panels.data.get(PANEL_SECTIONS_OPEN_STORAGE_KEY)!)).toEqual({ "all:host/display": true });
    } finally { section.destroy(); }
    expect(section.element.isConnected).toBe(false);
  });

  it("uses injected storage for native and React section state", async () => {
    const panels = storage();
    panels.data.set(PANEL_SECTIONS_OPEN_STORAGE_KEY, JSON.stringify({ native: true, react: true }));
    const element = createSectionsElement([{ id: "native", title: "Native", element: document.createElement("div") }], { storage: panels });
    expect(element.element.querySelector("details")?.open).toBe(true);
    element.destroy();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<SectionsPanel storage={panels} sections={[{ id: "react", title: "React", render: () => <p>Host content</p> }]} />));
      const details = host.querySelector("details")!;
      expect(details.open).toBe(true);
      await act(async () => { details.open = false; details.dispatchEvent(new Event("toggle")); });
      expect(JSON.parse(panels.data.get(PANEL_SECTIONS_OPEN_STORAGE_KEY)!)).toEqual({ native: true, react: false });
    } finally { await act(async () => root.unmount()); }
  });
});
