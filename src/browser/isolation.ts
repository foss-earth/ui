/**
 * Cross-origin isolation from the app's service worker
 * (docs/docs/proposals/webassembly.md, step 3), which a threaded WebAssembly
 * core needs before the browser lets it share memory with workers. Static
 * hosts such as GitHub Pages cannot send the headers; the app's worker adds
 * them, and only to pages it answers. So a first visit, which no worker
 * answered, reloads once after the worker takes over.
 *
 * This file stays free of imports. The appFiles Vite plugin inlines it at the
 * start of each page of a build whose worker may isolate, so it runs before
 * the app's modules, which wait for `whenIsolationSettled`.
 * `foss-earth.settings.v1` and `set.` are the settings registry's
 * `SETTINGS_STORAGE_KEY` and `URL_PARAMETER_PREFIX`, `resetBrowserData` is
 * browser recovery's page, and `__fossEarthBoot` the boot terminal's.
 */

const SETTINGS_STORAGE_KEY = "foss-earth.settings.v1";
const URL_PARAMETER_PREFIX = "set.";
const RECOVERY_QUERY = "resetBrowserData";
const BOOT_TERMINAL_GLOBAL = "__fossEarthBoot";
const HOOK = "__fossEarthIsolation";
/** This tab's last reload to change isolation: "isolate" or "release". Cleared by a load that got what it asked. */
const ATTEMPT_KEY = "foss-earth.isolation.v1";
/** The browser, by user agent, that a worker answered and that still did not isolate: it is not asked again for a week. */
const REFUSED_KEY = "foss-earth.isolation-refused.v1";
const REFUSED_FOR_MS = 7 * 24 * 3600 * 1000;
const WAIT_MS = 4000;
/** After asking for the reload: a reload the browser does not make releases the app after this. */
const RELOAD_WAIT_MS = 10_000;
/** The app's own bound on the wait, should this script fail to settle; below browser recovery's 45 s stall. */
const START_CAP_MS = 20_000;
const POLL_MS = 50;
/**
 * Each load tells the app's other pages in this browser that it loaded; a page
 * waiting for its reload listens. Chrome can keep that page in its
 * back/forward cache although it reloaded, and show it again for a later
 * reload of the page that replaced it; a message evicts it from that cache.
 */
const LOADED_CHANNEL = "foss-earth.isolation";

export const ISOLATION_SETTING = "app.isolation";
export const KEEP_FILES_SETTING = "app.keepFiles";

/** What a build's worker may do: send the isolating headers, or only their report-only forms. */
export type IsolationMode = "report-only" | "enforce";
export type IsolationState = "isolated" | "pending" | "unavailable" | "off" | "report-only";

export interface IsolationOptions {
  /** The worker's file as a path from the site's root, without its policy, as "/app/foss-earth-sw.js". */
  worker: string;
  /** What the worker controls, as "/app/". */
  scope: string;
  mode: IsolationMode;
  /** False where the app keeps no files on the device, as 0SFS: the worker only isolates. Default true, as Settings → App files says. */
  keep?: boolean;
  /** How long the page waits for the worker before it starts without isolation. Default 4 s. */
  waitMs?: number;
}

export interface IsolationStatus {
  state: IsolationState;
  /** Why the page is not isolated, or what it is doing; null when isolated as asked. */
  reason: string | null;
  mode: IsolationMode;
  /** Settings → App files → Cross-origin isolation, from the address or this device. */
  wanted: boolean;
  /** The worker's address this page asks for, with its policy. */
  worker: string;
  crossOriginIsolated: boolean;
  /** This load follows this tab's reload to change isolation. */
  reloaded: boolean;
  /** Settles when the app may start: at once, after a bounded wait, or never, as the page reloads. */
  ready: Promise<void>;
}

/** The worker's address for a policy. The worker reads it from its own location. */
export function isolationWorkerAddress(worker: string, keep: boolean, isolate: boolean): string {
  return `${worker}?keep=${keep ? 1 : 0}&isolate=${isolate ? 1 : 0}`;
}

