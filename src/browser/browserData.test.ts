// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_STORAGE_KEY } from "../settings/registry.js";
import { TRAIL_KEY_PREFIX } from "../diagnostics/sessionTrail.js";
import { browserRecovery } from "../../vite/index.mjs";
import {
  createBrowserDataPanel,
  installBrowserRecovery,
  isBrowserRecoveryPage,
  markBrowserAppReady,
  reportBrowserAppFailure,
  type BrowserRecoveryInstallOptions,
} from "./browserData.js";

const RECOVERY_KEY = "foss-earth.browser-recovery.v1";
const SECRET = "super-secret-google-key";

function counts(): Record<string, number> {
  const raw = window.localStorage.getItem(RECOVERY_KEY);
  return raw ? (JSON.parse(raw) as { failures: Record<string, number> }).failures : {};
}

function replaceStorage(name: "localStorage" | "sessionStorage", value: Storage): void {
  Object.defineProperty(window, name, { configurable: true, value });
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    key(index: number) { return [...items.keys()][index] ?? null; },
    getItem(key: string) { return items.get(String(key)) ?? null; },
    setItem(key: string, value: string) { items.set(String(key), String(value)); },
    removeItem(key: string) { items.delete(String(key)); },
    clear() { items.clear(); },
  };
}

function clock() {
  const queued: { id: number; work: () => void; delayMs: number }[] = [];
  let next = 1;
  return {
    queued,
    schedule(work: () => void, delayMs: number) {
      const id = next++;
      queued.push({ id, work, delayMs });
      return id;
    },
    cancel(id: number) {
      const index = queued.findIndex(item => item.id === id);
      if (index >= 0) queued.splice(index, 1);
    },
    fire() {
      queued.shift()?.work();
    },
  };
}

function keepTrail(id: string, startedAt: number, steps: { ms: number; text: string; count?: number; lastMs?: number }[], extra: { app?: string; state?: string; closed?: boolean; hidden?: boolean } = {}): void {
  window.localStorage.setItem(`${TRAIL_KEY_PREFIX}${id}`, JSON.stringify({ version: 1, id, startedAt, app: "", state: "", steps, closed: false, hidden: false, ...extra }));
}

function crashLogLink(): HTMLAnchorElement {
  const link = [...document.querySelectorAll("a")].find(each => each.textContent === "Download crash log");
  expect(link).toBeDefined();
  return link!;
}

let savedLogs = new Map<string, Blob>();

async function crashLogOf(link: HTMLAnchorElement): Promise<string> {
  const blob = savedLogs.get(link.getAttribute("href") ?? "");
  expect(blob?.type).toBe("text/plain;charset=utf-8");
  return blob!.text();
}

function install(extra: Partial<BrowserRecoveryInstallOptions> = {}) {
  const timers = clock();
  const replace = vi.fn();
  installBrowserRecovery(document, { appId: "foss-earth", schedule: timers.schedule, cancel: timers.cancel, replace, ...extra });
  return { timers, replace };
}

function storageDoubles() {
  const deletedDatabases: string[] = [];
  const deletedCaches: string[] = [];
  let unregistered = 0;
  const caches = new Map([["app-files", "bytes"]]);
  Object.defineProperty(window, "caches", {
    configurable: true,
    value: {
      keys: async () => [...caches.keys()],
      delete: async (name: string) => {
        deletedCaches.push(name);
        return caches.delete(name);
      },
    },
  });
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: {
      databases: async () => [{ name: "tiles" }, { name: "files" }],
      deleteDatabase(name: string) {
        deletedDatabases.push(name);
        const request = {} as IDBOpenDBRequest;
        queueMicrotask(() => request.onsuccess?.(new Event("success")));
        return request;
      },
    },
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistrations: async () => [{ unregister: async () => { unregistered += 1; return true; } }],
    },
  });
  return {
    deletedDatabases,
    deletedCaches,
    unregistered: () => unregistered,
  };
}

async function confirmClear(): Promise<void> {
  document.querySelector<HTMLButtonElement>("button")!.click();
  await vi.waitFor(() => expect(document.querySelector("[role=status]")?.textContent).not.toBe("Clearing this site's browser data…"));
}

