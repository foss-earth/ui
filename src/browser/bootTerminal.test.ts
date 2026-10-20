// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootTerminal } from "../../vite/index.mjs";
import { attachBootLog, bootReady, bootStep, failBoot, finishBoot } from "./bootSteps.js";
import { BOOT_TERMINAL_GLOBAL, installBootTerminal, type BootGraph, type BootLogEntry, type FossEarthBoot } from "./bootTerminal.js";
import { isolationStatus } from "./isolation.js";

const PAGE = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Minneapolis</title></head><body><div id=\"root\"></div></body></html>";
/** The markup the plugin writes, up to its runtime's script. */
const MARKUP = (() => {
  const html = bootTerminal().transformIndexHtml.handler(PAGE, { path: "/minneapolis/index.html" });
  return html.slice(html.indexOf("<body>") + 6, html.indexOf("<script>", html.indexOf("<body>")));
})();
const RECORD_KEY = "foss-earth.boot /tour/minneapolis/";

interface Resource { name: string; startTime: number; responseEnd: number; transferSize: number; encodedBodySize: number }
let cleanups: (() => void)[] = [];

beforeEach(() => {
  const items = new Map<string, string>();
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, String(value)); } };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (globalThis as Record<string, unknown>)[BOOT_TERMINAL_GLOBAL];
});