/** A boolean setting as the registry resolves it: `?set.<id>=`, then this device's saved value, then the default. */
function savedSwitch(view: Window, id: string, fallback: boolean): boolean {
  try {
    const raw = new URL(view.location.href).searchParams.get(URL_PARAMETER_PREFIX + id)?.toLowerCase();
    if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
    if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  } catch {
    // An unreadable address sets nothing.
  }
  try {
    const record = JSON.parse(view.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null");
    const value = record?.version === 1 ? record.values?.[id] : undefined;
    if (typeof value === "boolean") return value;
  } catch {
    // Unreadable storage keeps the default, as the registry does.
  }
  return fallback;
}

function framed(view: Window): boolean {
  try {
    return view.top !== view;
  } catch {
    return true;
  }
}

function bootStep(view: Window, text: string): void {
  try {
    (view as unknown as Record<string, { step?(id: string, text: string): void } | undefined>)[BOOT_TERMINAL_GLOBAL]?.step?.("isolation", text);
  } catch {
    // The terminal is a courtesy.
  }
}

function refused(view: Window): boolean {
  try {
    const record = JSON.parse(view.localStorage.getItem(REFUSED_KEY) ?? "null");
    return record?.userAgent === view.navigator.userAgent && typeof record.at === "number" && Date.now() - record.at < REFUSED_FOR_MS;
  } catch {
    return false;
  }
}

function remember(view: Window, key: string, value: string | null, storage: "localStorage" | "sessionStorage"): void {
  try {
    if (value === null) view[storage].removeItem(key);
    else view[storage].setItem(key, value);
  } catch {
    // What could not be remembered is asked again.
  }
}

const sleep = (view: Window, ms: number): Promise<void> => new Promise(resolve => { view.setTimeout(resolve, ms); });

/**
 * Registers the worker at `address` (or, when it should neither keep nor
 * isolate, removes it) and waits for that worker to be active, so a reload is
 * answered by it. Resolves with why it cannot, or null.
 */
async function change(view: Window, container: ServiceWorkerContainer, options: IsolationOptions, address: string, remove: boolean, waitMs: number): Promise<string | null> {
  const ours = (url: string | undefined): boolean => {
    try {
      return Boolean(url) && new URL(url!).pathname === new URL(address).pathname && new URL(url!).origin === new URL(address).origin;
    } catch {
      return false;
    }
  };
  if (remove) {
    const registration = await container.getRegistration(options.scope);
    const script = registration?.active ?? registration?.waiting ?? registration?.installing;
    if (registration && ours(script?.scriptURL)) await registration.unregister();
    return null;
  }
  const registration = await container.register(address, { scope: options.scope, updateViaCache: "none" });
  const deadline = Date.now() + waitMs;
  // Polled rather than followed by events: an update found before this ran sends none.
  while (Date.now() < deadline) {
    const pending = registration.installing ?? registration.waiting;
    if (registration.active?.scriptURL === address && (!pending || pending.scriptURL !== address)) return null;
    if (pending?.state === "redundant") return "The app's worker failed to install.";
    await sleep(view, POLL_MS);
  }
  return `The app's worker did not take over within ${Math.round(waitMs / 1000)} s.`;
}

/**
 * Runs first in each page: says whether the page is isolated as Settings →
 * App files asks, and when it is not, and a reload can change that, makes the
 * worker answer and reloads this tab once. Everything that cannot isolate —
 * a page that is not secure, no service workers, a frame, the recovery page, storage that cannot hold
 * the once-only flag, a reload that did not isolate — starts the app without
 * isolation and says why.
 */
export function installIsolation(document: Document, options: IsolationOptions): IsolationStatus | null {
  const view = document.defaultView;
  if (!view) return null;
  const isolated = view.crossOriginIsolated === true;
  const wanted = savedSwitch(view, ISOLATION_SETTING, true);
  const keep = options.keep !== false && savedSwitch(view, KEEP_FILES_SETTING, true);
  let worker = isolationWorkerAddress(options.worker, keep, wanted);
  try { worker = new URL(worker, view.location.href).href; } catch { /* kept as given */ }
  let attempt: string | null = null;
  let sessionReadable = true;
  try { attempt = view.sessionStorage.getItem(ATTEMPT_KEY); } catch { sessionReadable = false; }
  const status: IsolationStatus = { state: "off", reason: null, mode: options.mode, wanted, worker, crossOriginIsolated: isolated, reloaded: attempt !== null, ready: Promise.resolve() };
  (view as unknown as Record<string, unknown>)[HOOK] = status;
  let channel: BroadcastChannel | null = null;
  try { channel = new view.BroadcastChannel(LOADED_CHANNEL); channel.postMessage("loaded"); } catch { channel = null; }
  const settle = (state: IsolationState, reason: string | null): IsolationStatus => {
    status.state = state; status.reason = reason;
    if (state !== "pending") { channel?.close(); channel = null; }
    return status;
  };

  if (options.mode === "report-only") {
    return settle("report-only", wanted ? "This release's worker only reports what isolation would block." : "Off in Settings → App files.");
  }
  if (isolated === wanted) {
    remember(view, ATTEMPT_KEY, null, "sessionStorage");
    return wanted ? settle("isolated", null) : settle("off", "Off in Settings → App files.");
  }
  // From here a reload could change the page: to isolate it, or to end its isolation.
  const direction = wanted ? "isolate" : "release";
  let recovery = false;
  try { recovery = new URL(view.location.href).searchParams.get(RECOVERY_QUERY) === "1"; } catch { /* no address, no recovery page */ }
  if (recovery) return settle("unavailable", "The browser-data review page is not isolated.");
  if (framed(view)) return settle("unavailable", wanted ? "The page is inside a frame, which only an isolated page that allows it can isolate." : "The page is inside a frame.");
  // As over http from a network address: the browser isolates no such page, whatever its worker or server sends.
  if (!view.isSecureContext) return settle("unavailable", "Only a secure page (HTTPS or localhost) can be isolated, and this one is not: open it over HTTPS.");
  const container = "serviceWorker" in view.navigator ? view.navigator.serviceWorker : null;
  if (!container) return settle("unavailable", "This browser gives this page no service worker, which a private window can turn off; without one nothing can isolate it.");
  const controlled = (): boolean => container.controller?.scriptURL === worker;
  if (attempt === direction) {
    // The worker answered this load and it is still not isolated: this browser does not isolate a page from its worker.
    if (wanted && controlled()) remember(view, REFUSED_KEY, JSON.stringify({ userAgent: view.navigator.userAgent, at: Date.now() }), "localStorage");
    return settle("unavailable", wanted ? `A reload did not isolate the page${controlled() ? " although the app's worker answered it" : ": the app's worker did not answer it, as after a Shift-reload"}; this tab does not try again.` : "A reload did not end the page's isolation; this tab does not try again.");
  }
  if (wanted && refused(view)) return settle("unavailable", "This browser did not isolate the page when the app's worker answered it; it is asked again after a week, or a browser update.");
  if (!sessionReadable) return settle("unavailable", "Browser storage could not hold the reload's once-only flag, so the page does not reload to isolate itself.");
  try {
    view.sessionStorage.setItem(ATTEMPT_KEY, direction);
  } catch {
    return settle("unavailable", "Browser storage could not hold the reload's once-only flag, so the page does not reload to isolate itself.");
  }
  settle("pending", wanted ? "Waiting for the app's worker, then reloading once to isolate the page." : "Waiting for the app's worker, then reloading once to end the page's isolation.");
  if (channel) channel.onmessage = () => { /* Heard only to be evicted; see LOADED_CHANNEL. */ };
  status.ready = new Promise<void>(resolve => {
    const waitMs = typeof options.waitMs === "number" && options.waitMs >= 0 ? options.waitMs : WAIT_MS;
    // Once the app may start, this page never reloads by itself.
    let released = false, reloads = 0;
    let reloadTimer: number | undefined;
    const release = (reason: string): void => { if (released) return; released = true; view.clearTimeout(timer); view.clearTimeout(reloadTimer); settle("unavailable", reason); resolve(); };
    const timer = view.setTimeout(() => release(`The app's worker did not take over within ${Math.round(waitMs / 1000)} s.`), waitMs);
    const reload = (): void => {
      reloads += 1;
      view.clearTimeout(reloadTimer);
      reloadTimer = view.setTimeout(() => release("The page did not reload."), RELOAD_WAIT_MS);
      view.location.reload();
    };
    // Chrome can answer a later reload with this page from its back/forward
    // cache: still not isolated, and frozen just after it asked for its reload.
    // It asks again, once.
    view.addEventListener("pageshow", event => {
      if (!event.persisted || released || reloads === 0) return;
      if (reloads > 1) { release("The browser showed this page again from its back/forward cache instead of reloading it."); return; }
      remember(view, ATTEMPT_KEY, direction, "sessionStorage");
      console.info("Reloading again: the browser showed this page from its back/forward cache instead of reloading it. (Settings → App files → Cross-origin isolation)");
      view.setTimeout(reload, 0);
    });
    change(view, container, options, worker, !wanted && !keep, waitMs).then(failure => {
      if (released) return;
      if (failure) { release(failure); return; }
      view.clearTimeout(timer);
      status.reason = wanted ? "Reloading once, so the app's worker isolates the page." : "Reloading once to end the page's isolation.";
      bootStep(view, wanted ? "Reloading once, so the app's worker can isolate the page for shared memory" : "Reloading once to end the page's isolation");
      console.info(`${status.reason} (Settings → App files → Cross-origin isolation)`);
      reload();
    }, (error: unknown) => release(`The app's worker could not be registered: ${error instanceof Error ? error.message : String(error)}`));
  });
  return status;
}

/** The page's isolation as its first script found it, or null on a page without that script, as a development build. */
export function isolationStatus(view: Window): IsolationStatus | null {
  const status = (view as unknown as Record<string, unknown>)[HOOK];
  return status && typeof status === "object" ? status as IsolationStatus : null;
}

/** Settles when the app may start: at once without the script, otherwise when its wait ends, and after `capMs` however it ends. */
export function whenIsolationSettled(view: Window, capMs = START_CAP_MS): Promise<void> {
  const ready = isolationStatus(view)?.ready;
  if (!ready) return Promise.resolve();
  return Promise.race([ready, new Promise<void>(resolve => { view.setTimeout(resolve, capMs); })]);
}

/** One line for a report: whether the page is isolated, and why not. */
export function describeIsolation(view: Window): string {
  const status = isolationStatus(view);
  const isolated = view.crossOriginIsolated === true;
  if (!status) return `${isolated ? "isolated" : "not isolated"} (crossOriginIsolated ${isolated}); no isolation script in this page, as in a development build, where the server's headers decide.`;
  const parts = [`${status.state} (crossOriginIsolated ${isolated}, ${status.mode}, setting ${status.wanted ? "on" : "off"}${status.reloaded ? ", after one reload" : ""})`];
  if (status.reason) parts.push(status.reason);
  parts.push(`worker ${status.worker}`);
  return parts.join("; ");
}
