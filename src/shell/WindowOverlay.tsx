import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { openOrSelectTabInWorkspace, closeTabInWorkspace, setWorkspaceSlotCollapsed, setWorkspaceSlotSize, slotIdForOpenTab } from "../windowing/core/workspaceState.js";
import { WorkspaceDockSlot } from "../windowing/react/WorkspaceDockSlot.js";
import { useWindowWorkspace } from "../windowing/react/useWindowWorkspace.js";
import type { WindowTabDefinition, WindowWorkspaceState, WindowSlotId } from "../windowing/core/types.js";
import type { SettingsStorage } from "../settings/registry.js";
import { loadSavedWorkspace, saveWorkspace } from "../browser/workspace.js";
import { resolveDockLayout, type DockLayoutMode, type DockResizePriority } from "./dockLayout.js";
import { foldWorkspace, restoreWorkspace, forgetCompactWorkspaceTab, type CompactWorkspaceMemory } from "./compactWorkspace.js";
import { hideWorkspaceTabs, restoreWorkspaceTabs, type HiddenTab } from "../windowing/core/contextTabs.js";
import type { OverlayContextPolicy, WindowOverlayHandle, WindowOverlayGeometry, WindowOverlayLogSize, WindowOverlayLayoutPort } from "../windowing/core/overlayPorts.js";
export type { OverlayContextPolicy, WindowOverlayHandle, WindowOverlayGeometry, WindowOverlayLogSize, WindowOverlayLayoutPort } from "../windowing/core/overlayPorts.js";
export interface WindowOverlayProps<TabId extends string> {
  tabDefinitions: readonly WindowTabDefinition<TabId>[];
  renderTabContent(tabId: TabId): ReactNode;
  context: OverlayContextPolicy<TabId>;
  restorableTabs: ReadonlySet<TabId>;
  storage: SettingsStorage | null;
  geometry: WindowOverlayGeometry;
  logSize: WindowOverlayLogSize;
  layoutPort: WindowOverlayLayoutPort;
  onTabVisibility?(tabId: TabId, visible: boolean): void;
  overlayApiRef?: { current: WindowOverlayHandle<TabId> | null };
  onBeforeCloseTab?(tabId: TabId): boolean | void;
  focus?: { onOpen?(tabId: TabId): void; onClose?(tabId: TabId): void };
}
/** Where the tabs a context hid are, so each comes back where it was when its context returns. */
interface OverlayContextMemory<TabId extends string> {
  base: HiddenTab<TabId>[];
  context: HiddenTab<TabId>[];
  /** The slot the panorama's tab opened in, and whether it was collapsed before. */
  opened: { slotId: WindowSlotId; collapsed: boolean } | null;
  /** The panorama's tab opened minimized, and shows when the panorama is on screen. */
  arriving: boolean;
}

/**
 * The workspace as leaving a panorama leaves it: the panorama's tabs hidden,
 * the map's back where they were, and the panel the panorama's tab opened as
 * it was, if that tab was what it showed. Changes nothing in `memory`.
 */
function baseWorkspace<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  memory: OverlayContextMemory<TabId>,
  primaryAvailable: boolean,
  policy: OverlayContextPolicy<TabId>,
): { state: WindowWorkspaceState<TabId>; hidden: HiddenTab<TabId>[] } {
  const hidden = hideWorkspaceTabs(state, policy.contextOnlyTabs);
  const restored = restoreWorkspaceTabs(hidden.state, memory.base, primaryAvailable);
  const opened = memory.opened;
  const panelBack = opened && hidden.hidden.some((entry) => entry.tabId === policy.entryTabId && entry.slotId === opened.slotId && entry.active);
  return { state: panelBack ? setWorkspaceSlotCollapsed(restored, opened.slotId, opened.collapsed) : restored, hidden: hidden.hidden };
}

