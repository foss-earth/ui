import type { SettingsStorage } from "../settings/registry.js";
import type { WindowWorkspaceState } from "../windowing/core/types.js";
import {
  parseSavedWorkspace,
  SAVED_WORKSPACE_STORAGE_KEY,
  serializeWorkspace,
} from "../windowing/core/workspacePersistence.js";
import { readBrowserStorage } from "./storage.js";

export { SAVED_WORKSPACE_STORAGE_KEY };

/** Loads existing records from supplied storage, or browser storage when omitted. */
export function loadSavedWorkspace<TabId extends string>(
  restorable: ReadonlySet<TabId>,
  storage: SettingsStorage | null = readBrowserStorage(),
): WindowWorkspaceState<TabId> | null {
  try {
    return parseSavedWorkspace(storage?.getItem(SAVED_WORKSPACE_STORAGE_KEY) ?? null, restorable);
  } catch {
    return null;
  }
}

/** Workspace persistence remains a best-effort convenience, as in the old API. */
export function saveWorkspace(
  state: WindowWorkspaceState<string>,
  storage: SettingsStorage | null = readBrowserStorage(),
): void {
  try {
    storage?.setItem(SAVED_WORKSPACE_STORAGE_KEY, serializeWorkspace(state));
  } catch {
    // Losing workspace persistence costs a few clicks; settings are separate.
  }
}
