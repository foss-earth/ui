import { availableWindowTabs } from "../windowing/core/tabRules.js";
import { moveTabsBetweenWorkspaceSlots, openOrSelectTabInWorkspace, slotIdForOpenTab } from "../windowing/core/workspaceState.js";
import type { WindowSlotId, WindowSlotState, WindowTabDefinition, WindowWorkspaceState } from "../windowing/core/types.js";

type SlotPresentation<TabId extends string> = Pick<WindowSlotState<TabId>, "activeTab" | "collapsed">;

/**
 * What folding changed. `primary` is the window whose tabs moved and `secondary`
 * the one they joined, as for a fold into the right window; a fold into the left
 * window (`into: "primary"`) records them the other way round.
 */
export interface CompactWorkspaceMemory<TabId extends string> {
  into: WindowSlotId;
  primary: SlotPresentation<TabId> & { tabs: TabId[] };
  secondary: SlotPresentation<TabId>;
  foldedSecondary: SlotPresentation<TabId>;
}

/** The workspace with its windows swapped, so a fold into the left window works as one into the right. */
function mirror<TabId extends string>(state: WindowWorkspaceState<TabId>): WindowWorkspaceState<TabId> {
  return { primary: state.secondary, secondary: state.primary };
}

/** Temporarily combine the tabs in one window, the right unless `into` says, retaining their homes for the next wide layout. */
export function foldWorkspace<TabId extends string>(state: WindowWorkspaceState<TabId>, into: WindowSlotId = "secondary"): {
  state: WindowWorkspaceState<TabId>;
  memory: CompactWorkspaceMemory<TabId>;
} {
  if (into === "primary") {
    const folded = foldWorkspace(mirror(state));
    return { state: mirror(folded.state), memory: { ...folded.memory, into } };
  }
  const folded = moveTabsBetweenWorkspaceSlots(state, "primary", "secondary");
  const secondary = folded === state ? state.secondary : {
    ...folded.secondary,
    collapsed: !(
      (state.primary.tabs.length > 0 && !state.primary.collapsed)
      || (state.secondary.tabs.length > 0 && !state.secondary.collapsed)
    ),
  };
  return {
    state: folded === state ? state : { ...folded, secondary },
    memory: {
      into,
      primary: {
        tabs: [...state.primary.tabs],
        activeTab: state.primary.activeTab,
        collapsed: state.primary.collapsed,
      },
      secondary: { activeTab: state.secondary.activeTab, collapsed: state.secondary.collapsed },
      foldedSecondary: { activeTab: secondary.activeTab, collapsed: secondary.collapsed },
    },
  };
}

/** Restore surviving borrowed tabs; new tabs and explicit moves keep their homes. */
export function restoreWorkspace<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  memory: CompactWorkspaceMemory<TabId>,
): WindowWorkspaceState<TabId> {
  if (memory.into === "primary") return mirror(restoreWorkspace(mirror(state), { ...memory, into: "secondary" }));
  const restoredTabs = memory.primary.tabs.filter((tabId) => (
    state.secondary.tabs.includes(tabId) && !state.primary.tabs.includes(tabId)
  ));
  if (restoredTabs.length === 0) return state;

  const restored = new Set(restoredTabs);
  const primaryTabs = [...state.primary.tabs, ...restoredTabs];
  const secondaryTabs = state.secondary.tabs.filter((tabId) => !restored.has(tabId));
  const primaryActive = state.primary.activeTab ?? memory.primary.activeTab;
  const secondaryActive = state.secondary.activeTab && secondaryTabs.includes(state.secondary.activeTab)
    ? state.secondary.activeTab
    : memory.secondary.activeTab;
  const selectedRightTab = state.secondary.activeTab !== memory.foldedSecondary.activeTab
    && state.secondary.activeTab !== null
    && secondaryTabs.includes(state.secondary.activeTab);
  return {
    primary: {
      ...state.primary,
      tabs: primaryTabs,
      activeTab: primaryActive && primaryTabs.includes(primaryActive)
        ? primaryActive
        : primaryTabs[primaryTabs.length - 1] ?? null,
      collapsed: state.primary.tabs.length > 0 ? state.primary.collapsed : memory.primary.collapsed,
    },
    secondary: {
      ...state.secondary,
      tabs: secondaryTabs,
      activeTab: secondaryActive && secondaryTabs.includes(secondaryActive)
        ? secondaryActive
        : secondaryTabs[secondaryTabs.length - 1] ?? null,
      collapsed: !selectedRightTab && state.secondary.collapsed === memory.foldedSecondary.collapsed
        ? memory.secondary.collapsed
        : state.secondary.collapsed,
    },
  };
}

/** Call after a successful close or explicit move so reopening starts a new home. */
export function forgetCompactWorkspaceTab<TabId extends string>(
  memory: CompactWorkspaceMemory<TabId>,
  tabId: TabId,
): CompactWorkspaceMemory<TabId> {
  return {
    ...memory,
    primary: {
      ...memory.primary,
      tabs: memory.primary.tabs.filter((tab) => tab !== tabId),
      activeTab: memory.primary.activeTab === tabId ? null : memory.primary.activeTab,
    },
    secondary: {
      ...memory.secondary,
      activeTab: memory.secondary.activeTab === tabId ? null : memory.secondary.activeTab,
    },
  };
}

/**
 * Opens a tab for one side while that side is folded into the other window:
 * it shows in the window that is there, and goes home to `slotId`, selected,
 * when the width returns. A tab already open is selected where it is.
 */
export function openTabInCompactWorkspace<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  memory: CompactWorkspaceMemory<TabId>,
  tabId: TabId,
  slotId: WindowSlotId,
  definitions: readonly WindowTabDefinition<TabId>[],
): { state: WindowWorkspaceState<TabId>; memory: CompactWorkspaceMemory<TabId> } {
  if (!availableWindowTabs(definitions).includes(tabId)) return { state, memory };
  const existing = slotIdForOpenTab(state, tabId) !== null;
  const opened = openOrSelectTabInWorkspace(state, tabId, memory.into, definitions);
  if (existing || slotId === memory.into) return { state: opened, memory };
  return {
    state: opened,
    memory: { ...memory, primary: { ...memory.primary, tabs: [...memory.primary.tabs, tabId], activeTab: tabId } },
  };
}