beforeEach(() => {
  savedLogs = new Map();
  vi.spyOn(window.URL, "createObjectURL").mockImplementation(blob => {
    const url = `blob:crash-log-${savedLogs.size + 1}`;
    savedLogs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(url => {
    savedLogs.delete(url);
  });
  replaceStorage("localStorage", memoryStorage());
  replaceStorage("sessionStorage", memoryStorage());
  window.history.replaceState(null, "", "/app/");
  document.cookie = `${RECOVERY_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.getElementById("foss-earth-browser-recovery-style")?.remove();
  document.querySelector("[data-foss-earth-browser-recovery]")?.remove();
  document.cookie = `${RECOVERY_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
  delete (window as unknown as Record<string, unknown>).__fossEarthBrowserRecovery;
  Reflect.deleteProperty(window, "caches");
  Reflect.deleteProperty(window, "indexedDB");
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("browser data review", () => {
  it("recognizes only the review address", () => {
    expect(isBrowserRecoveryPage(document)).toBe(false);
    window.history.replaceState(null, "", "/app/?resetBrowserData=1");
    expect(isBrowserRecoveryPage(document)).toBe(true);
    window.history.replaceState(null, "", "/app/?resetBrowserData=0");
    expect(isBrowserRecoveryPage(document)).toBe(false);
  });

  it("links to the review and keeps API keys unless asked", () => {
    window.localStorage.setItem("foss-earth.theme", "dark");
    const panel = createBrowserDataPanel(document);
    document.body.append(panel.element);
    const link = panel.element.querySelector("a")!;
    const checkbox = panel.element.querySelector<HTMLInputElement>('input[name="keepApiKeys"]')!;
    expect(checkbox.checked).toBe(true);
    expect(link.textContent).toBe("Clear browser data");
    expect(link.href).toContain("/app/?resetBrowserData=1");
    expect(link.href).not.toContain("keepApiKeys");
    expect(window.localStorage.getItem("foss-earth.theme")).toBe("dark");
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(link.href).toContain("keepApiKeys=0");
    const href = link.href;
    panel.destroy();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(link.href).toBe(href);
  });

  it("counts failed and stalled starts per page, then clears them on success", () => {
    window.localStorage.setItem("foss-earth.theme", "dark");
    const first = install();
    expect(first.timers.queued.map(item => item.delayMs)).toEqual([45_000]);
    reportBrowserAppFailure(document, "apiKey=private-key");
    expect(counts()).toEqual({ "foss-earth /app/": 1 });
    expect(document.querySelector(".foss-earth-browser-recovery-offer")).toBeNull();
    expect(window.localStorage.getItem("foss-earth.theme")).toBe("dark");

    const second = install();
    expect(first.timers.queued).toHaveLength(0);
    reportBrowserAppFailure(document, "apiKey=private-key");
    const offer = document.querySelector(".foss-earth-browser-recovery-offer");
    expect(counts()).toEqual({ "foss-earth /app/": 2 });
    expect(offer?.textContent).toContain("Clear browser data");
    expect(offer?.textContent).toContain("reported a failure");
    expect(offer?.textContent).not.toContain("private-key");
    expect([...offer!.querySelectorAll("a")].find(link => link.textContent === "Clear browser data")?.getAttribute("href")).toContain("resetBrowserData=1");
    expect(window.localStorage.getItem("foss-earth.theme")).toBe("dark");

    markBrowserAppReady(document);
    expect(window.localStorage.getItem(RECOVERY_KEY)).toBeNull();
    expect(document.querySelector(".foss-earth-browser-recovery-offer")).toBeNull();
    expect(second.timers.queued).toHaveLength(0);
  });

  it("counts a stall only when the start never becomes ready", async () => {
    const timers = install();
    markBrowserAppReady(document);
    expect(timers.timers.queued).toHaveLength(0);
    expect(counts()).toEqual({});

    const stalled = install();
    stalled.timers.fire();
    expect(counts()).toEqual({ "foss-earth /app/": 1 });
    expect(document.querySelector(".foss-earth-browser-recovery-offer")).toBeNull();
    install().timers.fire();
    expect(counts()).toEqual({ "foss-earth /app/": 2 });
    expect(document.querySelector(".foss-earth-browser-recovery-offer")?.textContent).not.toContain("reported a failure");
    expect(await crashLogOf(crashLogLink())).toMatch(/^The last, at \S+Z: The start had not finished after 45 s\.$/m);
  });

  it("offers the crash log before clearing, and the log says what failed", async () => {
    keepTrail("older", Date.UTC(2026, 9, 14, 11), [{ ms: 200, text: "Opened https://example.org/app/" }], { closed: true });
    keepTrail("newer", Date.UTC(2026, 9, 14, 12), [
      { ms: 200, text: "Opened https://example.org/app/" },
      { ms: 900, text: "console.error: GPU device lost", count: 3, lastMs: 1400 },
    ], { app: "App built 2026-10-14 from abc1234.", state: "scene umn-twin-cities, inside the 360 image northrop-mall" });
    install();
    reportBrowserAppFailure(document, "The tour could not start.");
    install();
    reportBrowserAppFailure(document, "TypeError: boom at https://example.org/app/?key=private-key\n  with apiKey=private-key");
    const offer = document.querySelector(".foss-earth-browser-recovery-offer")!;
    expect([...offer.querySelectorAll("a")].map(link => link.textContent)).toEqual(["Download crash log", "Clear browser data"]);
    expect(offer.textContent).toContain("Download the crash log");
    expect(offer.textContent).not.toContain("private-key");
    const download = crashLogLink();
    expect(download.download).toMatch(/^foss-earth-crash-log-[\dT-]+Z\.txt$/);

    const log = await crashLogOf(download);
    expect(log).toMatch(/^Crash log of foss-earth, \S+Z\n/);
    expect(log).toMatch(/^Page: \S+\/app\/$/m);
    expect(log).toContain("Failed or stalled starts of this page in a row: 2");
    expect(log).toMatch(/^The last, at \S+Z: TypeError: boom at https:\/\/example\.org\/app\/\?key=… with apiKey=…$/m);
    expect(log).not.toContain("private-key");
    expect(log).toContain("Visit opened 2026-10-14T12:00:00.000Z, neither closed nor hidden: it stopped while shown, or is still open.");
    expect(log).toContain("  App: App built 2026-10-14 from abc1234.");
    expect(log).toContain("  It was at: scene umn-twin-cities, inside the 360 image northrop-mall");
    expect(log).toContain("    0.9 s  console.error: GPU device lost (3 times, the last at 1.4 s)");
    expect(log.indexOf("T12:00:00")).toBeLessThan(log.indexOf("Visit opened 2026-10-14T11:00:00.000Z, closed, reloaded or left."));
    expect(window.localStorage.getItem(`${TRAIL_KEY_PREFIX}newer`)).not.toBeNull();

    // Made again when chosen, with what the device kept since.
    keepTrail("newer", Date.UTC(2026, 9, 14, 12), [{ ms: 3000, text: "A later step" }]);
    download.addEventListener("click", event => event.preventDefault());
    download.click();
    expect(await crashLogOf(download)).toContain("A later step");
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:crash-log-1");
    expect(counts()).toEqual({ "foss-earth /app/": 2 });
  });

  it("forgets the last failure's message with its count", async () => {
    install();
    reportBrowserAppFailure(document, "TypeError: boom");
    expect(JSON.parse(window.localStorage.getItem(RECOVERY_KEY)!).last["foss-earth /app/"].message).toBe("TypeError: boom");
    markBrowserAppReady(document);
    expect(window.localStorage.getItem(RECOVERY_KEY)).toBeNull();
    install();
    reportBrowserAppFailure(document);
    install();
    reportBrowserAppFailure(document);
    const log = await crashLogOf(crashLogLink());
    expect(log).toContain(": The start failed and gave no reason.");
    expect(log).not.toContain("boom");
  });

  it("keeps a failure on one page from counting as another page", () => {
    install();
    reportBrowserAppFailure(document, "The tour could not start.");
    window.history.replaceState(null, "", "/tour/minneapolis/");
    install();
    reportBrowserAppFailure(document, "The tour could not start.");
    expect(counts()).toEqual({ "foss-earth /app/": 1, "foss-earth /tour/minneapolis/": 1 });
    expect(document.querySelector(".foss-earth-browser-recovery-offer")).toBeNull();
  });

  it("offers recovery immediately after two earlier failures", () => {
    window.localStorage.setItem(RECOVERY_KEY, JSON.stringify({ version: 1, failures: { "foss-earth /app/": 2 } }));
    install();
    expect(document.querySelector(".foss-earth-browser-recovery-offer")).not.toBeNull();
    markBrowserAppReady(document);
    expect(document.querySelector(".foss-earth-browser-recovery-offer")).toBeNull();
    expect(counts()).toEqual({});
  });

  it("records a failure in a cookie when web storage throws", () => {
    const denied = {
      get length() { return 0; },
      key() { throw new Error("denied"); },
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
      clear() { throw new Error("denied"); },
    } as Storage;
    replaceStorage("localStorage", denied);
    replaceStorage("sessionStorage", denied);
    install();
    reportBrowserAppFailure(document, "The application could not initialize.");
    expect(document.cookie).toContain(`${RECOVERY_KEY}=`);
    markBrowserAppReady(document);
    expect(document.cookie).not.toContain(`${RECOVERY_KEY}=`);
  });

  it("keeps the counts in a cookie when the messages would not fit", () => {
    const denied = {
      get length() { return 0; },
      key() { throw new Error("denied"); },
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
      clear() { throw new Error("denied"); },
    } as Storage;
    replaceStorage("localStorage", denied);
    replaceStorage("sessionStorage", denied);
    for (const page of ["one", "two", "three", "four", "five", "six"]) {
      window.history.replaceState(null, "", `/${page}/`);
      install();
      reportBrowserAppFailure(document, `${page} ${"é".repeat(300)}`);
    }
    const cookie = document.cookie.split("; ").find(item => item.startsWith(`${RECOVERY_KEY}=`))!;
    expect(cookie.length).toBeLessThan(4000);
    expect(Object.keys((JSON.parse(decodeURIComponent(cookie.slice(RECOVERY_KEY.length + 1))) as { failures: object }).failures)).toHaveLength(6);
    for (const page of ["one", "two", "three", "four", "five", "six"]) {
      window.history.replaceState(null, "", `/${page}/`);
      markBrowserAppReady(document);
    }
    expect(document.cookie).not.toContain(`${RECOVERY_KEY}=`);
  });

  it("shows the review without deleting until confirmed, and keeps API keys", async () => {
    window.history.replaceState(null, "", "/app/?resetBrowserData=1&scene=campus");
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      values: { "map.source.googleKey": SECRET, "map.source.cartoKey": "carto-secret", "interface.theme": "dark" },
    }));
    window.localStorage.setItem("foss-earth.theme", "dark");
    window.sessionStorage.setItem("visit", "1");
    const doubles = storageDoubles();
    const { timers, replace } = install();
    expect(timers.queued).toHaveLength(0);
    expect(isBrowserRecoveryPage(document)).toBe(true);
    expect(window.localStorage.getItem("foss-earth.theme")).toBe("dark");
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).toContain("Nothing is deleted until you choose");

    await confirmClear();
    expect(window.localStorage.getItem("foss-earth.theme")).toBeNull();
    expect(window.sessionStorage.getItem("visit")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({
      version: 1,
      values: { "map.source.googleKey": SECRET, "map.source.cartoKey": "carto-secret" },
    });
    expect(doubles.deletedDatabases).toEqual(["tiles", "files"]);
    expect(doubles.deletedCaches).toEqual(["app-files"]);
    expect(doubles.unregistered()).toBe(1);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).toContain("Kept the saved Google Maps and CARTO keys.");
    expect(document.body.textContent).toContain("Reloading…");
    expect(replace).not.toHaveBeenCalled();
    timers.fire();
    expect(replace).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0][0]).not.toContain("resetBrowserData");
    expect(replace.mock.calls[0][0]).not.toContain("scene=campus");
  });

  it("offers the crash log on the review, before the clear that deletes it", async () => {
    window.localStorage.setItem(RECOVERY_KEY, JSON.stringify({
      version: 1,
      failures: { "foss-earth /app/": 3 },
      last: { "foss-earth /app/": { at: Date.UTC(2026, 9, 14, 12), message: "The tour could not start." } },
    }));
    keepTrail("stopped", Date.UTC(2026, 9, 14, 12), [{ ms: 500, text: "Renderer webgpu (asked for auto)" }]);
    window.history.replaceState(null, "", "/app/?resetBrowserData=1");
    storageDoubles();
    install();
    const download = crashLogLink();
    const confirm = document.querySelector("button")!;
    expect(download.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).toContain("Clearing also deletes the crash log");
    const log = await crashLogOf(download);
    expect(log).toContain("Failed or stalled starts of this page in a row: 3");
    expect(log).toContain("The last, at 2026-10-14T12:00:00.000Z: The tour could not start.");
    expect(log).toContain("    0.5 s  Renderer webgpu (asked for auto)");

    await confirmClear();
    expect(window.localStorage.getItem(`${TRAIL_KEY_PREFIX}stopped`)).toBeNull();
    download.addEventListener("click", event => event.preventDefault());
    download.click();
    expect(await crashLogOf(download)).toContain("No visit's trail is kept on this device");
  });

  it("saves the crash log as a data address where the browser has no object URLs", () => {
    vi.mocked(window.URL.createObjectURL).mockImplementation(() => { throw new TypeError("unsupported"); });
    window.history.replaceState(null, "", "/app/?resetBrowserData=1");
    install();
    const href = crashLogLink().getAttribute("href") ?? "";
    expect(href.startsWith("data:text/plain;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(href)).toContain("Crash log of foss-earth");
  });

  it("removes saved API keys only when the review unchecks them", async () => {
    window.history.replaceState(null, "", "/app/?resetBrowserData=1");
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: { "map.source.googleKey": SECRET, "map.source.cartoKey": "   " } }));
    storageDoubles();
    const { timers, replace } = install();
    const checkbox = document.querySelector<HTMLInputElement>('input[name="keepApiKeys"]')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(window.location.search).toContain("keepApiKeys=0");
    await confirmClear();
    expect(window.localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(document.body.textContent).toContain("Saved Google Maps and CARTO keys were removed.");
    expect(document.body.textContent).not.toContain(SECRET);
    timers.fire();
    expect(replace).toHaveBeenCalledOnce();
  });

  it("stays on the review and reports a partial failure", async () => {
    window.history.replaceState(null, "", "/app/?resetBrowserData=1");
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, "{");
    window.localStorage.setItem("foss-earth.theme", "dark");
    storageDoubles();
    const stored = window.localStorage;
    replaceStorage("localStorage", new Proxy(stored, {
      get(target, prop, receiver) {
        if (prop === "clear") return () => { throw new Error("denied"); };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }));
    const { timers, replace } = install();
    await confirmClear();
    expect(window.localStorage.getItem("foss-earth.theme")).toBe("dark");
    expect(document.body.textContent).toContain("Saved API keys could not be read, so they were not kept.");
    expect(document.body.textContent).toContain("Local storage could not be cleared.");
    expect(document.body.textContent).not.toContain("Reloading");
    expect([...document.querySelectorAll("a")].map(link => link.textContent)).toContain("Reload");
    expect(timers.queued).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("reports caches and databases it cannot finish", async () => {
    window.history.replaceState(null, "", "/app/?resetBrowserData=1&keepApiKeys=0");
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: { keys: async () => ["app-files"], delete: async () => { throw new Error("denied"); } },
    });
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: { deleteDatabase() { throw new Error("unused"); } },
    });
    const { replace } = install();
    expect(document.querySelector<HTMLInputElement>('input[name="keepApiKeys"]')?.checked).toBe(false);
    await confirmClear();
    expect(document.body.textContent).toContain("Not every cache could be cleared.");
    expect(document.body.textContent).toContain("IndexedDB databases could not be listed, so they were left in place.");
    expect(replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(UNREACHABLE_SNIPPET);
  });

  it("does not count time spent on the review page", () => {
    window.history.replaceState(null, "", "/app/?resetBrowserData=1");
    const { timers } = install();
    expect(timers.queued).toHaveLength(0);
    reportBrowserAppFailure(document, "The tour could not start.");
    markBrowserAppReady(document);
    expect(counts()).toEqual({});
    expect(document.querySelector(".foss-earth-browser-recovery")).not.toBeNull();
  });
});

