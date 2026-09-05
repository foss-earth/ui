import { availableWindowTabs, conflictingTabsFor } from "./tabRules";
import type { WindowSlotId, WindowSlotState, WindowTabDefinition, WindowWorkspaceState } from "./types";

const SLOT_IDS: readonly WindowSlotId[] = ["primary", "secondary"];

export interface WindowWorkspaceStateInit<TabId extends string> {
  primary?: Partial<WindowSlotState<TabId>>;
  secondary?: Partial<WindowSlotState<TabId>>;
}

export function createWindowSlotState<TabId extends string>(
  partial: Partial<WindowSlotState<TabId>> = {},
): WindowSlotState<TabId> {
  const tabs = [...(partial.tabs ?? [])];
  const activeTab = partial.activeTab && tabs.includes(partial.activeTab)
    ? partial.activeTab
    : tabs[tabs.length - 1] ?? null;

  return {
    tabs,
    activeTab,
    collapsed: partial.collapsed ?? false,
    width: partial.width ?? null,
    height: partial.height ?? null,
  };
}

export function createWindowWorkspaceState<TabId extends string>(
  partial: WindowWorkspaceStateInit<TabId> = {},
): WindowWorkspaceState<TabId> {
  return {
    primary: createWindowSlotState(partial.primary),
    secondary: createWindowSlotState(partial.secondary),
  };
}

export function allWorkspaceOpenTabs<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
): TabId[] {
  const seen = new Set<TabId>();
  const openTabs: TabId[] = [];

  for (const slotId of SLOT_IDS) {
    for (const tabId of state[slotId].tabs) {
      if (seen.has(tabId)) continue;
      seen.add(tabId);
      openTabs.push(tabId);
    }
  }

  return openTabs;
}

function cloneSlotState<TabId extends string>(slot: WindowSlotState<TabId>): WindowSlotState<TabId> {
  return {
    ...slot,
    tabs: [...slot.tabs],
  };
}

function cloneWorkspaceState<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
): WindowWorkspaceState<TabId> {
  return {
    primary: cloneSlotState(state.primary),
    secondary: cloneSlotState(state.secondary),
  };
}

function normalizeSlot<TabId extends string>(slot: WindowSlotState<TabId>): WindowSlotState<TabId> {
  const tabs = [...slot.tabs];
  const activeTab = slot.activeTab && tabs.includes(slot.activeTab)
    ? slot.activeTab
    : tabs[tabs.length - 1] ?? null;

  return {
    ...slot,
    tabs,
    activeTab,
  };
}

function removeTabsFromSlot<TabId extends string>(
  slot: WindowSlotState<TabId>,
  removedTabs: ReadonlySet<TabId>,
): WindowSlotState<TabId> {
  const tabs = slot.tabs.filter((entry) => !removedTabs.has(entry));
  const activeTab = slot.activeTab && !removedTabs.has(slot.activeTab)
    ? slot.activeTab
    : tabs[tabs.length - 1] ?? null;

  return {
    ...slot,
    tabs,
    activeTab,
  };
}

export function openTabInWorkspace<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  targetSlotId: WindowSlotId,
  tabId: TabId,
  definitions: readonly WindowTabDefinition<TabId>[],
): WindowWorkspaceState<TabId> {
  const allowedTabs = new Set(availableWindowTabs(definitions));
  if (!allowedTabs.has(tabId)) {
    return state;
  }

  const removedTabs = new Set<TabId>([tabId, ...conflictingTabsFor(tabId, definitions)]);
  const next = cloneWorkspaceState(state);

  for (const slotId of SLOT_IDS) {
    next[slotId] = removeTabsFromSlot(next[slotId], removedTabs);
  }

  if (!next[targetSlotId].tabs.includes(tabId)) {
    next[targetSlotId].tabs.push(tabId);
  }
  next[targetSlotId].activeTab = tabId;

  return {
    primary: normalizeSlot(next.primary),
    secondary: normalizeSlot(next.secondary),
  };
}

export function closeTabInWorkspace<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  slotId: WindowSlotId,
  tabId: TabId,
): WindowWorkspaceState<TabId> {
  const next = cloneWorkspaceState(state);
  next[slotId] = removeTabsFromSlot(next[slotId], new Set<TabId>([tabId]));

  return {
    primary: normalizeSlot(next.primary),
    secondary: normalizeSlot(next.secondary),
  };
}

export function selectTabInWorkspace<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  slotId: WindowSlotId,
  tabId: TabId,
): WindowWorkspaceState<TabId> {
  const slot = state[slotId];
  if (!slot.tabs.includes(tabId)) {
    return state;
  }

  const next = cloneWorkspaceState(state);
  next[slotId].activeTab = tabId;

  return next;
}

/**
 * Explicit action that preserves existing select semantics while also
 * restoring a collapsed slot for consumers that opt in to browser-style
 * tab click behavior.
 */
export function selectTabAndExpandWorkspaceSlot<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  slotId: WindowSlotId,
  tabId: TabId,
): WindowWorkspaceState<TabId> {
  const next = selectTabInWorkspace(state, slotId, tabId);
  return setWorkspaceSlotCollapsed(next, slotId, false);
}

export function setWorkspaceSlotCollapsed<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  slotId: WindowSlotId,
  collapsed: boolean,
): WindowWorkspaceState<TabId> {
  const next = cloneWorkspaceState(state);
  next[slotId].collapsed = collapsed;
  return next;
}

/**
 * Explicit action that opens a tab and restores the target slot.
 */
export function openTabAndExpandWorkspaceSlot<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  targetSlotId: WindowSlotId,
  tabId: TabId,
  definitions: readonly WindowTabDefinition<TabId>[],
): WindowWorkspaceState<TabId> {
  const next = openTabInWorkspace(state, targetSlotId, tabId, definitions);
  return setWorkspaceSlotCollapsed(next, targetSlotId, false);
}

export function setWorkspaceSlotSize<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  slotId: WindowSlotId,
  size: { width?: number | null; height?: number | null },
): WindowWorkspaceState<TabId> {
  const next = cloneWorkspaceState(state);
  if (size.width !== undefined) {
    next[slotId].width = size.width;
  }
  if (size.height !== undefined) {
    next[slotId].height = size.height;
  }
  return next;
}
