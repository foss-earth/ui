import { describe, expect, it, vi } from "vitest";
import { createDiagnostics, type DiagnosticsRuntime } from "./createDiagnostics.js";
import { createSettingsRegistry } from "../settings/registry.js";
import { UI_PARAMETERS } from "../settings/uiParameters.js";
import type { GameLog, GameLogEntry } from "../log/createGameLog.js";
import { fakeBrowser } from "../../tests/fixtures/trailEnvironment.js";

function fixture(trailIdentity?: () => string) {
  const settings = createSettingsRegistry({ storage: null }); settings.register(UI_PARAMETERS);
  const printed: GameLogEntry[] = [];
  const updated: GameLogEntry[] = [];
  const hostDestroy = vi.fn();
  const hostLog: GameLog = {
    element: {} as HTMLElement,
    print(entry) { printed.push(entry); return { update: next => { updated.push(next); }, remove() {}, focusAction() {} }; },
    setBusy() {}, setOpen() {}, isOpen: () => false, minimize() {}, isMinimized: () => false, destroy: hostDestroy,
  };
  const browser = fakeBrowser();
  const diagnostics = createDiagnostics({ settings, log: hostLog, trailEnvironment: browser.page("a"), trailIdentity, parts: () => ({
    appName: "Host globe", at: new Date(0), page: "https://host.test/", build: "host-build", source: "host-source", bundle: "host.js",
    userAgent: "Host browser", screen: { width: 800, height: 600, devicePixelRatio: 1, touch: false },
    device: { cores: null, memoryGiB: null }, renderer: { asked: "auto", mode: "webgl2", driver: null, maxTextureSize: null, fallbackReason: null, lost: 0 },
    state: ["Host supplied state"],
  }) });
  return { settings, diagnostics, printed, updated, hostDestroy, browser };
}

describe("injected diagnostics", () => {
  it("records the injected host identity and refreshes it without owning the host", () => {
    let identity = "Tour with Earth source a; renderer not started.";
    const { diagnostics, browser } = fixture(() => identity);
    diagnostics.trail.refresh();
    expect(JSON.parse([...browser.items.values()][0]).app).toBe(identity);
    identity = "Tour with Earth source a; renderer webgl2.";
    diagnostics.trail.refresh();
    expect(JSON.parse([...browser.items.values()][0]).app).toBe(identity);
    diagnostics.destroy();
  });
  it("keeps host identity, settings and completed progress in one report", async () => {
    const { diagnostics, settings, printed } = fixture();
    const line = diagnostics.log.print({ text: "Loading", tone: "progress", progress: 0.1 });
    line.update({ text: "Loading", tone: "progress", progress: 0.5 });
    line.update({ text: "Ready", tone: "success" });
    settings.set("interface.theme", "light");
    const remove = diagnostics.addState(() => "Host cache state");
    const report = await diagnostics.report();
    expect(report).toContain("Host globe report, 1970-01-01T00:00:00.000Z");
    expect(report).toContain("Host cache state");
    expect(report).toContain("interface.theme = Light");
    expect(diagnostics.trail.steps().filter(step => step.text.includes("Loading"))).toHaveLength(1);
    expect(diagnostics.trail.steps().some(step => step.text.includes("Ready"))).toBe(true);
    expect(printed).toHaveLength(1);
    remove(); expect(await diagnostics.report()).not.toContain("Host cache state");
    diagnostics.destroy();
  });

  it("replaces runtime listeners, stops all resources and leaves the host log owned by the host", () => {
    const { diagnostics, hostDestroy, printed } = fixture();
    const stops: ReturnType<typeof vi.fn>[] = [];
    let lost!: () => void;
    const runtime = (): DiagnosticsRuntime => ({
      describe: () => "Host renderer",
      onDeviceLost(listener) { lost = listener; const stop = vi.fn(); stops.push(stop); return stop; },
      onDeviceRestored() { const stop = vi.fn(); stops.push(stop); return stop; },
    });
    diagnostics.attachRuntime(runtime()); diagnostics.attachRuntime(runtime());
    expect(stops.slice(0, 2).every(stop => stop.mock.calls.length === 1)).toBe(true);
    lost(); expect(printed).toHaveLength(1);
    diagnostics.destroy(); diagnostics.destroy(); lost();
    diagnostics.log.print({ text: "Closed" });
    expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
    expect(printed).toHaveLength(1); expect(hostDestroy).not.toHaveBeenCalled();
    expect(() => diagnostics.attachRuntime(runtime())).toThrow("disposed");
  });

  it("rejects a report whose host state arrives after disposal", async () => {
    const { diagnostics } = fixture();
    let resolve!: (value: string) => void;
    diagnostics.addState(() => new Promise<string>(done => { resolve = done; }));
    const report = diagnostics.report(); await Promise.resolve();
    diagnostics.destroy(); resolve("Late state");
    await expect(report).rejects.toThrow("disposed");
  });
});
