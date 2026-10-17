/**
 * The boot terminal (docs/proposals/startup-loading.md, The boot terminal):
 * what a page shows from its first bytes until its 3D scene's first frame.
 *
 * `bootTerminal()` in vite/index.mjs writes the terminal's style, its markup
 * and then this file into each page's HTML, so it paints and runs before any
 * module is fetched. This file stays free of imports for that reason. Apps
 * report their steps with the helpers in bootSteps.ts, which do nothing on a
 * page without the terminal.
 */

/** The element the plugin writes; the recovery's offer joins it while it shows. */
export const BOOT_TERMINAL_ID = "foss-earth-boot";
/** Where the page keeps the terminal: `window.__fossEarthBoot`. */
export const BOOT_TERMINAL_GLOBAL = "__fossEarthBoot";
const RECORD_KEY = "foss-earth.boot ";
/** Until this device has a record: a start's download, then its startup, in ms. */
const DEFAULT_DOWNLOAD_MS = 3000;
const DEFAULT_STARTUP_MS = 1500;
/** A byte rate is measured once this much has arrived over the network, for this long. */
const RATE_MIN_BYTES = 64 * 1024;
const RATE_MIN_MS = 400;
/** The download's line is rewritten at most this often, so a screen reader is not flooded. */
const TEXT_EVERY_MS = 500;
const FADE_MS = 150;

/** What the page waits for before its first module runs: the entry's static imports and styles. */
export interface BootGraph {
  /** The deployment base the files are under, as the page's own URLs start: "/tour/". */
  base: string;
  /** Each file under the base, with its compressed size in bytes. */
  files: [path: string, bytes: number][];
}

export type BootTone = "info" | "success" | "warning" | "error";
export interface BootLogEntry {
  text: string;
  tone?: BootTone;
}
export interface BootLogLine {
  update(entry: BootLogEntry): void;
}
/** What of a game log the terminal prints into. */
export interface BootLog {
  print(entry: BootLogEntry): BootLogLine;
  /** While it is on the page, the log shows a failure itself, with its actions. */
  readonly element?: { readonly isConnected: boolean };
}

/** `window.__fossEarthBoot` on a page with the terminal. */
export interface FossEarthBoot {
  /** Adds the line `id`, or rewrites it. `fraction` is how far the start is past the download, from 0 to 1. */
  step(id: string, text: string, fraction?: number): void;
  /** Prints the lines so far into the app's log, and each later one too: the log's history starts with the boot. */
  attach(log: BootLog): void;
  /** The 3D scene's first frame is on screen: the terminal fades out, and remembers how long this start took. */
  done(): void;
  /** The app is ready. Without an attached log, which promises `done()`, the terminal goes now. */
  ready(): void;
  /** Ends the start with `text` as the last line, an error; or, while the app's log is on the page, hands over to it, which says why. */
  fail(text: string): void;
}

interface BootRecord {
  downloadMs: number;
  startupMs: number;
}

interface Line {
  id: string;
  row: HTMLElement;
  text: string;
  tone: BootTone;
  mirror: BootLogLine | null;
}