const UNREACHABLE_SNIPPET = "cookies hidden from JavaScript";

describe("inline recovery script", () => {
  it("runs from the HTML plugin without clearing data", () => {
    const tags = browserRecovery({ appId: "umn-vr-tour" }).transformIndexHtml();
    expect(tags[0]?.injectTo).toBe("head-prepend");
    expect(tags[0]?.attrs["data-foss-earth-browser-recovery"]).toBe("umn-vr-tour");
    expect(tags[0]?.children).not.toContain("<");
    const encoded = tags[0]?.children.match(/^eval\(JSON\.parse\(([\s\S]*)\)\)\n$/)?.[1];
    const source = JSON.parse(JSON.parse(encoded ?? "null") as string) as string;
    expect(source).toContain('installBrowserRecovery(document, {"appId":"umn-vr-tour"})');
    window.history.replaceState(null, "", "/tour/minneapolis/?resetBrowserData=1");
    window.localStorage.setItem("foss-earth.theme", "dark");
    new Function("document", tags[0]!.children)(document);
    expect(document.querySelector(".foss-earth-browser-recovery")?.textContent).toContain("Clear this site's browser data");
    expect(window.localStorage.getItem("foss-earth.theme")).toBe("dark");
    expect(document.querySelector("[data-foss-earth-browser-recovery]")).toBeNull();
    expect(() => browserRecovery({ appId: "Tour" })).toThrow(/appId/);
    expect(() => browserRecovery({ appId: "" })).toThrow(/appId/);
  });
});
