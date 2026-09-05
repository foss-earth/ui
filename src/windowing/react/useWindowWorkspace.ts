import { useCallback, useMemo, useState } from "react";
import {
  allWorkspaceOpenTabs,
  closeTabInWorkspace,
  createWindowWorkspaceState,
  openTabInWorkspace,
  selectTabInWorkspace,
  setWorkspaceSlotCollapsed,
  setWorkspaceSlotSize,
} from "../core/workspaceState";
import type {
  WindowSlotId,
  WindowTabDefinition,
  WindowWorkspaceState,
} from "../core/types";

export interface UseWindowWorkspaceOptions<TabId extends string> {
  initialState?: Partial<WindowWorkspaceState<TabId>>;
  primaryTabs?: TabId[];
  secondaryTabs?: TabId[];
  primaryCollapsed?: boolean;
  secondaryCollapsed?: boolean;
}

export interface WindowWorkspaceController<TabId extends string> {
  state: WindowWorkspaceState<TabId>;
  setState: React.Dispatch<React.SetStateAction<WindowWorkspaceState<TabId>>>;
  allOpenTabs: TabId[];
  openTab: (
    slotId: WindowSlotId,
    tabId: TabId,
    definitions: readonly WindowTabDefinition<TabId>[],
  ) => void;
  closeTab: (slotId: WindowSlotId, tabId: TabId) => void;
  selectTab: (slotId: WindowSlotId, tabId: TabId) => void;
  setCollapsed: (slotId: WindowSlotId, collapsed: boolean) => void;
  setSize: (
    slotId: WindowSlotId,
    size: { width?: number | null; height?: number | null },
  ) => void;
}

export function useWindowWorkspace<TabId extends string>(
  options: UseWindowWorkspaceOptions<TabId> = {},
): WindowWorkspaceController<TabId> {
  const [state, setState] = useState<WindowWorkspaceState<TabId>>(() => {
    const primary: Partial<WindowWorkspaceState<TabId>["primary"]> = {
      ...(options.initialState?.primary ?? {}),
    };
    if (options.primaryTabs !== undefined) {
      primary.tabs = options.primaryTabs;
    }
    if (options.primaryCollapsed !== undefined) {
      primary.collapsed = options.primaryCollapsed;
    }

    const secondary: Partial<WindowWorkspaceState<TabId>["secondary"]> = {
      ...(options.initialState?.secondary ?? {}),
    };
    if (options.secondaryTabs !== undefined) {
      secondary.tabs = options.secondaryTabs;
    }
    if (options.secondaryCollapsed !== undefined) {
      secondary.collapsed = options.secondaryCollapsed;
    }

    return createWindowWorkspaceState<TabId>({
      primary,
      secondary,
    });
  });

  const openTab = useCallback((
    slotId: WindowSlotId,
    tabId: TabId,
    definitions: readonly WindowTabDefinition<TabId>[],
  ) => {
    setState((current) => openTabInWorkspace(current, slotId, tabId, definitions));
  }, []);

  const closeTab = useCallback((slotId: WindowSlotId, tabId: TabId) => {
    setState((current) => closeTabInWorkspace(current, slotId, tabId));
  }, []);

  const selectTab = useCallback((slotId: WindowSlotId, tabId: TabId) => {
    setState((current) => selectTabInWorkspace(current, slotId, tabId));
  }, []);

  const setCollapsed = useCallback((slotId: WindowSlotId, collapsed: boolean) => {
    setState((current) => setWorkspaceSlotCollapsed(current, slotId, collapsed));
  }, []);

  const setSize = useCallback((
    slotId: WindowSlotId,
    size: { width?: number | null; height?: number | null },
  ) => {
    setState((current) => setWorkspaceSlotSize(current, slotId, size));
  }, []);

  const allOpenTabs = useMemo(() => allWorkspaceOpenTabs(state), [state]);

  return {
    state,
    setState,
    allOpenTabs,
    openTab,
    closeTab,
    selectTab,
    setCollapsed,
    setSize,
  };
}