export function WindowOverlay<TabId extends string>({ tabDefinitions: suppliedTabs, renderTabContent, context, restorableTabs, storage, geometry, logSize, layoutPort, onTabVisibility, overlayApiRef, onBeforeCloseTab, focus }: WindowOverlayProps<TabId>) {
  const inContext = context.active;
  const tabDefinitions = suppliedTabs.map(tab => ({ ...tab, available: tab.available !== false && (context.contextOnlyTabs.has(tab.id) ? inContext : !(inContext && context.baseOnlyTabs.has(tab.id))) }));
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // The tab strips' + menus are drawn here, outside the panels that would clip them.
  const [overlayElement, setOverlayElement] = useState<HTMLDivElement | null>(null);
  const setOverlay = useCallback((element: HTMLDivElement | null) => {
    overlayRef.current = element;
    setOverlayElement(element);
  }, []);
  const [savedWorkspace] = useState(() => loadSavedWorkspace(restorableTabs, storage));
  const workspace = useWindowWorkspace<TabId>(savedWorkspace ? { initialState: savedWorkspace } : {});
  const compactMemory = useRef<CompactWorkspaceMemory<TabId> | null>(null);
  const forgetClosedTabs = (next: WindowWorkspaceState<TabId>): void => {
    if (!compactMemory.current) return;
    for (const tabId of compactMemory.current.primary.tabs) {
      if (!next.primary.tabs.includes(tabId) && !next.secondary.tabs.includes(tabId)) {
        compactMemory.current = forgetCompactWorkspaceTab(compactMemory.current, tabId);
      }
    }
  };
  const updateWorkspace = (next: WindowWorkspaceState<TabId>): void => {
    forgetClosedTabs(next);
    workspace.setState(next);
  };
  const [logWidth, setLogWidth] = useState<number | null>(() => logSize.getWidth());
  const [resizePriority, setResizePriority] = useState<DockResizePriority>(logWidth === null ? "windows" : "log");
  const [layoutMode, setLayoutMode] = useState<DockLayoutMode>("single");
  useLayoutEffect(() => logSize.subscribe(({ width, resized }) => {
    setLogWidth(width); if (resized) setResizePriority("log");
  }), [logSize]);
  const [primaryAddOpen, setPrimaryAddOpen] = useState(false);
  const [secondaryAddOpen, setSecondaryAddOpen] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);

  useLayoutEffect(() => {
    const element = overlayRef.current;
    return element ? geometry.observeWidth(element, setAvailableWidth) : undefined;
  }, [geometry]);

  const layout = resolveDockLayout({
    availableWidth,
    primaryWidth: workspace.state.primary.width ?? 320,
    secondaryWidth: workspace.state.secondary.width ?? 320,
    logWidth,
    priority: resizePriority,
    previousMode: layoutMode,
  });
  const primaryAvailable = layout.mode === "dual";
  const visibleTabs = new Set<TabId>();
  for (const slot of primaryAvailable ? [workspace.state.primary, workspace.state.secondary] : [workspace.state.secondary]) {
    if (!slot.collapsed && slot.activeTab !== null) visibleTabs.add(slot.activeTab);
  }
  const previouslyVisible = useRef<ReadonlySet<TabId>>(new Set());
  const visibilityCallback = useRef(onTabVisibility);
  visibilityCallback.current = onTabVisibility;
  useLayoutEffect(() => {
    for (const tab of previouslyVisible.current) if (!visibleTabs.has(tab)) onTabVisibility?.(tab, false);
    for (const tab of visibleTabs) if (!previouslyVisible.current.has(tab)) onTabVisibility?.(tab, true);
    previouslyVisible.current = visibleTabs;
  });
  // Remember actual transitions so resizing a single right window cannot force
  // a wide log into the center by shrinking it solely to create another window.
  if (layoutMode !== layout.mode) setLayoutMode(layout.mode);

  const resizeWindow = (slotId: WindowSlotId, width: number): void => {
    setResizePriority("windows");
    workspace.setState((current) => {
      // Start from what the user sees when switching from resizing the log.
      // Otherwise an untouched dock can jump back to its old preferred width.
      const other = slotId === "primary" ? "secondary" : "primary";
      const baseline = resizePriority === "log"
        ? setWorkspaceSlotSize(current, other, { width: other === "primary" ? layout.primaryWidth : layout.secondaryWidth })
        : current;
      return setWorkspaceSlotSize(baseline, slotId, { width });
    });
  };

  useLayoutEffect(() => { layoutPort.publish(layout); }, [layoutPort, layout.mode, layout.primaryWidth, layout.secondaryWidth, layout.logLeft, layout.logCenter, layout.logWidth, layout.maxWindowWidth]);
  useLayoutEffect(() => {
    if (availableWidth <= 0) return;
    if (!primaryAvailable && !compactMemory.current) {
      const folded = foldWorkspace(workspace.state);
      compactMemory.current = folded.memory;
      workspace.setState(folded.state);
    } else if (primaryAvailable && compactMemory.current) {
      const memory = compactMemory.current;
      compactMemory.current = null;
      workspace.setState(restoreWorkspace(workspace.state, memory));
    }
  }, [availableWidth, primaryAvailable, workspace]);

  useLayoutEffect(() => () => {
    layoutPort.clear();
    for (const tab of previouslyVisible.current) visibilityCallback.current?.(tab, false);
    previouslyVisible.current = new Set();
  }, [layoutPort]);

  // Entering a panorama hides the tabs about the map and opens the panorama's
  // tab; leaving hides the panorama's tabs. Each hidden tab comes back where
  // it was when its context returns.
  const contextMemory = useRef<OverlayContextMemory<TabId>>({ base: [], context: [], opened: null, arriving: false });
  const contextShown = useRef(false);
  useLayoutEffect(() => {
    if (contextShown.current === inContext) return;
    contextShown.current = inContext;
    const memory = contextMemory.current;
    const preferred: WindowSlotId = primaryAvailable ? "primary" : "secondary";
    if (inContext) {
      const hidden = hideWorkspaceTabs(workspace.state, context.baseOnlyTabs);
      memory.base = hidden.hidden;
      const restored = restoreWorkspaceTabs(hidden.state, memory.context, primaryAvailable);
      memory.context = [];
      const slotId = slotIdForOpenTab(restored, context.entryTabId) ?? preferred;
      memory.opened = { slotId, collapsed: restored[slotId].collapsed };
      const opened = openOrSelectTabInWorkspace(restored, context.entryTabId, preferred, tabDefinitions);
      // While the camera flies in, the panel stays out of the way of the map it flies over.
      memory.arriving = !context.ready;
      workspace.setState(memory.arriving ? setWorkspaceSlotCollapsed(opened, slotId, true) : opened);
      return;
    }
    memory.arriving = false;
    const left = baseWorkspace(workspace.state, memory, primaryAvailable, context);
    memory.context = left.hidden;
    memory.base = [];
    memory.opened = null;
    workspace.setState(left.state);
  }, [inContext, context.ready, primaryAvailable, workspace]);

  // The panorama on screen: its tab shows, unless the person chose otherwise
  // meanwhile, by showing it themselves or picking another tab in its panel.
  useLayoutEffect(() => {
    const memory = contextMemory.current;
    if (!inContext || !context.ready || !memory.arriving) return;
    memory.arriving = false;
    const slotId = slotIdForOpenTab(workspace.state, context.entryTabId);
    if (slotId && workspace.state[slotId].activeTab === context.entryTabId && workspace.state[slotId].collapsed) {
      workspace.setState(setWorkspaceSlotCollapsed(workspace.state, slotId, false));
    }
  }, [inContext, context.ready, workspace]);

  // Save the workspace as a wide window on the globe would show it: a
  // panorama is left, then tabs folded onto the right go back to their homes,
  // so a reload outside the panorama or into another width starts from the
  // person's own layout. Written only when the workspace changes.
  useEffect(() => {
    const onGlobe = inContext ? baseWorkspace(workspace.state, contextMemory.current, true, context).state : workspace.state;
    saveWorkspace(compactMemory.current ? restoreWorkspace(onGlobe, compactMemory.current) : onGlobe, storage);
  }, [workspace.state, inContext]);

  // Closing the panorama's tab leaves the panorama, as Escape does.
  const beforeCloseTab = (tabId: TabId): boolean | void => {
    if (onBeforeCloseTab?.(tabId) === false) return false;
    focus?.onClose?.(tabId);
  };

  // Refresh the imperative API with the committed workspace and layout each render.
  useLayoutEffect(() => {
    if (!overlayApiRef) return;
    const openOrSelectTab = (tabId: TabId): void => {
      if (!tabDefinitions.some(tab => tab.id === tabId && tab.available !== false)) return;
      workspace.setState((current) => openOrSelectTabInWorkspace(
        current,
        tabId,
        primaryAvailable ? "primary" : "secondary",
        tabDefinitions,
      ));
      focus?.onOpen?.(tabId);
    };
    overlayApiRef.current = {
      openOrSelectTab,
      toggleTab(tabId) {
        const { state } = workspace;
        const slotId = slotIdForOpenTab(state, tabId);
        if (!slotId || state[slotId].activeTab !== tabId || state[slotId].collapsed) {
          openOrSelectTab(tabId);
          return;
        }
        // Closing from a toolbar button asks first, as the tab's own close button does.
        if (beforeCloseTab(tabId) === false) return;
        updateWorkspace(closeTabInWorkspace(state, slotId, tabId));
      },
    };
    return () => {
      overlayApiRef.current = null;
    };
  });


  return (
    <div ref={setOverlay} className="foss-earth-window-overlay">
      <WorkspaceDockSlot<TabId>
        side="left"
        slotId="primary"
        visible={primaryAvailable}
        workspaceState={workspace.state}
        onWorkspaceStateChange={updateWorkspace}
        onWidthChange={(width) => resizeWindow("primary", width)}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={layout.primaryWidth}
        maxWidth={layout.maxWindowWidth}
        addMenuOpen={primaryAddOpen}
        onAddMenuOpenChange={(open) => { setPrimaryAddOpen(open); if (open) setSecondaryAddOpen(false); }}
        strings={{ openPanelTabAriaLabel: "Open left panel", openPanelTabTitle: "Open left panel" }}
        onBeforeCloseTab={beforeCloseTab}
        menuContainer={overlayElement}
        menuBottom={geometry.menuBottom}
      />
      <WorkspaceDockSlot<TabId>
        side="right"
        slotId="secondary"
        workspaceState={workspace.state}
        onWorkspaceStateChange={updateWorkspace}
        onWidthChange={(width) => resizeWindow("secondary", width)}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={layout.secondaryWidth}
        maxWidth={layout.maxWindowWidth}
        addMenuOpen={secondaryAddOpen}
        onAddMenuOpenChange={(open) => { setSecondaryAddOpen(open); if (open) setPrimaryAddOpen(false); }}
        visible
        strings={{ openPanelTabAriaLabel: "Open right panel", openPanelTabTitle: "Open right panel" }}
        onBeforeCloseTab={beforeCloseTab}
        menuContainer={overlayElement}
        menuBottom={geometry.menuBottom}
      />
    </div>
  );
}
