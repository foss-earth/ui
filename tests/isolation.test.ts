import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeIsolation, installIsolation, isolationStatus, whenIsolationSettled, type IsolationOptions } from "../src/browser/isolation.js";

const OPTIONS: IsolationOptions = { worker: "/app/foss-earth-sw.js", scope: "/app/", mode: "enforce" };
const ISOLATING = "https://host.test/app/foss-earth-sw.js?keep=1&isolate=1";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, String(value)); }
  removeItem(key: string) { this.items.delete(key); }
}

/** A page as the script sees it: its address, storage, service workers and frame. */
function page(fields: { href?: string; isolated?: boolean; controller?: string | null; secure?: boolean; workers?: boolean; framed?: boolean;
  session?: MemoryStorage | "throws"; local?: MemoryStorage; activates?: boolean; refuses?: Error; broadcast?: boolean } = {}) {
  const session = fields.session ?? new MemoryStorage(), local = fields.local ?? new MemoryStorage();
  const registered: { url: string; options: RegistrationOptions | undefined }[] = [];
  const reload = vi.fn(), unregister = vi.fn(async () => true);
  const shown: ((event: { persisted: boolean }) => void)[] = [];
  const channels: { name: string; posted: unknown[]; closed: boolean; onmessage: unknown }[] = [];
  class Channel {
    posted: unknown[] = []; closed = false; onmessage: unknown = null;
    constructor(readonly name: string) { channels.push(this); }
    postMessage(message: unknown) { this.posted.push(message); }
    close() { this.closed = true; }
  }
  const registration: { active: { scriptURL: string } | null; installing: { scriptURL: string; state: string } | null; waiting: null; unregister: typeof unregister } =
    { active: null, installing: null, waiting: null, unregister };
  const container = {
    controller: fields.controller ? { scriptURL: fields.controller } : null,
    register: vi.fn(async (url: string, options?: RegistrationOptions) => {
      if (fields.refuses) throw fields.refuses;
      registered.push({ url, options });
      registration.installing = { scriptURL: url, state: "installing" };
      // The worker activates a moment later, as skipWaiting makes it.
      if (fields.activates !== false) setTimeout(() => { registration.active = { scriptURL: url }; registration.installing = null; }, 120);
      return registration;
    }),
    getRegistration: vi.fn(async () => registration),
  };
  const view: Record<string, unknown> = {
    crossOriginIsolated: fields.isolated ?? false,
    isSecureContext: fields.secure ?? true,
    location: { href: fields.href ?? "https://host.test/app/", reload },
    navigator: { userAgent: "TestBrowser/1", ...(fields.workers === false ? {} : { serviceWorker: container }) },
    localStorage: local,
    get sessionStorage() { if (session === "throws") throw new Error("denied"); return session; },
    setTimeout: (work: () => void, ms: number) => setTimeout(work, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    addEventListener: (type: string, listener: (event: { persisted: boolean }) => void) => { if (type === "pageshow") shown.push(listener); },
    ...(fields.broadcast === false ? {} : { BroadcastChannel: Channel }),
  };
  view.top = fields.framed ? {} : view;
  const document = { defaultView: view } as unknown as Document;
  /** The browser shows the page: as it loads, or again from its back/forward cache. */
  const show = (persisted: boolean) => { for (const listener of shown) listener({ persisted }); };
  return { view: view as unknown as Window, document, container, registered, registration, reload, unregister, session, local, show, channels };
}

/** Whether `promise` has settled after the pending timers up to `ms` ran. */
async function settledAfter(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("the isolation script", () => {
  it("leaves an isolated page as it is, and clears this tab's flag so a later Shift-reload may try again", async () => {
    const p = page({ isolated: true, controller: ISOLATING });
    p.session.setItem("foss-earth.isolation.v1", "isolate");
    const status = installIsolation(p.document, OPTIONS)!;
    expect(status).toMatchObject({ state: "isolated", reason: null, wanted: true, reloaded: true, worker: ISOLATING, crossOriginIsolated: true });
    expect(p.session.items.has("foss-earth.isolation.v1")).toBe(false);
    expect(p.container.register).not.toHaveBeenCalled();
    expect(await settledAfter(status.ready, 0)).toBe(true);
    expect(isolationStatus(p.view)).toBe(status);
  });

  it("on a first visit registers the isolating worker, holds the app and reloads once when that worker is active", async () => {
    const p = page();
    const status = installIsolation(p.document, OPTIONS)!;
    expect(status.state).toBe("pending");
    expect(p.session.getItem("foss-earth.isolation.v1")).toBe("isolate");
    const started = whenIsolationSettled(p.view);
    expect(await settledAfter(started, 100)).toBe(false);
    expect(p.registered).toEqual([{ url: ISOLATING, options: { scope: "/app/", updateViaCache: "none" } }]);
    expect(p.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(p.reload).toHaveBeenCalledOnce();
    expect(status.reason).toContain("Reloading once");
    // The page reloads; until then the app does not start.
    expect(await settledAfter(started, 5000)).toBe(false);
  });

  it("does not reload again in a tab whose reload did not isolate, and remembers a browser whose worker answered", async () => {
    const local = new MemoryStorage();
    const p = page({ controller: ISOLATING, local });
    p.session.setItem("foss-earth.isolation.v1", "isolate");
    const status = installIsolation(p.document, OPTIONS)!;
    expect(status.state).toBe("unavailable");
    expect(status.reason).toContain("although the app's worker answered it");
    expect(p.session.getItem("foss-earth.isolation.v1")).toBe("isolate");
    expect(p.container.register).not.toHaveBeenCalled();
    expect(await settledAfter(status.ready, 0)).toBe(true);
    // Another tab of the same browser is not reloaded for nothing.
    const other = page({ local });
    const again = installIsolation(other.document, OPTIONS)!;
    expect(again.state).toBe("unavailable");
    expect(again.reason).toContain("asked again after a week");
    expect(other.container.register).not.toHaveBeenCalled();
    // A week later, or another browser version, it tries again.
    vi.setSystemTime(Date.now() + 8 * 24 * 3600 * 1000);
    expect(installIsolation(page({ local }).document, OPTIONS)!.state).toBe("pending");
  });

  it("tries again after a Shift-reload skipped the worker of an isolated tab, and says so when its reload skipped it too", () => {
    // The isolated load cleared the flag; a Shift-reload is answered by the network, with no controller.
    const p = page({ controller: null });
    expect(installIsolation(p.document, OPTIONS)!.state).toBe("pending");
    // Chrome sends the script's reload after a Shift-reload past the worker as well.
    const after = page({ controller: null, session: p.session });
    expect(installIsolation(after.document, OPTIONS)!.reason).toBe("A reload did not isolate the page: the app's worker did not answer it, as after a Shift-reload; this tab does not try again.");
    expect(after.container.register).not.toHaveBeenCalled();
  });

  it("starts at once where nothing can isolate: an insecure page, no service worker, a frame, the recovery page, unusable storage", async () => {
    for (const [fields, words] of [
      // Over http from a network address, as a phone opening a development server.
      [{ secure: false, href: "http://192.168.0.103:5374/app/" }, "secure page (HTTPS or localhost)"],
      [{ workers: false }, "no service worker"],
      [{ framed: true }, "inside a frame"],
      [{ href: "https://host.test/app/?resetBrowserData=1" }, "review page"],
      [{ session: "throws" as const }, "once-only flag"],
    ] as const) {
      const p = page(fields);
      const status = installIsolation(p.document, OPTIONS)!;
      expect(status.state, words).toBe("unavailable");
      expect(status.reason).toContain(words);
      expect(p.container.register).not.toHaveBeenCalled();
      expect(await settledAfter(whenIsolationSettled(p.view), 0)).toBe(true);
      expect(p.reload).not.toHaveBeenCalled();
    }
  });

  it("starts without isolation, and never reloads later, when the worker does not take over in time", async () => {
    const p = page({ activates: false });
    const status = installIsolation(p.document, { ...OPTIONS, waitMs: 1000 })!;
    expect(await settledAfter(status.ready, 999)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toMatchObject({ state: "unavailable", reason: "The app's worker did not take over within 1 s." });
    p.registration.active = { scriptURL: ISOLATING }; p.registration.installing = null;
    await vi.advanceTimersByTimeAsync(5000);
    expect(p.reload).not.toHaveBeenCalled();
  });

  it("starts without isolation when the worker cannot be registered, as in a private window", async () => {
    const p = page({ refuses: new Error("The operation is insecure.") });
    const status = installIsolation(p.document, OPTIONS)!;
    expect(await settledAfter(status.ready, 0)).toBe(true);
    expect(status.reason).toBe("The app's worker could not be registered: The operation is insecure.");
    expect(p.reload).not.toHaveBeenCalled();
  });

  it("follows the setting from the address, then this device, and ends an isolation that is no longer wanted", async () => {
    const off = page({ href: "https://host.test/app/?set.app.isolation=off" });
    expect(installIsolation(off.document, OPTIONS)!).toMatchObject({ state: "off", wanted: false, worker: "https://host.test/app/foss-earth-sw.js?keep=1&isolate=0" });
    expect(off.container.register).not.toHaveBeenCalled();

    const local = new MemoryStorage();
    local.setItem("foss-earth.settings.v1", JSON.stringify({ version: 1, values: { "app.isolation": false } }));
    const isolated = page({ isolated: true, local });
    const status = installIsolation(isolated.document, OPTIONS)!;
    expect(status.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(200);
    expect(isolated.registered.map(each => each.url)).toEqual(["https://host.test/app/foss-earth-sw.js?keep=1&isolate=0"]);
    expect(isolated.reload).toHaveBeenCalledOnce();

    // Neither keeping nor isolating: the worker goes instead.
    const neither = page({ isolated: true, href: "https://host.test/app/?set.app.isolation=0&set.app.keepFiles=no" });
    neither.registration.active = { scriptURL: ISOLATING };
    installIsolation(neither.document, OPTIONS);
    await vi.advanceTimersByTimeAsync(0);
    expect(neither.unregister).toHaveBeenCalledOnce();
    expect(neither.container.register).not.toHaveBeenCalled();
    expect(neither.reload).toHaveBeenCalledOnce();
  });

  it("asks a worker that keeps nothing in an app that keeps no files, and removes it when isolation goes too", async () => {
    const p = page();
    expect(installIsolation(p.document, { ...OPTIONS, keep: false })!.worker).toBe("https://host.test/app/foss-earth-sw.js?keep=0&isolate=1");
    const off = page({ isolated: true, href: "https://host.test/app/?set.app.isolation=off" });
    off.registration.active = { scriptURL: "https://host.test/app/foss-earth-sw.js?keep=0&isolate=1" };
    installIsolation(off.document, { ...OPTIONS, keep: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(off.unregister).toHaveBeenCalledOnce();
    expect(off.reload).toHaveBeenCalledOnce();
  });

  it("asks nothing of a release whose worker only reports", () => {
    const p = page();
    expect(installIsolation(p.document, { ...OPTIONS, mode: "report-only" })!.state).toBe("report-only");
    expect(p.container.register).not.toHaveBeenCalled();
  });

  it("releases the app if the browser does not make the reload it asked for", async () => {
    const p = page();
    const status = installIsolation(p.document, OPTIONS)!;
    await vi.advanceTimersByTimeAsync(200);
    expect(p.reload).toHaveBeenCalledOnce();
    expect(await settledAfter(status.ready, 10_000)).toBe(true);
    expect(status.reason).toBe("The page did not reload.");
  });

  it("asks again, once, when a later reload brings this page back from the back/forward cache", async () => {
    const p = page();
    const status = installIsolation(p.document, OPTIONS)!;
    await vi.advanceTimersByTimeAsync(200);
    expect(p.reload).toHaveBeenCalledOnce();
    // The reload isolated the next load, which cleared the flag; a later reload showed this page again instead.
    await vi.advanceTimersByTimeAsync(5000);
    p.session.removeItem("foss-earth.isolation.v1");
    p.show(false);
    expect(p.reload).toHaveBeenCalledOnce();
    // It asks after the restore has finished: Chrome drops a reload asked while it shows the page.
    p.show(true);
    expect(p.reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.reload).toHaveBeenCalledTimes(2);
    expect(p.session.getItem("foss-earth.isolation.v1")).toBe("isolate");
    // Its wait for the reload starts again.
    expect(await settledAfter(status.ready, 9000)).toBe(false);
    // Shown again, it does not ask a third time: the app starts.
    p.show(true);
    expect(p.reload).toHaveBeenCalledTimes(2);
    expect(await settledAfter(status.ready, 0)).toBe(true);
    expect(status.reason).toBe("The browser showed this page again from its back/forward cache instead of reloading it.");
  });

  it("releases the app if the browser does not make the second reload either", async () => {
    const p = page();
    const status = installIsolation(p.document, OPTIONS)!;
    await vi.advanceTimersByTimeAsync(200);
    p.show(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.reload).toHaveBeenCalledTimes(2);
    expect(await settledAfter(status.ready, 10_000)).toBe(true);
    expect(status.reason).toBe("The page did not reload.");
  });

  it("tells the app's other pages that it loaded, and listens only while it waits for its reload", async () => {
    // A listener is what gets a page that waits evicted from Chrome's back/forward cache when the next load says so.
    const isolated = page({ isolated: true, controller: ISOLATING });
    installIsolation(isolated.document, OPTIONS);
    expect(isolated.channels).toMatchObject([{ name: "foss-earth.isolation", posted: ["loaded"], closed: true }]);
    const p = page();
    const status = installIsolation(p.document, OPTIONS)!;
    expect(p.channels).toMatchObject([{ name: "foss-earth.isolation", posted: ["loaded"], closed: false }]);
    expect(p.channels[0]!.onmessage).toBeTypeOf("function");
    // The reload does not come; the app starts, and the page stops listening.
    await vi.advanceTimersByTimeAsync(200 + 10_000);
    expect(status.state).toBe("unavailable");
    expect(p.channels[0]!.closed).toBe(true);
    // A browser without BroadcastChannel still isolates the page.
    expect(installIsolation(page({ broadcast: false }).document, OPTIONS)!.state).toBe("pending");
  });

  it("leaves a page whose app started as it is when the browser shows it again", async () => {
    const p = page({ activates: false });
    const status = installIsolation(p.document, { ...OPTIONS, waitMs: 1000 })!;
    await vi.advanceTimersByTimeAsync(1000);
    expect(status.state).toBe("unavailable");
    p.show(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.reload).not.toHaveBeenCalled();
    expect(status.reason).toBe("The app's worker did not take over within 1 s.");
  });
});

describe("the isolation report", () => {
  it("says what the script found, or that a page has no script, as a development build", () => {
    const p = page({ isolated: true, controller: ISOLATING });
    expect(describeIsolation(p.view)).toContain("no isolation script");
    expect(whenIsolationSettled(p.view)).toBeInstanceOf(Promise);
    installIsolation(p.document, OPTIONS);
    expect(describeIsolation(p.view)).toBe(`isolated (crossOriginIsolated true, enforce, setting on); worker ${ISOLATING}`);
  });
});
