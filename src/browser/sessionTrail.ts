import type { TrailEnvironment, SessionTrailOptions, SessionTrail } from "../diagnostics/sessionTrail.js";
import { createSessionTrail } from "../diagnostics/sessionTrail.js";
export function browserTrailEnvironment(): TrailEnvironment {
  let storage: TrailEnvironment["storage"] = null;
  // Reading localStorage throws where the browser forbids it, as some private windows do.
  try { storage = typeof localStorage === "undefined" ? null : localStorage; } catch { storage = null; }
  return {
    storage,
    onStorage(listener) {
      if (typeof window === "undefined") return () => {};
      const onEvent = (event: StorageEvent): void => listener(event.key);
      window.addEventListener("storage", onEvent);
      return () => window.removeEventListener("storage", onEvent);
    },
    now: () => Date.now(),
    elapsed: () => (typeof performance === "undefined" ? 0 : performance.now()),
    newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    defer: work => queueMicrotask(work),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

export function createBrowserSessionTrail(options: Omit<SessionTrailOptions, "environment"> & { environment?: TrailEnvironment }): SessionTrail { return createSessionTrail({ ...options, environment: options.environment ?? browserTrailEnvironment() }); }