const megabytes = (bytes: number): string => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** Runs from the page's HTML, right after the terminal's markup. */
export function installBootTerminal(view: Window & typeof globalThis, graph: BootGraph | null): void {
  const document = view.document;
  const root = document.getElementById(BOOT_TERMINAL_ID);
  const list = root?.querySelector("ol");
  const bar = root?.querySelector<HTMLElement>("[role=progressbar]");
  if (!root || !list || !bar) return;
  const performance = view.performance;
  const now = (): number => performance.now();
  const recordKey = RECORD_KEY + view.location.pathname;
  let record: BootRecord | null = null;
  try {
    const saved = JSON.parse(view.localStorage.getItem(recordKey) ?? "null") as BootRecord | null;
    if (saved && saved.downloadMs > 0 && saved.startupMs > 0) record = saved;
  } catch { /* A start without a record weighs its parts by the defaults. */ }

  const lines: Line[] = [...list.querySelectorAll<HTMLElement>("li[data-id]")].map(row => ({
    id: row.dataset.id ?? "", row, text: row.textContent ?? "", tone: "info", mirror: null,
  }));
  let log: BootLog | null = null;
  let finished = false;
  let failed = false;

  const render = (line: Line): void => {
    line.row.dataset.tone = line.tone;
    line.row.textContent = line.text;
    line.mirror?.update({ text: line.text, tone: line.tone });
  };
  const put = (id: string, text: string, tone: BootTone): void => {
    let line = lines.find(candidate => candidate.id === id);
    if (!line) {
      // A new step ends those before it.
      for (const before of lines) if (before.tone === "info") { before.tone = "success"; render(before); }
      const row = document.createElement("li");
      row.dataset.id = id;
      line = { id, row, text, tone, mirror: null };
      lines.push(line);
      list.append(row);
      if (log) line.mirror = log.print({ text, tone });
    }
    line.text = text;
    line.tone = tone;
    render(line);
  };

  // ─── The download ────────────────────────────────────────────────
  const sizes = new Map<string, number>();
  let total = 0;
  for (const [file, bytes] of graph?.files ?? []) {
    try {
      sizes.set(new URL(graph!.base + file, document.baseURI).pathname, bytes);
      total += bytes;
    } catch { /* A file the page cannot name is not waited for. */ }
  }
  const seen = new Set<string>();
  let doneBytes = 0;
  /** What came over the network, not from this device. */
  let networkBytes = 0;
  let firstStart = Infinity;
  let downloadEnd: number | null = null;
  let startup = 0;
  let shown = 0;
  let textAt = -Infinity;

  const downloadText = (): string => {
    if (downloadEnd !== null) {
      // A page without a graph, such as the dev server's, knows only when its modules ran.
      if (sizes.size === 0) return `Loaded the app in ${seconds(downloadEnd)}`;
      return networkBytes > total / 10
        ? `Downloaded the app: ${megabytes(total || networkBytes)} in ${seconds(downloadEnd)}`
        : `Loaded the app from this device in ${seconds(downloadEnd)}`;
    }
    if (seen.size === 0) return "Downloading the app…";
    if (networkBytes === 0) return `Loading the app from this device: ${seen.size} of ${sizes.size} files`;
    const left = remainingMs();
    return `Downloading the app: ${megabytes(doneBytes)} of ${megabytes(total)}${left >= 1000 ? `, about ${Math.ceil(left / 1000)} s left` : ""}`;
  };
  /** The download's byte rate on this visit, in bytes per ms, once there is enough to measure it. */
  const rate = (): number | null => {
    const elapsed = now() - firstStart;
    return networkBytes >= RATE_MIN_BYTES && elapsed >= RATE_MIN_MS ? networkBytes / elapsed : null;
  };
  /** How long the whole start has left, once this visit's byte rate is known; else 0. */
  const remainingMs = (): number => {
    const bytesPerMs = rate();
    return bytesPerMs ? (total - doneBytes) / bytesPerMs + (record?.startupMs ?? 0) : 0;
  };
  const downloadMs = (): number => {
    if (downloadEnd !== null) return downloadEnd;
    const bytesPerMs = rate();
    return bytesPerMs ? now() + (total - doneBytes) / bytesPerMs : record?.downloadMs ?? DEFAULT_DOWNLOAD_MS;
  };
  /** The bar weighs the download and the startup after it by how long each takes, and never goes back. */
  const progress = (): number => {
    const download = downloadEnd !== null ? 1 : total > 0 ? doneBytes / total : sizes.size > 0 ? seen.size / sizes.size : 0;
    const d = downloadMs(), s = record?.startupMs ?? DEFAULT_STARTUP_MS;
    shown = Math.max(shown, Math.min(1, (d * download + s * startup) / (d + s)));
    return shown;
  };

  let scheduled = false;
  const paint = (): void => {
    scheduled = false;
    if (finished || failed) return;
    const fraction = progress();
    bar.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
    (bar.firstElementChild as HTMLElement | null)?.style.setProperty("--boot-progress", String(fraction));
    if (downloadEnd === null && now() - textAt >= TEXT_EVERY_MS) {
      textAt = now();
      put("download", downloadText(), "info");
    }
  };
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    view.setTimeout(paint, 0);
  };
  const endDownload = (): void => {
    if (downloadEnd !== null) return;
    let end = 0;
    for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
      if (seen.has(pathOf(entry.name))) end = Math.max(end, entry.responseEnd);
    }
    downloadEnd = end || now();
    doneBytes = total;
    put("download", downloadText(), "success");
  };
  const pathOf = (url: string): string => {
    try { return new URL(url).pathname; } catch { return ""; }
  };
  const take = (entries: PerformanceEntryList): void => {
    let changed = false;
    for (const entry of entries as PerformanceResourceTiming[]) {
      const path = pathOf(entry.name), bytes = sizes.get(path);
      if (bytes === undefined || seen.has(path)) continue;
      seen.add(path);
      doneBytes += bytes;
      networkBytes += entry.transferSize > 0 ? entry.encodedBodySize : 0;
      firstStart = Math.min(firstStart, entry.startTime);
      changed = true;
    }
    if (changed && seen.size === sizes.size) endDownload();
    if (changed) schedule();
  };
  try {
    new view.PerformanceObserver(found => take(found.getEntries())).observe({ type: "resource", buffered: true });
  } catch { /* Without resource timing the bar moves with the app's steps alone. */ }
  // A second of nothing new still counts down the estimate.
  const tick = view.setInterval(() => { if (finished || failed || downloadEnd !== null) view.clearInterval(tick); else schedule(); }, 1000);

  // The terminal is the page's first content: its first paint is when it showed.
  try {
    new view.PerformanceObserver((found, observer) => {
      for (const entry of found.getEntries()) {
        if (entry.name !== "first-contentful-paint") continue;
        if (performance.getEntriesByName("boot:terminal", "mark").length === 0) performance.mark("boot:terminal", { startTime: entry.startTime });
        observer.disconnect();
      }
    }).observe({ type: "paint", buffered: true });
  } catch { /* The mark is for measurement only. */ }

  // A module the page needs that cannot be fetched stops the start before any app code can say so.
  view.addEventListener("error", event => {
    const target = event.target;
    if (target instanceof view.HTMLScriptElement && target.type === "module") boot.fail("The app could not download. Check the connection, then reload the page.");
  }, true);

  const finish = (): void => {
    finished = true;
    view.clearInterval(tick);
    // The recovery's offer outlives the terminal: it goes when the app says it is ready.
    const offer = root.querySelector(".foss-earth-browser-recovery-offer");
    if (offer) document.body.prepend(offer);
    root.setAttribute("data-done", "");
    const remove = (): void => root.remove();
    if (view.matchMedia?.("(prefers-reduced-motion: reduce)").matches) remove();
    else view.setTimeout(remove, FADE_MS + 50);
  };
  const boot: FossEarthBoot = {
    step(id, text, fraction) {
      if (finished || failed) return;
      // Any step of the app's own means its modules run, so everything they import has arrived.
      endDownload();
      if (typeof fraction === "number" && fraction >= 0 && fraction <= 1) startup = Math.max(startup, fraction);
      put(id, text, "info");
      schedule();
    },
    attach(next) {
      if (log) return;
      log = next;
      for (const line of lines) line.mirror = log.print({ text: line.text, tone: line.tone });
    },
    done() {
      if (finished || failed) return;
      endDownload();
      for (const line of lines) if (line.tone === "info") { line.tone = "success"; render(line); }
      try {
        const saved: BootRecord = { downloadMs: Math.round(downloadEnd!), startupMs: Math.round(Math.max(1, now() - downloadEnd!)) };
        view.localStorage.setItem(recordKey, JSON.stringify(saved));
      } catch { /* The next start weighs its parts by the defaults. */ }
      finish();
    },
    ready() {
      if (!log && !failed) finish();
    },
    fail(text) {
      if (finished || failed) return;
      if (log?.element?.isConnected) {
        finish();
        return;
      }
      failed = true;
      view.clearInterval(tick);
      put("failure", text, "error");
      root.setAttribute("data-failed", "");
    },
  };
  (view as unknown as Record<string, unknown>)[BOOT_TERMINAL_GLOBAL] = boot;
}
