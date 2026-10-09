import type { SettingsStorage } from "../settings/registry.js";

/** Consulted only when a browser adapter is explicitly called. */
export function readBrowserStorage(): SettingsStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}
