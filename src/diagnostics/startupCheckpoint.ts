/** Import free: the boot plugin also installs this store before application modules run. */
export const STARTUP_CHECKPOINT_PREFIX = "foss-earth.startup.v1 ";
export const STARTUP_CHECKPOINT_BYTES = 512 * 1024;
export interface StartupCheckpointRecord {
  version: 1;
  id: string;
  route: string;
  startedAt: number;
  savedAt: number;
  outcome: "loading" | "ready" | "failed";
  sections: Record<string, string>;
  omissions: string[];
}
export interface StartupCheckpointEnvironment {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now(): number;
}
export interface StartupCheckpointStore {
  section(name: string, text: string): void;
  save(outcome?: StartupCheckpointRecord["outcome"]): void;
  snapshot(): StartupCheckpointRecord;
  status(): string;
  disable(): void;
  enable(): void;
}
export function readStartupCheckpoints(environment: StartupCheckpointEnvironment, route: string): StartupCheckpointRecord[] {
  const records: StartupCheckpointRecord[] = [];
  for (const suffix of ["current", "previous"]) {
    try {
      const raw = environment.storage?.getItem(`${STARTUP_CHECKPOINT_PREFIX}${route} ${suffix}`);
      if (!raw || raw.length * 2 > STARTUP_CHECKPOINT_BYTES) continue;
      const value = JSON.parse(raw) as StartupCheckpointRecord;
      if (value?.version !== 1 || value.route !== route || typeof value.id !== "string"
        || !Number.isFinite(value.startedAt) || !Number.isFinite(value.savedAt)
        || !["loading", "ready", "failed"].includes(value.outcome)
        || !value.sections || typeof value.sections !== "object" || Array.isArray(value.sections)
        || Object.values(value.sections).some(text => typeof text !== "string")
        || !Array.isArray(value.omissions) || value.omissions.some(text => typeof text !== "string")) continue;
      records.push(value);
    } catch { /* Missing, corrupt or forbidden storage leaves the other record readable. */ }
  }
  return records;
}
export function createStartupCheckpointStore(environment: StartupCheckpointEnvironment, route: string): StartupCheckpointStore {
  const key = `${STARTUP_CHECKPOINT_PREFIX}${route} `;
  const now = environment.now();
  const record: StartupCheckpointRecord = { version: 1, id: `${now}-${Math.random().toString(36).slice(2)}`, route,
    startedAt: now, savedAt: now, outcome: "loading", sections: {}, omissions: [] };
  let enabled = true;
  let storageStatus = environment.storage ? "Checkpoint not saved yet." : "Checkpoint storage unavailable; evidence is held only in this page.";
  try {
    const [previous] = readStartupCheckpoints(environment, route);
    if (previous) environment.storage?.setItem(key + "previous", JSON.stringify(previous));
  } catch { storageStatus = "Previous checkpoint could not be retained."; }
  const snapshot = (): StartupCheckpointRecord => ({ ...record, sections: { ...record.sections }, omissions: [...record.omissions] });
  return {
    section(name, text) {
      if (!enabled || !/^[a-z][a-z0-9-]{0,60}\.txt$/.test(name)) return;
      if (Object.keys(record.sections).length >= 32 && !(name in record.sections)) {
        if (!record.omissions.includes(name)) record.omissions.push(name);
        return;
      }
      record.sections[name] = text.slice(0, STARTUP_CHECKPOINT_BYTES / 2);
      if (record.sections[name].length < text.length && !record.omissions.includes(name)) record.omissions.push(name);
    },
    save(outcome) {
      if (!enabled) return;
      if (outcome) record.outcome = outcome;
      record.savedAt = environment.now();
      let json = JSON.stringify(record);
      while (json.length * 2 > STARTUP_CHECKPOINT_BYTES) {
        const critical = new Set(["startup-state.txt", "errors.txt", "gpu-error.txt", "memory.txt"]);
        const name = Object.keys(record.sections).filter(key => record.sections[key]!.length > 0)
          .sort((a, b) => Number(critical.has(a)) - Number(critical.has(b)) || record.sections[b]!.length - record.sections[a]!.length)[0];
        if (!name || record.sections[name]!.length === 0) break;
        record.sections[name] = record.sections[name]!.slice(0, Math.floor(record.sections[name]!.length / 2));
        if (!record.omissions.includes(name)) record.omissions.push(name);
        json = JSON.stringify(record);
      }
      try {
        if (!environment.storage) throw new Error("Unavailable");
        environment.storage.setItem(key + "current", json);
        storageStatus = `Checkpoint saved at ${new Date(record.savedAt).toISOString()}.`;
      } catch { storageStatus = "Checkpoint storage failed or is full; newer evidence is held only in this page."; }
    },
    snapshot, status: () => storageStatus,
    enable() { enabled = true; },
    disable() {
      enabled = false;
      record.sections = {};
      try { environment.storage?.removeItem(key + "current"); environment.storage?.removeItem(key + "previous"); } catch { /* Forbidden storage. */ }
      storageStatus = "Checkpoint retention disabled.";
    },
  };
}

/** Fixed labels only until the application installs its settings-aware redactor. */
export function installEarlyStartupCheckpoint(view: Window & typeof globalThis): void {
  const address = new URL(view.location.href);
  if (address.searchParams.get("set.diagnostics.trail") === "false" || address.searchParams.has("report") || address.searchParams.get("resetBrowserData") === "1"
    || /\/rc\/?$/.test(address.pathname) || address.searchParams.get("mode") === "remote") return;
  const host = view as typeof view & { __fossEarthStartup?: StartupCheckpointStore };
  if (host.__fossEarthStartup) return;
  let storage: Storage | null = null;
  try { storage = view.localStorage; } catch { /* In-memory capture. */ }
  try {
    const settings = JSON.parse(storage?.getItem("foss-earth.settings.v1") ?? "null");
    if (settings?.values?.["diagnostics.trail"] === false) return;
  } catch { /* Broken settings must not break boot. */ }
  const store = createStartupCheckpointStore({ storage, now: () => Date.now() }, address.pathname);
  host.__fossEarthStartup = store;
  store.section("boot.txt", "Application modules have not started. Browser termination reason is unknown.");
  // Build stamps are fixed metadata, never URL queries or arbitrary boot messages.
  const stamps = [...view.document.querySelectorAll<HTMLMetaElement>('meta[name^="foss-earth-"]')]
    .filter(meta => /(?:build|source|bundle|commit|version)$/.test(meta.name))
    .map(meta => `${meta.name}: ${meta.content.replace(/[^a-zA-Z0-9_./: +#-]/g, "_").slice(0, 200)}`);
  store.section("build.txt", stamps.join("\n") || "Build metadata not available before module startup.");
  const heap = (view.performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  store.section("memory.txt", JSON.stringify({ javascriptHeap: heap ? { usedBytes: heap.usedJSHeapSize,
    allocatedBytes: heap.totalJSHeapSize, limitBytes: heap.jsHeapSizeLimit } : "unavailable",
    wasmMemory: "not started", totalProcessMemory: "unavailable", sandboxMemoryLimit: "unavailable" }));
  store.save();
}
