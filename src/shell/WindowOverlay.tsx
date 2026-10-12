import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { openOrSelectTabInWorkspace, closeTabInWorkspace, setWorkspaceSlotCollapsed, setWorkspaceSlotSize, slotIdForOpenTab } from "../windowing/core/workspaceState.js";
import { WorkspaceDockSlot } from "../windowing/react/WorkspaceDockSlot.js";
import { useWindowWorkspace } from "../windowing/react/useWindowWorkspace.js";
import type { WindowTabDefinition, WindowWorkspaceState, WindowSlotId } from "../windowing/core/types.js";
import type { SettingsStorage } from "../settings/registry.js";
import { loadSavedWorkspace, saveWorkspace } from "../browser/workspace.js";
import { browserOverlayGeometry } from "../browser/overlay.js";
import { resolveDockLayout, type DockLayoutMode, type DockResizePriority, type DockSide } from "./dockLayout.js";
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
  shown: WindowSlotId | "both",
  policy: OverlayContextPolicy<TabId>,
): { state: WindowWorkspaceState<TabId>; hidden: HiddenTab<TabId>[] } {
  const hidden = hideWorkspaceTabs(state, policy.contextOnlyTabs);
  const restored = restoreWorkspaceTabs(hidden.state, memory.base, shown);
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
  const [stackHeight, setStackHeight] = useState(30);
  // A window widened out of two, which stays alone on its side until narrowed back (resolveDockLayout).
  const [widened, setWidened] = useState<DockSide | null>(null);

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
    stackHeight,
    widened: widened ?? undefined,
  });
  // The windows on screen: both, or the one there is room for, which holds the other's tabs meanwhile.
  const shown: WindowSlotId | "both" = layout.mode === "dual" ? "both" : layout.side === "left" ? "primary" : "secondary";
  const preferredSlot: WindowSlotId = shown === "both" ? "primary" : shown;
  const visibleTabs = new Set<TabId>();
  for (const slot of shown === "both" ? [workspace.state.primary, workspace.state.secondary] : [workspace.state[shown]]) {
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
  // A resize of one of two windows names it (resizeWindow); that holds only if the other no longer fits.
  if (layout.mode === "dual" && widened !== null) setWidened(null);

  const resizeWindow = (slotId: WindowSlotId, width: number): void => {
    setResizePriority("windows");
    // Widened past the room for both, a window stays on its side and the log moves beside it, then under it.
    if (layout.mode === "dual") setWidened(slotId === "primary" ? "left" : "right");
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

  const stackSlot = workspace.state[layout.side === "left" ? "primary" : "secondary"];
  useLayoutEffect(() => {
    if (layout.mode !== "stacked" || availableWidth <= 0) return;
    const dock = overlayRef.current?.querySelector<HTMLElement>(`.foss-earth-dock-panel[data-side=${layout.side}], .foss-earth-workspace-slot-launcher-${layout.side}`);
    if (!dock) return;
    if (geometry.observeHeight) return geometry.observeHeight(dock, setStackHeight);
    const view = dock.ownerDocument.defaultView;
    return view ? browserOverlayGeometry(view, geometry.menuBottom).observeHeight!(dock, setStackHeight) : undefined;
  }, [geometry, availableWidth, layout.mode, layout.side, stackSlot.collapsed, stackSlot.activeTab, stackSlot.tabs.length]);

  useLayoutEffect(() => { layoutPort.publish(layout); }, [layoutPort, layout.mode, layout.side, layout.primaryWidth, layout.secondaryWidth, layout.logLeft, layout.logTop, layout.logCenter, layout.logWidth, layout.maxWindowWidth]);
  useLayoutEffect(() => {
    if (availableWidth <= 0) return;
    let state = workspace.state;
    const memory = compactMemory.current;
    if (memory && memory.into !== shown) {
      compactMemory.current = null;
      state = restoreWorkspace(state, memory);
    }
    if (shown !== "both" && !compactMemory.current) {
      const folded = foldWorkspace(state, shown);
      compactMemory.current = folded.memory;
      state = folded.state;
    }
    if (state !== workspace.state) workspace.setState(state);
  }, [availableWidth, shown, workspace]);

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
  const contextVisit = useRef(0);
  useLayoutEffect(() => {
    if (contextShown.current === inContext) return;
    contextShown.current = inContext;
    const memory = contextMemory.current;
    if (inContext) {
      contextVisit.current += 1;
      const hidden = hideWorkspaceTabs(workspace.state, context.baseOnlyTabs);
      memory.base = hidden.hidden;
      const restored = restoreWorkspaceTabs(hidden.state, memory.context, shown);
      memory.context = [];
      const slotId = slotIdForOpenTab(restored, context.entryTabId) ?? preferredSlot;
      memory.opened = { slotId, collapsed: restored[slotId].collapsed };
      const opened = openOrSelectTabInWorkspace(restored, context.entryTabId, preferredSlot, tabDefinitions);
      // While the camera flies in, the panel stays out of the way of the map it flies over.
      memory.arriving = !context.ready;
      workspace.setState(memory.arriving ? setWorkspaceSlotCollapsed(opened, slotId, true) : opened);
      return;
    }
    memory.arriving = false;
    const left = baseWorkspace(workspace.state, memory, shown, context);
    memory.context = left.hidden;
    memory.base = [];
    memory.opened = null;
    workspace.setState(left.state);
  }, [inContext, context.ready, shown, workspace]);

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
  // panorama is left, then tabs folded into one window go back to their homes,
  // so a reload outside the panorama or into another width starts from the
  // person's own layout. Written only when the workspace changes.
  useEffect(() => {
    const onGlobe = inContext ? baseWorkspace(workspace.state, contextMemory.current, "both", context).state : workspace.state;
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
        preferredSlot,
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


  // The window with the log under it is at most half the screen tall; a phone's fills the row, so only its height changes.
  const stackedPanel = layout.mode === "stacked"
    ? { expandedMaxHeightCss: "50dvh", resizeAxes: layout.windowWidthFixed ? "height" as const : "both" as const }
    : undefined;
  const panelProps = (slotId: WindowSlotId) => ({
    ...(layout.side === (slotId === "primary" ? "left" : "right") ? stackedPanel : undefined),
    ...(inContext && context.ready && context.measureEntry && workspace.state[slotId].activeTab === context.entryTabId
      ? { contentFit: { key: contextVisit.current, measure: context.measureEntry } }
      : {}),
  });

  return (
    <div ref={setOverlay} className="foss-earth-window-overlay">
      <WorkspaceDockSlot<TabId>
        side="left"
        slotId="primary"
        visible={shown !== "secondary"}
        workspaceState={workspace.state}
        onWorkspaceStateChange={updateWorkspace}
        onWidthChange={(width) => resizeWindow("primary", width)}
        tabDefinitions={tabDefinitions}
        getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
        renderTabContent={renderTabContent}
        restoreOnTabSelect
        width={layout.primaryWidth}
        maxWidth={layout.maxWindowWidth}
        dockPanelProps={panelProps("primary")}
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
        dockPanelProps={panelProps("secondary")}
        addMenuOpen={secondaryAddOpen}
        onAddMenuOpenChange={(open) => { setSecondaryAddOpen(open); if (open) setPrimaryAddOpen(false); }}
        visible={shown !== "primary"}
        strings={{ openPanelTabAriaLabel: "Open right panel", openPanelTabTitle: "Open right panel" }}
        onBeforeCloseTab={beforeCloseTab}
        menuContainer={overlayElement}
        menuBottom={geometry.menuBottom}
      />
    </div>
  );
}
