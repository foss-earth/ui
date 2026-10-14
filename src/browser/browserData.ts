/**
 * Browser-data review and the early recovery page.
 *
 * This file stays free of imports. The Vite plugin inlines it into each HTML
 * page, so the review can run when the application bundle never loads.
 * `foss-earth.settings.v1` is `SETTINGS_STORAGE_KEY` in the settings registry.
 */

const SETTINGS_STORAGE_KEY = "foss-earth.settings.v1";
const RECOVERY_STORAGE_KEY = "foss-earth.browser-recovery.v1";
const RECOVERY_QUERY = "resetBrowserData";
const KEEP_QUERY = "keepApiKeys";
const HOOK = "__fossEarthBrowserRecovery";
const FAILURE_LIMIT = 2;
const STALL_MS = 45_000;
const STYLE_ID = "foss-earth-browser-recovery-style";
const API_KEYS = [
  { id: "map.source.googleKey", label: "Google Maps" },
  { id: "map.source.cartoKey", label: "CARTO" },
] as const;
const UNREACHABLE = "The browser's HTTP cache and cookies hidden from JavaScript cannot be cleared from a page. Use the browser's site settings for those. Files already downloaded onto the device stay.";

export interface BrowserDataPanel {
  element: HTMLElement;
  destroy(): void;
}

export interface BrowserRecoveryInstallOptions {
  appId: string;
  /** How long a start may run before it counts as stalled. Default 45 seconds. */
  stallMs?: number;
  /** Failed or stalled starts of one page before the review is offered. Default 2. */
  failureLimit?: number;
  schedule?: (work: () => void, delayMs: number) => number;
  cancel?: (id: number) => void;
  /** Navigation after a finished review. The page uses `location.replace`. */
  replace?: (url: string) => void;
}

interface RecoveryHook {
  ready(): void;
  failed(message: string): void;
}

interface FailureMap {
  [key: string]: number;
}

interface KeptKeys {
  values: Record<string, string>;
  names: string[];
  unreadable: boolean;
}

interface ClearReport {
  cleared: string[];
  failures: string[];
  notes: string[];
}

let installGeneration = 0;
let stopActive: (() => void) | null = null;

function validAppId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