/** A page with the terminal, on a clock and a network the test moves. */
function page(graph: BootGraph | null, options: { reducedMotion?: boolean; isolation?: string } = {}) {
  window.history.replaceState(null, "", "/tour/minneapolis/");
  document.body.innerHTML = MARKUP;
  let time = 0;
  const resources: Resource[] = [];
  const marks: { name: string; startTime: number }[] = [];
  const observers = new Map<string, (entries: unknown[]) => void>();
  let timeouts: { at: number; run: () => void }[] = [];
  const performance = {
    now: () => time,
    mark: (name: string, mark?: { startTime?: number }) => { marks.push({ name, startTime: mark?.startTime ?? time }); },
    getEntriesByName: (name: string) => marks.filter(mark => mark.name === name),
    getEntriesByType: (type: string) => type === "resource" ? resources : [],
  };
  class PerformanceObserver {
    type = "";
    constructor(private readonly callback: (list: { getEntries(): unknown[] }, observer: PerformanceObserver) => void) {}
    observe(init: { type: string }) {
      this.type = init.type;
      observers.set(init.type, entries => this.callback({ getEntries: () => entries }, this));
    }
    disconnect() { observers.delete(this.type); }
  }
  const listeners: [string, EventListener, boolean][] = [];
  const view = {
    document, location: window.location, localStorage: window.localStorage, HTMLScriptElement: window.HTMLScriptElement,
    performance, PerformanceObserver,
    addEventListener(type: string, listener: EventListener, capture: boolean) {
      listeners.push([type, listener, capture]);
      window.addEventListener(type, listener, capture);
    },
    setTimeout(run: () => void, ms = 0) { timeouts.push({ at: time + ms, run }); return timeouts.length; },
    setInterval: () => 1,
    clearInterval: () => {},
    matchMedia: () => ({ matches: options.reducedMotion ?? false }),
    __fossEarthIsolation: options.isolation ? { state: options.isolation } : undefined,
  };
  cleanups.push(() => { for (const [type, listener, capture] of listeners) window.removeEventListener(type, listener, capture); });
  installBootTerminal(view as unknown as Window & typeof globalThis, graph);
  const root = document.getElementById("foss-earth-boot")!;
  return {
    view,
    root,
    boot: (view as unknown as Record<string, FossEarthBoot>)[BOOT_TERMINAL_GLOBAL]!,
    marks,
    observers,
    /** Moves the clock to `ms` and runs what was due by then. */
    at(ms: number) {
      time = ms;
      for (let due = timeouts.filter(timeout => timeout.at <= time); due.length > 0; due = timeouts.filter(timeout => timeout.at <= time)) {
        timeouts = timeouts.filter(timeout => !due.includes(timeout));
        for (const timeout of due) timeout.run();
      }
    },
    /** A file of the page's arrives: over the network unless `cached`. */
    arrive(path: string, startTime: number, responseEnd: number, bytes: number, cached = false) {
      const entry = { name: new URL(path, window.location.href).href, startTime, responseEnd, transferSize: cached ? 0 : bytes + 300, encodedBodySize: bytes };
      resources.push(entry);
      observers.get("resource")?.([entry]);
    },
    lines: () => [...root.querySelectorAll("li")].map(row => [row.dataset.tone, row.textContent]),
    progress: () => Number(root.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")),
  };
}

const GRAPH: BootGraph = { base: "/tour/", files: [["assets/a.js", 300_000], ["assets/b.js", 1_700_000]] };

function fakeLog(connected = true) {
  const calls: (["print" | "update", BootLogEntry])[] = [];
  return {
    calls,
    element: { isConnected: connected },
    print(entry: BootLogEntry) {
      calls.push(["print", entry]);
      return { update: (next: BootLogEntry) => { calls.push(["update", next]); } };
    },
  };
}

describe("boot terminal", () => {
  it("counts the download by the bytes of the files the page waits for", () => {
    const terminal = page(GRAPH);
    expect(terminal.lines()).toEqual([["info", "Downloading the app…"]]);
    terminal.at(1000);
    terminal.arrive("/tour/assets/a.js", 0, 1000, 300_000);
    terminal.at(1000);
    // 1.7 MB left at 300 KB a second.
    expect(terminal.lines()).toEqual([["info", "Downloading the app: 300 KB of 2.0 MB, about 6 s left"]]);
    expect(terminal.progress()).toBe(12);
    terminal.at(2500);
    terminal.arrive("/tour/assets/b.js", 200, 2400, 1_700_000);
    terminal.at(2500);
    expect(terminal.lines()).toEqual([["success", "Downloaded the app: 2.0 MB in 2.4 s"]]);
    expect(terminal.progress()).toBe(62);
  });

  it("fetches the lazy modules it waits for at once, unless the page is about to reload to isolate itself", () => {
    const graph: BootGraph = { ...GRAPH, files: [...GRAPH.files, ["assets/b.css", 9_000]], preload: ["assets/b.js", "assets/b.css"] };
    const links = () => [...document.head.querySelectorAll("link")].map(link => ["rel", "as", "crossorigin", "href"].map(name => link.getAttribute(name)));
    page(graph);
    expect(links()).toEqual([["modulepreload", null, "", "/tour/assets/b.js"], ["preload", "style", "", "/tour/assets/b.css"]]);
    document.head.innerHTML = "";
    page(graph, { isolation: "isolated" });
    expect(links()).toHaveLength(2);
    document.head.innerHTML = "";
    const reloading = page(graph, { isolation: "pending" });
    // Where the isolation script keeps its status.
    expect(isolationStatus(reloading.view as unknown as Window)?.state).toBe("pending");
    expect(links()).toEqual([]);
  });

  it("says when the app came from this device", () => {
    const terminal = page(GRAPH);
    terminal.at(100);
    terminal.arrive("/tour/assets/a.js", 20, 100, 300_000, true);
    terminal.at(100);
    expect(terminal.lines()).toEqual([["info", "Loading the app from this device: 1 of 2 files"]]);
    terminal.arrive("/tour/assets/other.js", 20, 100, 10);
    terminal.at(400);
    terminal.arrive("/tour/assets/b.js", 40, 300, 1_700_000, true);
    expect(terminal.lines()).toEqual([["success", "Loaded the app from this device in 0.3 s"]]);
  });

  it("weighs the time left by this device's last start", () => {
    window.localStorage.setItem(RECORD_KEY, JSON.stringify({ downloadMs: 5000, startupMs: 4000 }));
    const terminal = page(GRAPH);
    terminal.at(1000);
    terminal.arrive("/tour/assets/a.js", 0, 1000, 300_000);
    terminal.at(1000);
    expect(terminal.lines()).toEqual([["info", "Downloading the app: 300 KB of 2.0 MB, about 10 s left"]]);
  });

  it("adds the app's steps, each ending those before it, and its bar never goes back", () => {
    const terminal = page(null);
    terminal.at(800);
    terminal.boot.step("modules", "Starting the app", 0);
    terminal.boot.step("renderer", "Starting the renderer", 0.05);
    terminal.boot.step("renderer", "Started WebGPU", 0.3);
    terminal.at(800);
    expect(terminal.lines()).toEqual([["success", "Loaded the app in 0.8 s"], ["success", "Starting the app"], ["info", "Started WebGPU"]]);
    expect(terminal.progress()).toBe(54);
    terminal.boot.step("scene", "Preparing the 3D scene", 0.1);
    terminal.boot.step("scene", "Preparing the 3D scene", 7);
    terminal.at(900);
    expect(terminal.progress()).toBe(54);
    expect(terminal.lines().at(-1)).toEqual(["info", "Preparing the 3D scene"]);
  });

  it("prints its lines into the app's log, and each later one too", () => {
    const terminal = page(null);
    terminal.at(800);
    terminal.boot.step("modules", "Starting the app", 0);
    const log = fakeLog();
    terminal.boot.attach(log);
    expect(log.calls).toEqual([["print", { text: "Loaded the app in 0.8 s", tone: "success" }], ["print", { text: "Starting the app", tone: "info" }]]);
    log.calls.length = 0;
    terminal.boot.step("renderer", "Starting the renderer", 0.05);
    expect(log.calls).toEqual([
      ["update", { text: "Starting the app", tone: "success" }],
      ["print", { text: "Starting the renderer", tone: "info" }],
      ["update", { text: "Starting the renderer", tone: "info" }],
    ]);
    const other = fakeLog();
    terminal.boot.attach(other);
    expect(other.calls).toEqual([]);
  });

  it("fades at the first frame and remembers how long the start took", () => {
    const terminal = page(null);
    terminal.at(800);
    terminal.boot.step("modules", "Starting the app", 0);
    terminal.at(2000);
    terminal.boot.done();
    expect(terminal.root.hasAttribute("data-done")).toBe(true);
    expect(terminal.lines().map(([tone]) => tone)).toEqual(["success", "success"]);
    expect(JSON.parse(window.localStorage.getItem(RECORD_KEY)!)).toEqual({ downloadMs: 800, startupMs: 1200 });
    expect(terminal.root.isConnected).toBe(true);
    terminal.at(2200);
    expect(terminal.root.isConnected).toBe(false);
    terminal.boot.step("late", "After the end", 1);
    terminal.boot.fail("After the end");
    expect(terminal.lines()).toHaveLength(2);
  });

  it("goes at once where motion is reduced", () => {
    const terminal = page(null, { reducedMotion: true });
    terminal.boot.done();
    expect(terminal.root.isConnected).toBe(false);
  });

  it("goes when the app is ready, unless an attached log promised the first frame", () => {
    const alone = page(null);
    alone.boot.ready();
    expect(alone.root.hasAttribute("data-done")).toBe(true);
    const withLog = page(null);
    withLog.boot.attach(fakeLog());
    withLog.boot.ready();
    expect(withLog.root.hasAttribute("data-done")).toBe(false);
    withLog.boot.done();
    expect(withLog.root.hasAttribute("data-done")).toBe(true);
  });

  it("ends a failed start with the reason, and stays", () => {
    const terminal = page(null);
    terminal.boot.step("modules", "Starting the app", 0);
    terminal.boot.fail("The app could not start.");
    expect(terminal.lines().at(-1)).toEqual(["error", "The app could not start."]);
    expect(terminal.root.hasAttribute("data-failed")).toBe(true);
    terminal.boot.step("renderer", "Starting the renderer", 0.05);
    terminal.boot.ready();
    terminal.boot.done();
    expect(terminal.lines()).toHaveLength(3);
    expect(terminal.root.hasAttribute("data-done")).toBe(false);
    expect(window.localStorage.getItem(RECORD_KEY)).toBeNull();
  });

  it("hands a failure to the app's log while that is on the page", () => {
    const shown = page(null);
    shown.boot.attach(fakeLog(true));
    shown.boot.fail("The app could not start.");
    expect(shown.root.hasAttribute("data-done")).toBe(true);
    expect(shown.lines().some(([tone]) => tone === "error")).toBe(false);
    const hidden = page(null);
    hidden.boot.attach(fakeLog(false));
    hidden.boot.fail("The app could not start.");
    expect(hidden.lines().at(-1)).toEqual(["error", "The app could not start."]);
  });

  it("fails when a module the page needs cannot download", () => {
    const terminal = page(GRAPH);
    const classic = document.createElement("script");
    document.body.append(classic);
    classic.dispatchEvent(new Event("error"));
    expect(terminal.root.hasAttribute("data-failed")).toBe(false);
    const module = document.createElement("script");
    module.type = "module";
    document.body.append(module);
    module.dispatchEvent(new Event("error"));
    expect(terminal.lines().at(-1)).toEqual(["error", "The app could not download. Check the connection, then reload the page."]);
  });

  it("keeps the recovery's offer once it goes", () => {
    const terminal = page(null, { reducedMotion: true });
    const offer = document.createElement("div");
    offer.className = "foss-earth-browser-recovery-offer";
    terminal.root.append(offer);
    terminal.boot.done();
    expect(terminal.root.isConnected).toBe(false);
    expect(offer.parentElement).toBe(document.body);
  });

  it("marks when the page first painted it", () => {
    const terminal = page(null);
    terminal.observers.get("paint")?.([{ name: "first-paint", startTime: 50 }, { name: "first-contentful-paint", startTime: 60 }]);
    expect(terminal.marks).toEqual([{ name: "boot:terminal", startTime: 60 }]);
    expect(terminal.observers.has("paint")).toBe(false);
  });

  it("leaves a page without its markup alone", () => {
    document.body.innerHTML = "";
    const view = { document } as unknown as Window & typeof globalThis;
    installBootTerminal(view, null);
    expect((view as unknown as Record<string, unknown>)[BOOT_TERMINAL_GLOBAL]).toBeUndefined();
  });
});

describe("boot steps", () => {
  it("reach the page's terminal, and do nothing without one", () => {
    const log = fakeLog();
    expect(() => { bootStep("modules", "Starting the app", 0); attachBootLog(log); bootReady(); failBoot("x"); finishBoot(); }).not.toThrow();
    const boot = { step: vi.fn(), attach: vi.fn(), done: vi.fn(), ready: vi.fn(), fail: vi.fn() };
    (globalThis as Record<string, unknown>)[BOOT_TERMINAL_GLOBAL] = boot;
    bootStep("modules", "Starting the app", 0);
    attachBootLog(log);
    bootReady();
    failBoot("The app could not start.");
    finishBoot();
    expect(boot.step).toHaveBeenCalledWith("modules", "Starting the app", 0);
    expect(boot.attach).toHaveBeenCalledWith(log);
    expect(boot.ready).toHaveBeenCalledOnce();
    expect(boot.fail).toHaveBeenCalledWith("The app could not start.");
    expect(boot.done).toHaveBeenCalledOnce();
  });
});
