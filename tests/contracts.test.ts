import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createSettingsRegistry,
  createUiContributionRegistry,
  hideWorkspaceTabs,
  parseSavedWorkspace,
  restoreWorkspaceTabs,
  SETTINGS_STORAGE_KEY,
  type ParameterSpec,
} from "../src/index.js";

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

const rendererBackend: ParameterSpec = {
  id: "renderer.backend", label: "Renderer", description: "The host's backend choice.",
  unit: "none", kind: "choice", choices: [{ id: "auto", label: "Auto" }, { id: "webgl2", label: "WebGL 2" }],
  default: "auto", defaultReason: "Host auto detection.", home: { tab: "renderer", section: "backend", level: "main" },
  appliesLive: false, source: "src/host-renderer.ts",
};
const resolution: ParameterSpec = {
  ...rendererBackend, id: "renderer.resolutionScale", label: "Resolution", kind: "number", unit: "ratio",
  choices: undefined, bounds: () => ({ min: 0.25, max: 2 }), default: 1,
  home: { tab: "renderer", section: "frame", level: "main" }, appliesLive: true,
};
const timeMode: ParameterSpec = {
  ...rendererBackend, id: "sky.time.mode", label: "Time", choices: [{ id: "now", label: "Now" }, { id: "fixed", label: "Fixed" }],
  default: "now", home: { tab: "time", section: "instant", level: "main" }, appliesLive: true,
};

describe("current-host compatibility fixtures", () => {
  it("loads existing parameter IDs/provenance and preserves pending host settings", () => {
    const data = new Map([[SETTINGS_STORAGE_KEY, fixture("settings-v1.json")]]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const settings = createSettingsRegistry({ storage });
    settings.register([rendererBackend, resolution, timeMode]);
    expect(settings.get("renderer.backend")).toBe("webgl2");
    expect(settings.inspect("renderer.resolutionScale")).toMatchObject({ value: 0.75, provenance: "preset", preset: "Host saved preset" });
    expect(settings.get("sky.time.mode")).toBe("fixed");
    settings.set("renderer.resolutionScale", 0.5);
    expect(JSON.parse(data.get(SETTINGS_STORAGE_KEY)!).values["host.unregistered"]).toBe(42);
    expect(settings.sections("time")).toEqual(["instant"]);
    settings.migrateLegacy([{ key: "fixture.legacy-renderer", migrate: () => ({ "renderer.backend": "auto" }) }]);
    expect(settings.get("renderer.backend")).toBe("webgl2");
  });

  it("keeps the 13 IDs and host-supplied 11/9 context availability without feature imports", () => {
    const tabs = JSON.parse(fixture("current-tabs.json")) as { registered: string[]; globeHidden: string[]; panoramaHidden: string[] };
    const registry = createUiContributionRegistry<"globe" | "panorama", object, object>({ settings: createSettingsRegistry(), ports: {}, context: "globe" });
    for (const id of tabs.registered) registry.register({
      id: `host.${id}`, tabId: id, label: id,
      isAvailable: context => !(context === "globe" ? tabs.globeHidden : tabs.panoramaHidden).includes(id),
      create: () => ({ mount: () => {}, unmount: () => {}, dispose: () => {} }),
    });
    expect(registry.list()).toHaveLength(13);
    expect(registry.list().filter(item => item.available)).toHaveLength(11);
    registry.setContext("panorama");
    expect(registry.list().filter(item => item.available)).toHaveLength(9);
    expect(registry.list().map(item => item.tabId)).toEqual(tabs.registered);
    registry.dispose();
  });

  it("keeps hidden tabs in their recorded positions and preserves workspace sizes", () => {
    const state = parseSavedWorkspace(fixture("workspace.json"), new Set(["location", "map", "about", "settings", "scenes", "renderer"]));
    expect(state).not.toBeNull();
    const hidden = hideWorkspaceTabs(state!, new Set(["location", "map"]));
    expect(restoreWorkspaceTabs(hidden.state, hidden.hidden, true)).toEqual(state);
    expect(state?.secondary).toMatchObject({ collapsed: true, width: 380, height: 520 });
  });

  it("deduplicates restorable tabs in and across slots while rejecting malformed sizes", () => {
    const state = parseSavedWorkspace(JSON.stringify({
      primary: { tabs: ["map", "map", "unknown", 1], activeTab: "unknown", width: -2, height: "100" },
      secondary: { tabs: ["map", "about"], activeTab: "about", collapsed: true },
    }), new Set(["map", "about"]));
    expect(state?.primary).toMatchObject({ tabs: ["map"], activeTab: "map", width: null, height: null });
    expect(state?.secondary).toMatchObject({ tabs: ["about"], activeTab: "about", collapsed: true });
    expect(parseSavedWorkspace("invalid JSON", new Set(["map"]))).toBeNull();
    expect(parseSavedWorkspace("[]", new Set(["map"]))).toBeNull();
  });
});