function sentence(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function pathnameOf(view: Window): string {
  try {
    const path = view.location.pathname;
    return typeof path === "string" && path.startsWith("/") ? path.slice(0, 512) : "/";
  } catch {
    return "/";
  }
}

function recoveryHref(href: string, keepKeys: boolean): string | null {
  try {
    const url = new URL(href);
    url.search = "";
    url.hash = "";
    url.searchParams.set(RECOVERY_QUERY, "1");
    if (!keepKeys) url.searchParams.set(KEEP_QUERY, "0");
    return url.href;
  } catch {
    return null;
  }
}

function appHref(href: string): string | null {
  try {
    const url = new URL(href);
    url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

export function isBrowserRecoveryPage(document: Document): boolean {
  const href = document.defaultView?.location.href;
  if (!href) return false;
  try {
    return new URL(href).searchParams.get(RECOVERY_QUERY) === "1";
  } catch {
    return false;
  }
}

function keepKeysFrom(href: string): boolean {
  try {
    return new URL(href).searchParams.get(KEEP_QUERY) !== "0";
  } catch {
    return true;
  }
}

function hookOf(document: Document): RecoveryHook | null {
  const view = document.defaultView;
  if (!view) return null;
  const hook = (view as unknown as Record<string, unknown>)[HOOK];
  if (!hook || typeof hook !== "object") return null;
  const candidate = hook as Partial<RecoveryHook>;
  if (typeof candidate.ready !== "function" || typeof candidate.failed !== "function") return null;
  return candidate as RecoveryHook;
}

function appIdFrom(document: Document): string | null {
  const id = document.querySelector("[data-foss-earth-browser-recovery]")?.getAttribute("data-foss-earth-browser-recovery") ?? "";
  return validAppId(id) ? id : null;
}

function storageOf(view: Window, name: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return view[name] ?? null;
  } catch {
    return null;
  }
}

function readCookie(document: Document, name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const item = part.trim();
    if (!item.startsWith(`${name}=`)) continue;
    try {
      return decodeURIComponent(item.slice(name.length + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function writeCookie(document: Document, name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=604800; SameSite=Lax`;
}

function expireCookie(document: Document, name: string): void {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function parseRecord(raw: string | null): FailureMap {
  const map: FailureMap = Object.create(null) as FailureMap;
  if (!raw) return map;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return map;
    const failures = (parsed as { version?: unknown; failures?: unknown }).failures;
    if ((parsed as { version?: unknown }).version !== 1 || !failures || typeof failures !== "object") return map;
    for (const [key, value] of Object.entries(failures)) {
      if (key.length > 600 || key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 100) map[key] = value;
    }
  } catch {
    return Object.create(null) as FailureMap;
  }
  return map;
}

function readRaw(view: Window, document: Document): string | null {
  const local = storageOf(view, "localStorage");
  if (local) {
    try {
      return local.getItem(RECOVERY_STORAGE_KEY);
    } catch {
      // A locked local store falls through to session storage, then a cookie.
    }
  }
  const session = storageOf(view, "sessionStorage");
  if (session) {
    try {
      const value = session.getItem(RECOVERY_STORAGE_KEY);
      if (value !== null) return value;
    } catch {
      // Session storage can be forbidden while a cookie still works.
    }
  }
  return readCookie(document, RECOVERY_STORAGE_KEY);
}

function persist(view: Window, document: Document, raw: string | null): void {
  const local = storageOf(view, "localStorage");
  if (local) {
    try {
      if (raw === null) local.removeItem(RECOVERY_STORAGE_KEY);
      else local.setItem(RECOVERY_STORAGE_KEY, raw);
      expireCookie(document, RECOVERY_STORAGE_KEY);
      try {
        storageOf(view, "sessionStorage")?.removeItem(RECOVERY_STORAGE_KEY);
      } catch {
        // The local record is the one later reads use.
      }
      return;
    } catch {
      // Try the next store.
    }
  }
  const session = storageOf(view, "sessionStorage");
  if (session) {
    try {
      if (raw === null) session.removeItem(RECOVERY_STORAGE_KEY);
      else session.setItem(RECOVERY_STORAGE_KEY, raw);
      expireCookie(document, RECOVERY_STORAGE_KEY);
      return;
    } catch {
      // The cookie is the last place a failure count can survive a reload.
    }
  }
  if (raw === null) expireCookie(document, RECOVERY_STORAGE_KEY);
  else writeCookie(document, RECOVERY_STORAGE_KEY, raw);
}

function failureKey(appId: string, pathname: string): string {
  return `${appId} ${pathname}`;
}

function readCount(view: Window, document: Document, appId: string): number {
  try {
    return parseRecord(readRaw(view, document))[failureKey(appId, pathnameOf(view))] ?? 0;
  } catch {
    return 0;
  }
}

function writeCount(view: Window, document: Document, appId: string, count: number): void {
  try {
    const map = parseRecord(readRaw(view, document));
    const key = failureKey(appId, pathnameOf(view));
    if (count <= 0) delete map[key];
    else map[key] = Math.min(99, count);
    persist(view, document, Object.keys(map).length === 0 ? null : JSON.stringify({ version: 1, failures: map }));
  } catch {
    // Counting is best-effort. A start is never blocked on it.
  }
}

function readKeptKeys(storage: Storage): KeptKeys {
  const empty = { values: {}, names: [], unreadable: false };
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...empty, unreadable: true };
    const values = (parsed as { values?: unknown }).values;
    if (!values || typeof values !== "object") return { ...empty, unreadable: true };
    const kept: Record<string, string> = {};
    const names: string[] = [];
    for (const key of API_KEYS) {
      const value = (values as Record<string, unknown>)[key.id];
      if (typeof value !== "string" || !value.trim()) continue;
      kept[key.id] = value;
      names.push(key.label);
    }
    return { values: kept, names, unreadable: false };
  } catch {
    return { values: {}, names: [], unreadable: true };
  }
}

function settleRequest(view: Window, request: IDBOpenDBRequest): Promise<"ok" | "blocked" | "error"> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: "ok" | "blocked" | "error"): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = view.setTimeout(() => finish("error"), 8000);
    const done = (result: "ok" | "blocked" | "error"): void => {
      view.clearTimeout(timer);
      finish(result);
    };
    request.onsuccess = () => done("ok");
    request.onerror = () => done("error");
    request.onblocked = () => done("blocked");
  });
}

async function clearCaches(view: Window, report: ClearReport): Promise<void> {
  let caches: CacheStorage | null = null;
  try {
    caches = view.caches;
  } catch {
    caches = null;
  }
  if (!caches || typeof caches.keys !== "function" || typeof caches.delete !== "function") {
    report.notes.push("Cache storage is not available in this browser.");
    return;
  }
  let names: string[];
  try {
    names = await caches.keys();
  } catch {
    report.failures.push("Cache storage could not be listed, so cached files may remain.");
    return;
  }
  let failed = false;
  for (const name of names.slice(0, 200)) {
    try {
      if (!await caches.delete(name)) failed = true;
    } catch {
      failed = true;
    }
  }
  if (failed || names.length > 200) report.failures.push("Not every cache could be cleared.");
  else report.cleared.push("cache storage");
}

async function clearDatabases(view: Window, report: ClearReport): Promise<void> {
  let factory: IDBFactory | null = null;
  try {
    factory = view.indexedDB;
  } catch {
    factory = null;
  }
  if (!factory) {
    report.notes.push("IndexedDB is not available in this browser.");
    return;
  }
  if (typeof factory.databases !== "function") {
    report.failures.push("IndexedDB databases could not be listed, so they were left in place.");
    return;
  }
  let databases: IDBDatabaseInfo[];
  try {
    databases = await factory.databases();
  } catch {
    report.failures.push("IndexedDB databases could not be listed, so they were left in place.");
    return;
  }
  let failed = false;
  let blocked = false;
  for (const database of databases.slice(0, 200)) {
    if (!database.name) continue;
    try {
      const request = factory.deleteDatabase(database.name);
      const result = await settleRequest(view, request);
      if (result === "blocked") blocked = true;
      else if (result !== "ok") failed = true;
    } catch {
      failed = true;
    }
  }
  if (databases.length > 200 || failed) report.failures.push("An IndexedDB database could not be deleted.");
  if (blocked) report.failures.push("An IndexedDB database is open in another tab and was left in place.");
  if (!failed && !blocked && databases.length <= 200) report.cleared.push("IndexedDB");
}

async function clearWorkers(view: Window, report: ClearReport): Promise<void> {
  let workers: ServiceWorkerContainer | null = null;
  try {
    workers = view.navigator.serviceWorker;
  } catch {
    workers = null;
  }
  if (!workers || typeof workers.getRegistrations !== "function") {
    report.notes.push("Service workers are not available in this browser.");
    return;
  }
  let registrations: readonly ServiceWorkerRegistration[];
  try {
    registrations = await workers.getRegistrations();
  } catch {
    report.failures.push("Service workers could not be listed, so they may remain.");
    return;
  }
  let failed = false;
  for (const registration of registrations.slice(0, 50)) {
    try {
      if (!await registration.unregister()) failed = true;
    } catch {
      failed = true;
    }
  }
  if (failed || registrations.length > 50) report.failures.push("A service worker could not be unregistered.");
  else report.cleared.push("service workers");
}

async function clearBrowserSiteData(document: Document, keepKeys: boolean): Promise<ClearReport> {
  const report: ClearReport = { cleared: [], failures: [], notes: [] };
  const view = document.defaultView;
  if (!view) {
    report.failures.push("This page has no browser window, so its stored data was left in place.");
    return report;
  }
  const local = storageOf(view, "localStorage");
  const kept = local ? readKeptKeys(local) : { values: {}, names: [], unreadable: false };
  if (keepKeys && kept.unreadable) report.failures.push("Saved API keys could not be read, so they were not kept.");
  let localCleared = false;
  if (!local) report.notes.push("Local storage is not available in this browser.");
  else {
    try {
      local.clear();
      localCleared = true;
      report.cleared.push("local storage");
    } catch {
      report.failures.push("Local storage could not be cleared.");
    }
  }
  if (local && localCleared && keepKeys && !kept.unreadable && kept.names.length > 0) {
    try {
      local.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, values: kept.values }));
      report.notes.push(`Kept the saved ${sentence(kept.names)} ${kept.names.length > 1 ? "keys" : "key"}.`);
    } catch {
      report.failures.push("Saved API keys could not be written back.");
    }
  } else if (localCleared && keepKeys && !kept.unreadable) {
    report.notes.push("Keep API keys stayed on. No saved Google Maps or CARTO key was found.");
  } else if (localCleared && !keepKeys) {
    report.notes.push("Saved Google Maps and CARTO keys were removed.");
  }
  const session = storageOf(view, "sessionStorage");
  if (!session) report.notes.push("Session storage is not available in this browser.");
  else {
    try {
      session.clear();
      report.cleared.push("session storage");
    } catch {
      report.failures.push("Session storage could not be cleared.");
    }
  }
  expireCookie(document, RECOVERY_STORAGE_KEY);
  await clearCaches(view, report);
  await clearDatabases(view, report);
  await clearWorkers(view, report);
  return report;
}

function whenReady(document: Document, work: () => void): void {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", work, { once: true });
  else work();
}

function ensureStyle(document: Document): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    ".foss-earth-browser-recovery,.foss-earth-browser-recovery-offer{box-sizing:border-box;font:15px/1.45 system-ui,sans-serif}",
    ".foss-earth-browser-recovery{position:fixed;inset:0;z-index:2147483646;overflow:auto;padding:24px 16px;background:#0c1218;color:#ecf1f4;color-scheme:dark}",
    ".foss-earth-browser-recovery__panel,.foss-earth-browser-recovery-offer{display:flex;flex-wrap:wrap;align-items:center;gap:10px}",
    ".foss-earth-browser-recovery__panel{max-width:38rem;margin:0 auto}",
    ".foss-earth-browser-recovery h1,.foss-earth-browser-recovery p{flex-basis:100%;margin:0}",
    ".foss-earth-browser-recovery h1{font-size:1.35rem}",
    ".foss-earth-browser-recovery label{display:inline-flex;align-items:center;gap:8px;font:inherit}",
    ".foss-earth-browser-recovery button,.foss-earth-browser-recovery a,.foss-earth-browser-recovery-offer a{font:inherit;color:inherit;border:1px solid rgba(148,163,184,.45);border-radius:999px;padding:6px 12px;background:transparent;text-decoration:none}",
    ".foss-earth-browser-recovery button{cursor:pointer}.foss-earth-browser-recovery button:disabled{opacity:.45;cursor:default}",
    ".foss-earth-browser-recovery-offer{position:fixed;z-index:2147483646;top:0;left:0;right:0;padding:10px 12px;background:#3a1210;color:#ffd1c9}",
    ".foss-earth-browser-recovery-offer p{flex:1 1 16rem;margin:0}",
  ].join("");
  (document.head ?? document.documentElement).append(style);
}

function holdPage(document: Document, active: HTMLElement): void {
  if (!document.body) return;
  for (const child of [...document.body.children]) {
    if (child === active || child.hasAttribute("inert")) continue;
    child.setAttribute("inert", "");
    child.setAttribute("data-foss-earth-recovery-held", "");
  }
}

function paragraph(document: Document, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

/** The Browser data tab. It links to the review and does not delete anything. */
export function createBrowserDataPanel(document: Document): BrowserDataPanel {
  const view = document.defaultView;
  let disposed = false;
  const panel = document.createElement("div");
  panel.className = "foss-earth-status-section foss-earth-choices foss-earth-browser-data";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Browser data");
  const intro = paragraph(document, "Review clearing saved settings, window layout, stored media and app caches for this website, including other apps on this site. The review opens on its own page. Nothing is deleted until you confirm there.");
  intro.className = "foss-earth-choices__note";
  const keep = document.createElement("label");
  keep.className = "foss-earth-choice";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "keepApiKeys";
  checkbox.checked = true;
  checkbox.defaultChecked = true;
  const keepText = document.createElement("span");
  keepText.textContent = "Keep API keys";
  keep.append(checkbox, keepText);
  const keys = paragraph(document, "Keeps the saved Google Maps and CARTO keys. Uncheck to remove them too.");
  keys.className = "foss-earth-choices__note";
  const limit = paragraph(document, UNREACHABLE);
  limit.className = "foss-earth-choices__note";
  const link = document.createElement("a");
  link.className = "foss-earth-choice foss-earth-parameter__action";
  link.textContent = "Clear browser data";
  const sync = (): void => {
    if (disposed || !view) return;
    const href = recoveryHref(view.location.href, checkbox.checked);
    if (href) link.href = href;
    else link.removeAttribute("href");
  };
  checkbox.addEventListener("change", sync);
  if (!view) link.setAttribute("aria-disabled", "true");
  else sync();
  panel.append(intro, keep, keys, limit, link);
  return {
    element: panel,
    destroy() {
      disposed = true;
      checkbox.removeEventListener("change", sync);
    },
  };
}

function positive(value: number | undefined, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
}

function reportText(report: ClearReport): string {
  const parts: string[] = [];
  if (report.cleared.length > 0) parts.push(`Cleared ${sentence(report.cleared)}.`);
  parts.push(...report.notes, ...report.failures);
  parts.push(report.failures.length === 0 ? "Reloading…" : "Reload when you want to try the page again.");
  return parts.join(" ");
}

/**
 * Counts failed and stalled starts, and shows the review when this page is
 * `?resetBrowserData=1`. Called from the inline HTML, before the app bundle.
 */
export function installBrowserRecovery(document: Document, options: BrowserRecoveryInstallOptions): void {
  if (!validAppId(options.appId)) throw new TypeError("browserRecovery appId must be a short lowercase identifier.");
  const view = document.defaultView;
  if (!view) return;
  const generation = ++installGeneration;
  stopActive?.();
  const appId = options.appId;
  const limit = positive(options.failureLimit, FAILURE_LIMIT, 99);
  const stallMs = typeof options.stallMs === "number" && Number.isFinite(options.stallMs) && options.stallMs >= 0 && options.stallMs <= 600_000
    ? options.stallMs
    : STALL_MS;
  const schedule = options.schedule ?? ((work: () => void, delayMs: number) => view.setTimeout(work, delayMs));
  const cancel = options.cancel ?? ((id: number) => view.clearTimeout(id));
  const replace = options.replace ?? ((url: string) => view.location.replace(url));
  const recoveryPage = isBrowserRecoveryPage(document);
  let settled = false;
  let timerOn = false;
  let timerId = 0;
  let offerRequested = false;
  const stopTimer = (): void => {
    if (!timerOn) return;
    timerOn = false;
    cancel(timerId);
  };
  const current = (): boolean => generation === installGeneration;
  stopActive = () => {
    settled = true;
    offerRequested = false;
    stopTimer();
  };
  const removeOffer = (): void => {
    offerRequested = false;
    document.querySelector(".foss-earth-browser-recovery-offer")?.remove();
  };
  const showOffer = (reported: boolean): void => {
    if (!current() || recoveryPage || readCount(view, document, appId) < limit) return;
    offerRequested = true;
    whenReady(document, () => {
      if (!current() || !offerRequested || recoveryPage || readCount(view, document, appId) < limit) return;
      if (document.querySelector(".foss-earth-browser-recovery-offer")) return;
      ensureStyle(document);
      const offer = document.createElement("div");
      offer.className = "foss-earth-browser-recovery-offer";
      offer.setAttribute("role", "region");
      offer.setAttribute("aria-label", "Browser data recovery");
      const text = paragraph(document, reported
        ? "This page has not finished starting repeatedly. The last start reported a failure. You can review clearing this site's browser data. Nothing is deleted until you confirm."
        : "This page has not finished starting repeatedly. You can review clearing this site's browser data. Nothing is deleted until you confirm.");
      const action = document.createElement("a");
      const href = recoveryHref(view.location.href, true);
      if (href) action.href = href;
      action.textContent = "Clear browser data";
      offer.append(text, action);
      document.body?.prepend(offer);
    });
  };
  const succeed = (): void => {
    if (!current() || recoveryPage) return;
    settled = true;
    stopTimer();
    writeCount(view, document, appId, 0);
    removeOffer();
  };
  const fail = (reported: boolean): void => {
    if (!current() || recoveryPage || settled) return;
    settled = true;
    stopTimer();
    writeCount(view, document, appId, readCount(view, document, appId) + 1);
    if (readCount(view, document, appId) >= limit) showOffer(reported);
  };
  (view as unknown as Record<string, unknown>)[HOOK] = {
    ready: succeed,
    failed(message: string) {
      fail(message.trim().length > 0);
    },
  };
  if (recoveryPage) {
    whenReady(document, () => {
      if (!current()) return;
      renderReview(document, view, replace, schedule);
    });
    return;
  }
  if (readCount(view, document, appId) >= limit) showOffer(false);
  timerOn = true;
  timerId = schedule(() => fail(false), stallMs);
}

function renderReview(document: Document, view: Window, replace: (url: string) => void, schedule: (work: () => void, delayMs: number) => number): void {
  if (!document.body || document.querySelector(".foss-earth-browser-recovery")) return;
  ensureStyle(document);
  const root = document.createElement("div");
  root.className = "foss-earth-browser-recovery";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "foss-earth-browser-recovery-title");
  const panel = document.createElement("div");
  panel.className = "foss-earth-browser-recovery__panel";
  const title = document.createElement("h1");
  title.id = "foss-earth-browser-recovery-title";
  title.tabIndex = -1;
  title.textContent = "Clear browser data";
  const keep = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "keepApiKeys";
  checkbox.checked = keepKeysFrom(view.location.href);
  const keepText = document.createElement("span");
  keepText.textContent = "Keep API keys";
  keep.append(checkbox, keepText);
  const status = paragraph(document, "");
  status.setAttribute("role", "status");
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Clear this site's browser data";
  const back = document.createElement("a");
  back.textContent = "Return without clearing";
  const home = appHref(view.location.href);
  if (home) back.href = home;
  checkbox.addEventListener("change", () => {
    const href = recoveryHref(view.location.href, checkbox.checked);
    if (!href) return;
    try {
      view.history.replaceState(view.history.state, "", href);
    } catch {
      // The checkbox still decides the clear. The address is only a reminder.
    }
  });
  let clearing = false;
  confirm.addEventListener("click", () => {
    if (clearing) return;
    clearing = true;
    confirm.disabled = true;
    checkbox.disabled = true;
    status.textContent = "Clearing this site's browser data…";
    void clearBrowserSiteData(document, checkbox.checked).then(report => {
      status.textContent = reportText(report);
      if (report.failures.length > 0) {
        const again = document.createElement("a");
        const href = appHref(view.location.href);
        if (href) again.href = href;
        again.textContent = "Reload";
        panel.append(again);
        return;
      }
      const href = appHref(view.location.href);
      if (!href) return;
      schedule(() => {
        try {
          replace(href);
        } catch {
          status.textContent = `${status.textContent} The page could not reload itself.`;
          const again = document.createElement("a");
          again.href = href;
          again.textContent = "Reload";
          panel.append(again);
        }
      }, 1200);
    }).catch(() => {
      status.textContent = "Browser data could not be cleared. Reload when you want to try the page again.";
    });
  });
  panel.append(
    title,
    paragraph(document, "This clears saved settings, window layout, session storage, IndexedDB databases, cached app files and service worker registrations for this website, including other apps on this site. Nothing is deleted until you choose Clear this site's browser data."),
    keep,
    paragraph(document, "Keeps the saved Google Maps and CARTO keys. Uncheck to remove them too."),
    paragraph(document, UNREACHABLE),
    confirm,
    back,
    status,
  );
  root.append(panel);
  document.body.append(root);
  holdPage(document, root);
  try {
    title.focus();
  } catch {
    // Focusing the heading is a courtesy. The buttons remain in tab order.
  }
}

export function markBrowserAppReady(document: Document): void {
  const hook = hookOf(document);
  if (hook) {
    hook.ready();
    return;
  }
  const appId = appIdFrom(document);
  const view = document.defaultView;
  if (!appId || !view || isBrowserRecoveryPage(document)) return;
  writeCount(view, document, appId, 0);
}

export function reportBrowserAppFailure(document: Document, message?: string): void {
  const hook = hookOf(document);
  if (hook) {
    hook.failed(message ?? "");
    return;
  }
  const appId = appIdFrom(document);
  const view = document.defaultView;
  if (!appId || !view || isBrowserRecoveryPage(document)) return;
  writeCount(view, document, appId, readCount(view, document, appId) + 1);
}
