import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserSettingsRegistry, loadSavedWorkspace, saveWorkspace } from "../src/browser/index.js";
import { createSettingsRegistry, createWindowWorkspaceState, SAVED_WORKSPACE_STORAGE_KEY, SETTINGS_STORAGE_KEY, type SettingsStorage } from "../src/index.js";

function storage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

afterEach(() => vi.unstubAllGlobals());

describe("optional browser adapters", () => {
  it("keeps core registry creation in memory even when browser storage exists", () => {
    const stored = storage();
    vi.stubGlobal("localStorage", stored);
    const core = createSettingsRegistry();
    expect(core.getStorageError()).toBeNull();
    expect(stored.data.size).toBe(0);
    stored.data.set(SETTINGS_STORAGE_KEY, "bad JSON");
    expect(createSettingsRegistry().getStorageError()).toBeNull();
    expect(createBrowserSettingsRegistry().getStorageError()).toMatch(/Saved settings could not be read/);
  });

  it("reports inaccessible browser storage but accepts explicit memory-only use", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(createBrowserSettingsRegistry().getStorageError()).toMatch(/Browser storage is unavailable/);
    expect(createBrowserSettingsRegistry({ storage: null }).getStorageError()).toBeNull();
  });

  it("adopts omitted-storage browser records through one explicitly injected core registry", () => {
    const stored = storage();
    vi.stubGlobal("localStorage", stored);
    const spec = {
      id: "host.visible", label: "Visible", description: "A host-owned setting.",
      unit: "none" as const, kind: "boolean" as const, default: false, defaultReason: "Off until selected.",
      home: { tab: "interface", section: "host", level: "main" as const }, appliesLive: true, source: "src/host.ts",
    };
    const browserRegistry = createBrowserSettingsRegistry();
    browserRegistry.register([spec]);
    browserRegistry.set(spec.id, true);
    const injectedCore = createSettingsRegistry({ storage: stored });
    injectedCore.register([spec]);
    expect(injectedCore.inspect(spec.id)).toMatchObject({ value: true, provenance: "user" });
    expect(stored.data.get(SETTINGS_STORAGE_KEY)).toBe(JSON.stringify({ version: 1, values: { "host.visible": true } }));
    const memoryCore = createSettingsRegistry();
    memoryCore.register([spec]);
    expect(memoryCore.inspect(spec.id)).toMatchObject({ value: false, provenance: "default" });
  });

  it("preserves workspace record/key with supplied storage and no browser", () => {
    const stored = storage();
    const state = createWindowWorkspaceState({ primary: { tabs: ["about", "map"], activeTab: "map", collapsed: true, width: 345 }, secondary: { tabs: ["settings"], height: 280 } });
    saveWorkspace(state, stored);
    expect(stored.data.get(SAVED_WORKSPACE_STORAGE_KEY)).toBe(JSON.stringify(state));
    expect(loadSavedWorkspace(new Set(["about", "map", "settings"]), stored)).toEqual(state);
  });

  it("treats inaccessible workspace storage as best effort without altering settings", () => {
    const failing: SettingsStorage = { getItem: () => { throw new Error("read blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(loadSavedWorkspace(new Set(["about"]), failing)).toBeNull();
    expect(loadSavedWorkspace(new Set(["about"]), null)).toBeNull();
    expect(() => saveWorkspace(createWindowWorkspaceState(), failing)).not.toThrow();
  });
});
