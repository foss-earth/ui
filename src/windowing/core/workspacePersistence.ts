import { createWindowWorkspaceState } from "./workspaceState.js";
import type { WindowSlotState, WindowWorkspaceState } from "./types.js";

/** The existing unversioned per-origin workspace key, preserved for consumers. */
export const SAVED_WORKSPACE_STORAGE_KEY = "foss-earth.workspace";

const SLOT_IDS = ["primary", "secondary"] as const;
const size = (value: unknown): number | null => (
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
);

/** Parses existing workspace records without reading a browser or host storage. */
export function parseSavedWorkspace<TabId extends string>(
  raw: string | null,
  restorable: ReadonlySet<TabId>,
): WindowWorkspaceState<TabId> | null {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const seen = new Set<TabId>();
    const slots: Partial<Record<(typeof SLOT_IDS)[number], Partial<WindowSlotState<TabId>>>> = {};
    for (const slotId of SLOT_IDS) {
      const saved: unknown = (parsed as Record<string, unknown>)[slotId];
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) continue;
      const { tabs, activeTab, collapsed, width, height } = saved as Record<string, unknown>;
      const kept = (Array.isArray(tabs) ? tabs : []).filter((tabId): tabId is TabId => {
        if (typeof tabId !== "string" || !restorable.has(tabId as TabId) || seen.has(tabId as TabId)) return false;
        seen.add(tabId as TabId);
        return true;
      });
      slots[slotId] = {
        tabs: kept,
        activeTab: typeof activeTab === "string" && kept.includes(activeTab as TabId) ? activeTab as TabId : null,
        collapsed: collapsed === true,
        width: size(width),
        height: size(height),
      };
    }
    return createWindowWorkspaceState(slots);
  } catch {
    return null;
  }
}

/** Writes the same primary/secondary record shape used by the existing hosts. */
export function serializeWorkspace(state: WindowWorkspaceState<string>): string {
  return JSON.stringify(state);
}
