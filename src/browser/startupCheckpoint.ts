import { createStartupCheckpointStore, type StartupCheckpointStore, type StartupCheckpointRecord } from "../diagnostics/startupCheckpoint.js";
import { redactIssueReport } from "../diagnostics/issueReport.js";
import { reportSecrets } from "../diagnostics/settingsReport.js";
import type { SettingsRegistry } from "../settings/registry.js";

type StartupWindow = Window & { __fossEarthStartup?: StartupCheckpointStore };
export function browserStartupEnvironment() {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* Forbidden storage. */ }
  return { storage, now: () => Date.now() };
}
export function startupMemoryObservation(): string {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return JSON.stringify({ at: new Date().toISOString(), javascriptHeap: memory ? {
    usedBytes: memory.usedJSHeapSize, allocatedBytes: memory.totalJSHeapSize, limitBytes: memory.jsHeapSizeLimit,
  } : "unavailable", wasmMemory: "See component-execution.txt when available; JSBSim may not expose its heap", totalProcessMemory: "unavailable", sandboxMemoryLimit: "unavailable",
  note: "JavaScript heap and WASM observations do not measure total process memory." });
}
export function getBrowserStartupCheckpoint(): StartupCheckpointStore | undefined {
  return typeof window === "undefined" ? undefined : (window as StartupWindow).__fossEarthStartup;
}
/** Attach the application redactor before any free-form evidence is retained. */
export function startBrowserStartupCheckpoint(settings: SettingsRegistry) {
  const host = window as StartupWindow;
  const store = host.__fossEarthStartup ??= createStartupCheckpointStore(browserStartupEnvironment(), location.pathname);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const retained = () => settings.get("diagnostics.trail") !== false;
  const flush = (outcome?: StartupCheckpointRecord["outcome"]) => {
    clearTimeout(timer); timer = undefined;
    if (retained()) store.save(outcome); else store.disable();
  };
  const section = (name: string, value: string, urgent = false) => {
    if (stopped || !retained()) return;
    store.section(name, redactIssueReport(value, reportSecrets(settings)));
    store.section("memory.txt", startupMemoryObservation());
    if (urgent) flush(); else timer ??= setTimeout(() => flush(), 1000);
  };
  const stopRetention = settings.watch("diagnostics.trail", () => {
    if (!retained()) { clearTimeout(timer); timer = undefined; store.disable(); }
    else { store.enable(); flush(); }
  });
  if (!retained()) store.disable();
  return { section, flush, status: store.status,
    destroy() { if (stopped) return; flush(); stopped = true; stopRetention(); clearTimeout(timer); } };
}
