import { describe, expect, it, vi } from "vitest";
import {
  createSettingsRegistry,
  createUiContributionRegistry,
  type UiContributionDefinition,
} from "../src/index.js";

type Context = "globe" | "panorama";
type Ports = { toggleTab(id: string): void };

function setup() {
  const settings = createSettingsRegistry({ storage: null });
  const ports = { toggleTab: vi.fn() };
  const registry = createUiContributionRegistry<Context, string, Ports>({ settings, ports, context: "globe" });
  const create = vi.fn();
  const mount = vi.fn();
  const unmount = vi.fn();
  const dispose = vi.fn();
  const definition: UiContributionDefinition<Context, string, Ports> = {
    id: "engine.location",
    tabId: "location",
    label: "Location",
    isAvailable: context => context === "globe",
    create: host => {
      create(host);
      return { mount, unmount, dispose };
    },
  };
  return { registry, settings, ports, definition, create, mount, unmount, dispose };
}

describe("injected UI contributions", () => {
  it("registers stable IDs without mounting or creating a feature", () => {
    const item = setup();
    item.registry.register(item.definition);
    item.definition.id = "later-mutation";
    expect(item.registry.list()).toEqual([{ id: "engine.location", tabId: "location", label: "Location", available: true, mounted: false }]);
    expect(item.create).not.toHaveBeenCalled();
    expect(() => item.registry.register({ ...item.definition, id: "engine.location" })).toThrow(/already registered/);
    item.registry.dispose();
    expect(item.dispose).not.toHaveBeenCalled();
  });

  it("passes the exact host settings and ports, with one lazy instance", () => {
    const item = setup();
    item.registry.register(item.definition);
    expect(item.registry.mount("engine.location", "left-panel")).toBe(true);
    expect(item.create).toHaveBeenCalledTimes(1);
    expect(item.create.mock.calls[0][0].settings).toBe(item.settings);
    expect(item.create.mock.calls[0][0].ports).toBe(item.ports);
    expect(item.mount).toHaveBeenCalledExactlyOnceWith({ context: "globe", target: "left-panel" });
    expect(item.registry.mount("engine.location", "left-panel")).toBe(true);
    expect(item.mount).toHaveBeenCalledTimes(1);
    item.registry.unmount("engine.location");
    item.registry.mount("engine.location", "right-panel");
    expect(item.create).toHaveBeenCalledTimes(1);
    expect(item.unmount).toHaveBeenCalledTimes(1);
    expect(item.mount).toHaveBeenLastCalledWith({ context: "globe", target: "right-panel" });
    item.registry.dispose();
    expect(item.unmount).toHaveBeenCalledTimes(2);
    expect(item.dispose).toHaveBeenCalledTimes(1);
  });

  it("hides unavailable contributions and restores requested mounts across contexts", () => {
    const item = setup();
    item.registry.register(item.definition);
    item.registry.mount("engine.location", "left-panel");
    item.registry.setContext("panorama");
    expect(item.unmount).toHaveBeenCalledTimes(1);
    expect(item.dispose).not.toHaveBeenCalled();
    expect(item.registry.list()[0]).toMatchObject({ available: false, mounted: false });
    item.registry.setContext("globe");
    expect(item.create).toHaveBeenCalledTimes(1);
    expect(item.mount).toHaveBeenCalledTimes(2);
    item.registry.setContext("globe");
    expect(item.mount).toHaveBeenCalledTimes(2);
    item.registry.setContext("panorama");
    item.registry.unmount("engine.location");
    item.registry.setContext("globe");
    expect(item.mount).toHaveBeenCalledTimes(2);
    item.registry.dispose();
  });

  it("does not create an unavailable feature until its context arrives", () => {
    const item = setup();
    item.registry.setContext("panorama");
    item.registry.register(item.definition);
    expect(item.registry.mount("engine.location", "panel")).toBe(false);
    expect(item.create).not.toHaveBeenCalled();
    item.registry.setContext("globe");
    expect(item.mount).toHaveBeenCalledExactlyOnceWith({ context: "globe", target: "panel" });
    item.registry.dispose();
  });

  it("unregisters once, leaves host settings intact, and cannot unregister a replacement", () => {
    const item = setup();
    item.settings.register([{
      id: "host.preference", label: "Preference", description: "The host's saved preference.",
      unit: "none", kind: "boolean", default: false, defaultReason: "Off until chosen.",
      home: { tab: "settings", section: "host", level: "main" }, appliesLive: true, source: "src/host.ts",
    }]);
    item.settings.set("host.preference", true);
    const remove = item.registry.register(item.definition);
    item.registry.mount("engine.location", "panel");
    remove();
    remove();
    expect(item.unmount).toHaveBeenCalledTimes(1);
    expect(item.dispose).toHaveBeenCalledTimes(1);
    expect(item.registry.list()).toEqual([]);
    item.registry.register(item.definition);
    remove();
    expect(item.registry.list()).toHaveLength(1);
    expect(item.settings.has("host.preference")).toBe(true);
    expect(item.settings.get("host.preference")).toBe(true);
    item.registry.dispose();
  });

  it("cleans up a partial failed mount, then permits a fresh attempt", () => {
    const item = setup();
    item.mount.mockImplementationOnce(() => { throw new Error("mount failed"); });
    item.registry.register(item.definition);
    expect(() => item.registry.mount("engine.location", "panel")).toThrow("mount failed");
    expect(item.unmount).toHaveBeenCalledTimes(1);
    expect(item.dispose).toHaveBeenCalledTimes(1);
    expect(item.registry.list()[0].mounted).toBe(false);
    item.registry.mount("engine.location", "panel");
    expect(item.create).toHaveBeenCalledTimes(2);
    item.registry.dispose();
  });

  it("disposes all entries even when a host cleanup fails", () => {
    const item = setup();
    const secondDispose = vi.fn();
    item.unmount.mockImplementation(() => { throw new Error("cleanup failed"); });
    item.registry.register(item.definition);
    item.registry.register({ ...item.definition, id: "engine.other", create: () => ({ mount: () => {}, unmount: () => {}, dispose: secondDispose }) });
    item.registry.mount("engine.location", "one");
    item.registry.mount("engine.other", "two");
    expect(() => item.registry.dispose()).toThrow(AggregateError);
    expect(item.dispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledTimes(1);
    expect(item.registry.list()).toEqual([]);
    expect(() => item.registry.dispose()).not.toThrow();
    expect(() => item.registry.mount("engine.other", "one")).toThrow(/disposed/);
  });

  it("notifies explicit subscribers and removes them on final disposal", () => {
    const item = setup();
    const changed = vi.fn();
    const stop = item.registry.subscribe(changed);
    item.registry.register(item.definition);
    item.registry.mount("engine.location", "panel");
    item.registry.setContext("panorama");
    expect(changed).toHaveBeenCalledTimes(3);
    stop();
    item.registry.dispose();
    expect(changed).toHaveBeenCalledTimes(3);
  });
});
