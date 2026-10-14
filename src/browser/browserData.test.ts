// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_STORAGE_KEY } from "../settings/registry.js";
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
    expect(offer?.querySelector("a")?.getAttribute("href")).toContain("resetBrowserData=1");
    expect(window.localStorage.getItem("foss-earth.theme")).toBe("dark");

    markBrowserAppReady(document);
    expect(window.localStorage.getItem(RECOVERY_KEY)).toBeNull();
    expect(document.querySelector(".foss-earth-browser-recovery-offer")).toBeNull();
    expect(second.timers.queued).toHaveLength(0);
  });

  it("counts a stall only when the start never becomes ready", () => {
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
