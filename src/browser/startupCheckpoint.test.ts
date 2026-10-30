// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installEarlyStartupCheckpoint, readStartupCheckpoints } from "../diagnostics/startupCheckpoint.js";
import { UI_PARAMETERS } from "../settings/uiParameters.js";
import { createSettingsRegistry } from "../settings/registry.js";
import { startBrowserStartupCheckpoint, browserStartupEnvironment } from "./startupCheckpoint.js";
beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key), clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; },
  } });
});
afterEach(() => {
  vi.useRealTimers(); window.localStorage.clear(); history.replaceState(null, "", "/");
  delete (window as Window & { __fossEarthStartup?: unknown }).__fossEarthStartup;
});
function settings() {
  const value = createSettingsRegistry();
  value.register(UI_PARAMETERS);
  value.register([{ id: "test.secret", label: "Secret", kind: "text", default: "", sensitive: true,
    description: "Test credential", unit: "none", defaultReason: "Unset", home: { tab: "settings", section: "test", level: "all" },
    appliesLive: true, source: "test" }]);
  return value;
}
describe("browser startup capture", () => {
  it("saves before modules run and leaves reports and browser-data review read-only", () => {
    history.replaceState(null, "", "/fly/"); installEarlyStartupCheckpoint(window);
    const before = window.localStorage.getItem("foss-earth.startup.v1 /fly/ current");
    expect(before).toContain("Application modules have not started");
    delete (window as Window & { __fossEarthStartup?: unknown }).__fossEarthStartup;
    history.replaceState(null, "", "/fly/?report"); installEarlyStartupCheckpoint(window);
    expect(window.localStorage.getItem("foss-earth.startup.v1 /fly/ current")).toBe(before);
    history.replaceState(null, "", "/fly/?resetBrowserData=1"); installEarlyStartupCheckpoint(window);
    expect(window.localStorage.getItem("foss-earth.startup.v1 /fly/ current")).toBe(before);
  });
  it("redacts before persistence, coalesces progress, flushes critical operations, and obeys retention", () => {
    vi.useFakeTimers(); history.replaceState(null, "", "/fly/");
    const registry = settings(); registry.set("test.secret", "my-private-key");
    const capture = startBrowserStartupCheckpoint(registry);
    capture.section("loading.txt", "my-private-key https://example.test/a?key=hidden", true);
    const read = () => readStartupCheckpoints(browserStartupEnvironment(), "/fly/")[0]!;
    expect(read().sections["loading.txt"]).not.toContain("my-private-key");
    expect(read().sections["loading.txt"]).not.toContain("hidden");
    capture.section("loading.txt", "progress 1"); capture.section("loading.txt", "progress 2");
    expect(read().sections["loading.txt"]).not.toContain("progress");
    vi.advanceTimersByTime(1000); expect(read().sections["loading.txt"]).toBe("progress 2");
    capture.section("loading.txt", "before expensive work", true);
    expect(read().sections["loading.txt"]).toBe("before expensive work");
    registry.set("diagnostics.trail", false);
    expect(readStartupCheckpoints(browserStartupEnvironment(), "/fly/")).toEqual([]);
    registry.set("diagnostics.trail", true);
    capture.section("loading.txt", "retention resumed", true);
    expect(read().sections["loading.txt"]).toBe("retention resumed");
    capture.destroy();
  });
});
