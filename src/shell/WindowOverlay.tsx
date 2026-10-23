import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { openOrSelectTabInWorkspace, closeTabInWorkspace, placeTabInWorkspace, setWorkspaceSlotCollapsed, setWorkspaceSlotSize, slotIdForOpenTab } from "../windowing/core/workspaceState.js";
import { WorkspaceDockSlot } from "../windowing/react/WorkspaceDockSlot.js";
import { useWindowWorkspace } from "../windowing/react/useWindowWorkspace.js";
import type { WindowTabDefinition, WindowWorkspaceState, WindowSlotId } from "../windowing/core/types.js";
import type { SettingsStorage } from "../settings/registry.js";
import { loadSavedWorkspace, saveWorkspace } from "../browser/workspace.js";
import { browserOverlayGeometry, lowestSplitBand, publishSplitBand } from "../browser/overlay.js";
import { resolveDockLayout, type DockLayoutMode, type DockResizePriority, type DockSide, type ToolbarEdgeChoice, type WorldEdges, type WorldPresentationChoice } from "./dockLayout.js";
import { PresentationMenu } from "../windowing/react/presentationHold.js";
import { foldWorkspace, restoreWorkspace, forgetCompactWorkspaceTab, openTabInCompactWorkspace, type CompactWorkspaceMemory } from "./compactWorkspace.js";
import { surfaceParticipates } from "./imageCompact.js";
import { hideWorkspaceTabs, restoreWorkspaceTabs, type HiddenTab } from "../windowing/core/contextTabs.js";
import { createWorkspaceSnapshotStore, workspaceSnapshotFields } from "../windowing/core/workspaceSnapshot.js";
import { JoinedSurface } from "./JoinedSurface.js";
import { TabIcon } from "./TabIcon.js";
import { useSecondaryTouchClick } from "../windowing/react/useSecondaryTouchClick.js";
import type { OverlayContextPolicy, WindowOverlayHandle, WindowOverlayGeometry, WindowOverlayLogSize, WindowOverlayLayoutPort } from "../windowing/core/overlayPorts.js";
export type { OverlayContextPolicy, WindowOverlayHandle, WindowOverlayGeometry, WindowOverlayLogSize, WindowOverlayLayoutPort } from "../windowing/core/overlayPorts.js";
/** What a host draws when two surface tabs share one body. */
export interface WindowOverlaySurfaces<TabId extends string> {
  /** The body the two selected surface tabs share, under both tab strips and across the space between them. */
  renderJoined(tabs: { left: TabId; right: TabId }): ReactNode;
  /**
   * The tab that holds the log while it does not float. While surfaces are
   * joined the log stays a tab at every width; this tab is then placed, not
   * selected, on the side it last occupied, or the left.
   */
  logTab?: TabId;
}
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
  /**
   * Overlay floats the windows on a full-screen world. Split gives them the top
   * of the screen and draws the world only underneath. Overlay is the default
   * at every width; the legacy Auto choice also uses overlay.
   */
  presentation?: {
    choice: WorldPresentationChoice;
    onChoice(choice: "overlay" | "split"): void;
    /** @deprecated Ignored. The toolbar stays at the screen's bottom, outside the windows. */
    tabsBehindToolbar?: boolean;
    /** @deprecated Ignored. The toolbar stays at the screen's bottom at every width. */
    toolbarEdge?: ToolbarEdgeChoice;
    /**
     * Release keeps the drawing buffer until a split drag, or a browser-window
     * resize, ends. Live resizes it on every movement. Omitted stays live.
     */
    worldResize?: "live" | "release";
    /**
     * Flush puts the windows, their launchers and the toolbar on the screen's
     * edges, and keeps the log a tab. Inset is an explicit choice.
     */
    edges?: WorldEdges;
  };
  /** Joins two selected surface tabs of one group into one body. Without it each surface keeps its own window. */
  surfaces?: WindowOverlaySurfaces<TabId>;
  /** The + button opens a New tab picker by default; Dropdown is an explicit preference. */
  tabPicker?: "tab" | "dropdown";
  onTabPickerChange?(mode: "tab" | "dropdown"): void;
}
/** Where the tabs a context hid are, so each comes back where it was when its context returns. */
interface OverlayContextMemory<TabId extends string> {
  base: HiddenTab<TabId>[];
  context: HiddenTab<TabId>[];
  /** The slot the sphere's tab opened in, and whether it was collapsed before. */
  opened: { slotId: WindowSlotId; collapsed: boolean } | null;
}

/**
 * The workspace as leaving a sphere leaves it: the sphere's tabs hidden,
 * the map's back where they were, and the panel the sphere's tab opened as
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

export function WindowOverlay<TabId extends string>({ tabDefinitions: suppliedTabs, renderTabContent, context, restorableTabs, storage, geometry, logSize, layoutPort, onTabVisibility, overlayApiRef, onBeforeCloseTab, focus, presentation, surfaces, tabPicker = "tab", onTabPickerChange }: WindowOverlayProps<TabId>) {
  const secondaryTouchClick = useSecondaryTouchClick();
  // Effects that change the workspace mark it, so the snapshot waits for the state they lead to.
  const stateScheduled = useRef(false);
  useLayoutEffect(() => { stateScheduled.current = false; });
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
    let movedSides = false;
    for (const slotId of ["primary", "secondary"] as const) {
      const moved = next[slotId].tabs.filter(tabId => {
        const previous = slotIdForOpenTab(workspace.state, tabId);
        return previous !== null && previous !== slotId;
      });
      if (moved.length === 0) continue;
      movedSides = true;
      for (const tabId of moved) {
        if (compactMemory.current) compactMemory.current = forgetCompactWorkspaceTab(compactMemory.current, tabId);
      }
      setWidened(slotId === "primary" ? "left" : "right");
    }
    if (movedSides && compactMemory.current) {
      next = restoreWorkspace(next, compactMemory.current);
      compactMemory.current = null;
    }
    workspace.setState(next);
  };
  /** A workspace change made by an effect, before the snapshot of this render is committed. */
  const scheduleWorkspace = (next: WindowWorkspaceState<TabId>): void => {
    if (next === workspace.state) return;
    stateScheduled.current = true;
    workspace.setState(next);
  };
  /** The workspace as a wide screen shows it, with tabs folded into one window back on their own sides. */
  const canonicalWorkspace = (): WindowWorkspaceState<TabId> => (
    compactMemory.current ? restoreWorkspace(workspace.state, compactMemory.current) : workspace.state
  );
  const [focusedSide, setFocusedSide] = useState<WindowSlotId | null>(null);
  const [snapshots] = useState(() => createWorkspaceSnapshotStore<TabId>(workspaceSnapshotFields(workspace.state)));
  const activateSide = (slotId: WindowSlotId, tabId: TabId | null): void => {
    // A drop activates its destination before React has committed the move.
    const owner = tabId === null ? null : slotIdForOpenTab(workspace.state, tabId);
    setFocusedSide(owner !== null && owner !== slotId ? slotId
      : (tabId === null ? null : slotIdForOpenTab(canonicalWorkspace(), tabId)) ?? slotId);
  };
  const [logWidth, setLogWidth] = useState<number | null>(() => logSize.getWidth());
  const [resizePriority, setResizePriority] = useState<DockResizePriority>(logWidth === null ? "windows" : "log");
  const [layoutMode, setLayoutMode] = useState<DockLayoutMode>("columns");
  useLayoutEffect(() => logSize.subscribe(({ width, resized }) => {
    setLogWidth(width); if (resized) setResizePriority("log");
  }), [logSize]);
  const [primaryAddOpen, setPrimaryAddOpen] = useState(false);
  const [secondaryAddOpen, setSecondaryAddOpen] = useState(false);
  const pickerActive = (slotId: WindowSlotId): boolean => tabPicker === "tab" && (slotId === "primary" ? primaryAddOpen : secondaryAddOpen);
  const [availableWidth, setAvailableWidth] = useState(0);
  // A window keeps the same component and captured grip when its anchor changes.
  const [slotOrder, setSlotOrder] = useState<readonly WindowSlotId[]>(["primary", "secondary"]);
  const [tabDragSide, setTabDragSide] = useState<DockSide | null>(null);
  // Which window fills a phone. A resize on a wider screen records it; both windows stay until then.
  const [widened, setWidened] = useState<DockSide | null>(null);
  const [holdAt, setHoldAt] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const element = overlayRef.current;
    return element ? geometry.observeWidth(element, setAvailableWidth) : undefined;
  }, [geometry]);

  useEffect(() => {
    const view = overlayRef.current?.ownerDocument.defaultView;
    if (!view) return;
    const start = (event: Event): void => setTabDragSide((event as CustomEvent<{ side: DockSide }>).detail.side);
    const end = (): void => setTabDragSide(null);
    view.addEventListener("foss-earth-tab-drag-start", start);
    view.addEventListener("foss-earth-tab-drag-end", end);
    return () => {
      view.removeEventListener("foss-earth-tab-drag-start", start);
      view.removeEventListener("foss-earth-tab-drag-end", end);
    };
  }, []);

  const logical = canonicalWorkspace();
  const compactFocus = compactMemory.current?.into ?? focusedSide;
  const layoutInput = {
    availableWidth,
    primaryWidth: workspace.state.primary.width,
    secondaryWidth: workspace.state.secondary.width,
    logWidth,
    priority: resizePriority,
    previousMode: layoutMode,
    widened: widened ?? undefined,
    compactSide: compactFocus === null ? undefined : compactFocus === "primary" ? "left" as const : "right" as const,
    presentation: presentation?.choice,
    edges: presentation?.edges,
    open: { left: logical.primary.tabs.length > 0 || pickerActive("primary"), right: logical.secondary.tabs.length > 0 || pickerActive("secondary") },
  };
  // What the sizes alone choose. A join only keeps the log a tab, so ending it returns to this.
  const sized = resolveDockLayout(layoutInput);
  // Both windows, except on a phone, where the one there is room for holds the other's tabs meanwhile.
  const shown: WindowSlotId | "both" = sized.mode === "stacked" ? (sized.side === "left" ? "primary" : "secondary") : "both";
  // A participating image keeps both logical strips. Folding stays for every other narrow layout.
  const imageCompact = Boolean(surfaces) && sized.mode === "stacked" && surfaceParticipates(logical, tabDefinitions);
  // Undo a width-made fold before paint, so this render's strips are the logical sides.
  if (imageCompact && compactMemory.current) {
    const memory = compactMemory.current;
    compactMemory.current = null;
    workspace.setState(restoreWorkspace(workspace.state, memory));
  }
  const presented: WindowSlotId | "both" = imageCompact ? "both" : shown;
  const display = imageCompact ? logical : workspace.state;
  // Two shown surface tabs of one group share a body.
  const joinGroupOf = (tabId: TabId | null): string | undefined => (
    tabId === null ? undefined : tabDefinitions.find(tab => tab.id === tabId)?.surface?.joinGroup
  );
  const expandedTab = (slotId: WindowSlotId): TabId | null => (
    presented === "both" && !display[slotId].collapsed && !pickerActive(slotId) ? display[slotId].activeTab : null
  );
  const leftTab = expandedTab("primary");
  const rightTab = expandedTab("secondary");
  const joinGroup = surfaces && leftTab !== null && rightTab !== null ? joinGroupOf(leftTab) : undefined;
  const joined = joinGroup !== undefined && joinGroup === joinGroupOf(rightTab) ? { left: leftTab!, right: rightTab! } : null;
  // The log stays a tab while a join lasts, and afterwards while that tab is what a window shows.
  const logTab = surfaces?.logTab;
  const logTabShown = logTab !== undefined && (presented === "both" ? ["primary", "secondary"] as const : [presented])
    .some(slotId => !display[slotId].collapsed && !pickerActive(slotId) && display[slotId].activeTab === logTab);
  const [logHeld, setLogHeld] = useState(false);
  const holdLog = joined !== null || (logHeld && logTabShown);
  if (holdLog !== logHeld) setLogHeld(holdLog);
  const layout = holdLog && sized.mode === "dual" ? resolveDockLayout({ ...layoutInput, floatingLog: false }) : sized;
  const [joinedHeight, setJoinedHeight] = useState<number | null>(null);
  if (!joined && joinedHeight !== null) setJoinedHeight(null);
  const preferredSlot: WindowSlotId = presented === "both" ? "primary" : presented;
  const visibleTabs = new Set<TabId>();
  for (const slotId of presented === "both" ? ["primary", "secondary"] as const : [presented]) {
    const slot = display[slotId];
    if (!pickerActive(slotId) && !slot.collapsed && slot.activeTab !== null) visibleTabs.add(slot.activeTab);
  }
  const previouslyVisible = useRef<ReadonlySet<TabId>>(new Set());
  const visibilityCallback = useRef(onTabVisibility);
  visibilityCallback.current = onTabVisibility;
  useLayoutEffect(() => {
    for (const tab of previouslyVisible.current) if (!visibleTabs.has(tab)) onTabVisibility?.(tab, false);
    for (const tab of visibleTabs) if (!previouslyVisible.current.has(tab)) onTabVisibility?.(tab, true);
    previouslyVisible.current = visibleTabs;
  });
  // Remember actual transitions so a widened log stays a tab until its width fits again.
  if (layoutMode !== sized.mode) setLayoutMode(sized.mode);
  // Back in the wide arrangement, a phone uses the right window the next time it folds.
  if (sized.mode === "dual" && widened !== null) setWidened(null);

  const resizeWindow = (slotId: WindowSlotId, width: number): void => {
    setResizePriority("windows");
    // Remember which window fills the screen if it later becomes a phone.
    if (layout.mode === "dual" || layout.mode === "columns") setWidened(slotId === "primary" ? "left" : "right");
    workspace.setState((current) => {
      // Start from what the user sees when switching from resizing the log.
      // Otherwise an untouched dock can jump back to its old preferred width.
      const other = slotId === "primary" ? "secondary" : "primary";
      const baseline = resizePriority === "log"
        ? setWorkspaceSlotSize(current, other, { width: other === "primary" ? layout.primaryWidth : layout.secondaryWidth })
        : current;
      return setWorkspaceSlotSize(baseline, slotId, { width: layout.mode === "stacked" && width >= layout.maxWindowWidth ? null : width });
    });
  };

  // The window resized last keeps its width when both no longer fit, and the other gives way. A
  // reload no longer knows which that was and keeps the wider request, so when the window that
  // gave way asked for at least as much, the width it shows becomes its own.
  const shownLayout = useRef(layout);
  shownLayout.current = layout;
  const settleResize = (slotId: WindowSlotId): void => {
    const shown = shownLayout.current;
    if (shown.mode === "stacked" || shown.windowWidthFixed) return;
    const other = slotId === "primary" ? "secondary" : "primary";
    const width = (id: WindowSlotId): number => (id === "primary" ? shown.primaryWidth : shown.secondaryWidth);
    workspace.setState((current) => {
      const requested = current[other].width ?? 320;
      const gaveWay = width(other) < requested - 0.5 && requested >= (current[slotId].width ?? 320);
      return gaveWay ? setWorkspaceSlotSize(current, other, { width: width(other) }) : current;
    });
  };

  const primarySlot = workspace.state.primary;
  const secondarySlot = workspace.state.secondary;
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const root = overlay?.ownerDocument.documentElement;
    if (!root || layout.presentation !== "split" || availableWidth <= 0 || !overlay) {
      if (root) {
        publishSplitBand(root, null);
        root.style.removeProperty("--foss-canvas-top");
      }
      return;
    }
    const deferDraw = presentation?.worldResize === "release";
    const bands = (): HTMLElement[] => [...overlay.querySelectorAll<HTMLElement>(".foss-earth-dock-panel, .foss-earth-workspace-slot-launcher, .foss-earth-joined-surface")];
    let panelHeld = false;
    const publish = (): void => {
      publishSplitBand(root, lowestSplitBand(bands()));
      if (!deferDraw) {
        root.style.removeProperty("--foss-canvas-top");
        return;
      }
      // The world boundary follows the window. The drawing buffer waits out the drag.
      if (panelHeld || root.dataset.worldDrawHeld === "true") return;
      const top = root.style.getPropertyValue("--foss-world-top");
      if (top) root.style.setProperty("--foss-canvas-top", top);
      else root.style.removeProperty("--foss-canvas-top");
    };
    const view = overlay.ownerDocument.defaultView;
    const observeHeight = geometry.observeHeight ?? (view ? browserOverlayGeometry(view, geometry.menuBottom).observeHeight : undefined);
    const elements = bands();
    const onResizeStart = (): void => { panelHeld = true; };
    const onResizeEnd = (): void => { panelHeld = false; publish(); };
    if (deferDraw && view) {
      view.addEventListener("foss-earth-panel-resize-start", onResizeStart);
      view.addEventListener("foss-earth-panel-resize-end", onResizeEnd);
      view.addEventListener("foss-earth-world-draw-commit", onResizeEnd);
    }
    if (elements.length === 0 || !observeHeight) {
      publish();
      return () => {
        view?.removeEventListener("foss-earth-panel-resize-start", onResizeStart);
        view?.removeEventListener("foss-earth-panel-resize-end", onResizeEnd);
        view?.removeEventListener("foss-earth-world-draw-commit", onResizeEnd);
      };
    }
    const stops = elements.map(element => observeHeight(element, publish));
    return () => {
      for (const stop of stops) stop();
      view?.removeEventListener("foss-earth-panel-resize-start", onResizeStart);
      view?.removeEventListener("foss-earth-panel-resize-end", onResizeEnd);
      view?.removeEventListener("foss-earth-world-draw-commit", onResizeEnd);
    };
  }, [geometry, availableWidth, layout.presentation, layout.edges, presentation?.worldResize, primarySlot.collapsed, primarySlot.activeTab, primarySlot.tabs.length, secondarySlot.collapsed, secondarySlot.activeTab, secondarySlot.tabs.length, pickerActive("primary"), pickerActive("secondary"), joined !== null, joinedHeight !== null]);

  useLayoutEffect(() => { layoutPort.publish(layout); }, [layoutPort, layout.mode, layout.presentation, layout.edges, layout.logVisible, layout.side, layout.primaryWidth, layout.secondaryWidth, layout.logLeft, layout.logTop, layout.logCenter, layout.logWidth, layout.maxWindowWidth]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (presentation?.worldResize === "live" || presentation?.worldResize === "release") root.dataset.worldResize = presentation.worldResize;
    else delete root.dataset.worldResize;
    return () => {
      delete root.dataset.worldResize;
    };
  }, [presentation?.worldResize]);

  const definedIds = tabDefinitions.map((tab) => tab.id).join("\0");
  useLayoutEffect(() => {
    const known = new Set(definedIds.split("\0").filter(Boolean));
    let next = workspace.state;
    for (const slotId of ["primary", "secondary"] as const) {
      for (const tabId of next[slotId].tabs) {
        if (!known.has(tabId)) next = closeTabInWorkspace(next, slotId, tabId);
      }
    }
    scheduleWorkspace(next);
  }, [definedIds, workspace.state]);

  // A tab opened on a side as it was registered opens once its definition arrives.
  const pendingOpens = useRef(new Map<TabId, WindowSlotId>());
  const openInSlot = (tabId: TabId, slotId: WindowSlotId): void => {
    if (!tabDefinitions.some(tab => tab.id === tabId)) {
      pendingOpens.current.set(tabId, slotId);
      return;
    }
    pendingOpens.current.delete(tabId);
    if (!tabDefinitions.some(tab => tab.id === tabId && tab.available !== false)) return;
    setPrimaryAddOpen(false);
    setSecondaryAddOpen(false);
    const memory = compactMemory.current;
    const existing = slotIdForOpenTab(canonicalWorkspace(), tabId);
    if (memory) {
      const opened = openTabInCompactWorkspace(workspace.state, memory, tabId, slotId, tabDefinitions);
      compactMemory.current = opened.memory;
      workspace.setState(opened.state);
    } else {
      workspace.setState(current => openOrSelectTabInWorkspace(current, tabId, slotId, tabDefinitions));
    }
    setFocusedSide(existing ?? slotId);
    focus?.onOpen?.(tabId);
  };
  useLayoutEffect(() => {
    for (const [tabId, slotId] of [...pendingOpens.current]) {
      if (!tabDefinitions.some(tab => tab.id === tabId)) continue;
      if (tabDefinitions.some(tab => tab.id === tabId && tab.available !== false)) stateScheduled.current = true;
      openInSlot(tabId, slotId);
    }
  }, [definedIds]);

  // Where the log tab was last, so a join puts it back there. Only a tab the join placed leaves with it.
  const logHome = useRef<WindowSlotId>("primary");
  const logPlaced = useRef(false);
  useLayoutEffect(() => {
    if (logTab === undefined) return;
    const home = slotIdForOpenTab(canonicalWorkspace(), logTab);
    if (home) logHome.current = home;
    const where = slotIdForOpenTab(workspace.state, logTab);
    if (joined) {
      if (where || logPlaced.current || !tabDefinitions.some(tab => tab.id === logTab && tab.available !== false)) return;
      logPlaced.current = true;
      scheduleWorkspace(placeTabInWorkspace(workspace.state, logHome.current, logTab, tabDefinitions));
      return;
    }
    if (!logPlaced.current) return;
    logPlaced.current = false;
    if (where && workspace.state[where].activeTab !== logTab) {
      const next = closeTabInWorkspace(workspace.state, where, logTab);
      forgetClosedTabs(next);
      scheduleWorkspace(next);
    }
  });

  // After the log settles, so a join ending on a phone folds the workspace the log left.
  useLayoutEffect(() => {
    if (availableWidth <= 0) return;
    const memory = compactMemory.current;
    const needsRestore = memory !== null && (imageCompact || memory.into !== shown);
    const needsFold = !imageCompact && shown !== "both" && (memory === null || memory.into !== shown);
    if (!needsRestore && !needsFold) return;
    stateScheduled.current = true;
    workspace.setState(current => {
      let state = current;
      const remembered = compactMemory.current;
      // An image keeps each tab on its own side. Restoring here undoes a fold that width, not the person, made.
      if (imageCompact) {
        if (remembered) {
          compactMemory.current = null;
          state = restoreWorkspace(state, remembered);
        }
        return state;
      }
      if (remembered && remembered.into !== shown) {
        compactMemory.current = null;
        state = restoreWorkspace(state, remembered);
      }
      if (shown !== "both" && !compactMemory.current) {
        const folded = foldWorkspace(state, shown);
        compactMemory.current = folded.memory;
        state = folded.state;
      }
      return state;
    });
  }, [availableWidth, shown, imageCompact, workspace]);

  useLayoutEffect(() => () => {
    layoutPort.clear();
    publishSplitBand(document.documentElement, null);
    for (const tab of previouslyVisible.current) visibilityCallback.current?.(tab, false);
    previouslyVisible.current = new Set();
  }, [layoutPort]);

  // Leave the workspace alone during entry. Once inside, keep its existing
  // tabs and open the photograph only when no tabs remain in this context.
  const contextMemory = useRef<OverlayContextMemory<TabId>>({ base: [], context: [], opened: null });
  const contextShown = useRef(false);
  const contextVisit = useRef(0);
  useLayoutEffect(() => {
    // Choose the entry window after geometry has resolved the saved widths.
    if (availableWidth <= 0) return;
    if (inContext && !context.ready) return;
    if (contextShown.current === inContext) return;
    contextShown.current = inContext;
    const memory = contextMemory.current;
    if (inContext) {
      contextVisit.current += 1;
      const hidden = context.preserveOpenTabs
        ? { state: workspace.state, hidden: [] as HiddenTab<TabId>[] }
        : hideWorkspaceTabs(workspace.state, context.baseOnlyTabs);
      memory.base = hidden.hidden;
      let restored = restoreWorkspaceTabs(hidden.state, memory.context, presented);
      // Remembered photograph tabs return in the background when a tab is already selected.
      for (const slotId of ["primary", "secondary"] as const) {
        const activeTab = hidden.state[slotId].activeTab;
        if (activeTab !== null && restored[slotId].activeTab !== activeTab) {
          restored = { ...restored, [slotId]: { ...restored[slotId], activeTab } };
        }
      }
      memory.context = [];
      const hasTabs = restored.primary.tabs.length > 0 || restored.secondary.tabs.length > 0;
      if (hasTabs) scheduleWorkspace(restored);
      else {
        memory.opened = { slotId: preferredSlot, collapsed: restored[preferredSlot].collapsed };
        scheduleWorkspace(openOrSelectTabInWorkspace(restored, context.entryTabId, preferredSlot, tabDefinitions));
      }
      return;
    }
    const left = baseWorkspace(workspace.state, memory, presented, context);
    memory.context = left.hidden;
    memory.base = [];
    memory.opened = null;
    scheduleWorkspace(left.state);
  }, [availableWidth, inContext, context.ready, presented, workspace]);


  // Save the workspace as a wide window on the globe would show it: a
  // sphere is left, then tabs folded into one window go back to their homes,
  // so a reload outside the sphere or into another width starts from the
  // person's own layout. Written only when the workspace changes.
  useEffect(() => {
    const onGlobe = inContext ? baseWorkspace(workspace.state, contextMemory.current, "both", context).state : workspace.state;
    saveWorkspace(compactMemory.current ? restoreWorkspace(onGlobe, compactMemory.current) : onGlobe, storage);
  }, [workspace.state, inContext]);

  // Closing the sphere's tab leaves the sphere, as Escape does.
  const beforeCloseTab = (tabId: TabId): boolean | void => {
    if (onBeforeCloseTab?.(tabId) === false) return false;
    focus?.onClose?.(tabId);
  };

  // Refresh the imperative API with the committed workspace and layout each render.
  useLayoutEffect(() => {
    if (!overlayApiRef) return;
    const openOrSelectTab = (tabId: TabId): void => {
      if (!tabDefinitions.some(tab => tab.id === tabId && tab.available !== false)) return;
      setPrimaryAddOpen(false);
      setSecondaryAddOpen(false);
      workspace.setState((current) => openOrSelectTabInWorkspace(
        current,
        tabId,
        preferredSlot,
        tabDefinitions,
      ));
      focus?.onOpen?.(tabId);
    };
    const closeTab = (tabId: TabId): void => {
      const { state } = workspace;
      const slotId = slotIdForOpenTab(state, tabId);
      if (!slotId || !state[slotId].tabs.includes(tabId)) return;
      if (beforeCloseTab(tabId) === false) return;
      updateWorkspace(closeTabInWorkspace(state, slotId, tabId));
    };
    overlayApiRef.current = {
      openOrSelectTab,
      openTabInSlot: openInSlot,
      workspace: snapshots,
      toggleTab(tabId) {
        const { state } = workspace;
        const slotId = slotIdForOpenTab(state, tabId);
        // A New tab page covers its window's tab, so the tab is not showing yet.
        if (!slotId || state[slotId].activeTab !== tabId || state[slotId].collapsed || pickerActive(slotId)) {
          openOrSelectTab(tabId);
          return;
        }
        // Closing from a toolbar button asks first, as the tab's own close button does.
        closeTab(tabId);
      },
      closeTab,
    };
    return () => {
      overlayApiRef.current = null;
    };
  });

  // The committed logical workspace, once the effects above have settled it and the handle is current.
  useLayoutEffect(() => {
    if (stateScheduled.current) return;
    const memory = contextMemory.current;
    snapshots.commit(workspaceSnapshotFields(canonicalWorkspace(), {
      contextHidden: inContext ? memory.base : memory.context,
      focusedSide,
      compact: shown !== "both",
      contextActive: inContext,
    }));
  });


  const resizeAnchoredWindow = (slotId: WindowSlotId, side: DockSide, width: number): void => {
    const target: WindowSlotId = side === "left" ? "primary" : "secondary";
    if (target === slotId) {
      resizeWindow(slotId, width);
      return;
    }
    // Crossing full width is an explicit move of this window, including any
    // borrowed compact tabs. Its hidden context tabs follow it as well.
    compactMemory.current = null;
    const opposite = (id: WindowSlotId): WindowSlotId => id === "primary" ? "secondary" : "primary";
    const memory = contextMemory.current;
    memory.base = memory.base.map(entry => ({ ...entry, slotId: opposite(entry.slotId) }));
    memory.context = memory.context.map(entry => ({ ...entry, slotId: opposite(entry.slotId) }));
    if (memory.opened) memory.opened = { ...memory.opened, slotId: opposite(memory.opened.slotId) };
    logHome.current = opposite(logHome.current);
    for (const [tabId, id] of pendingOpens.current) pendingOpens.current.set(tabId, opposite(id));
    setSlotOrder(order => order.map(opposite));
    setFocusedSide(target);
    setWidened(side);
    setResizePriority("windows");
    setPrimaryAddOpen(false);
    setSecondaryAddOpen(false);
    workspace.setState(current => setWorkspaceSlotSize({ primary: current.secondary, secondary: current.primary }, target, {
      width: width >= layout.maxWindowWidth ? null : width,
    }));
  };

  // Flush windows meet the top and their side's edge.
  const flushPanel = layout.edges === "flush" ? { edgeOffsetPx: 0, topOffsetPx: "env(safe-area-inset-top, 0px)" } : undefined;
  // The grip changes the width exactly when the layout uses it, so its arrows cannot promise a
  // width the layout throws away. Only split fixes the width: that window touches the screen's
  // edges, and on a phone stays at most half the screen. A phone's overlay window keeps both
  // sizes, with the grip mid-bottom, away from the screen edge its corner would be on.
  const singlePanel = layout.windowWidthFixed
    ? {
        ...(layout.mode === "stacked" ? { expandedMaxHeightCss: "50dvh", maxHeightRatio: 0.5 } : {}),
        resizeAxes: "height" as const,
        edgeOffsetPx: 0,
        topOffsetPx: "env(safe-area-inset-top, 0px)",
      }
    : layout.mode === "stacked" ? { resizeGripAt: "bottom" as const, ...flushPanel } : flushPanel;
  const compactWidth = layout.side === "left" ? layout.primaryWidth : layout.secondaryWidth;
  const panelProps = (slotId: WindowSlotId) => ({
    initialHeight: display[slotId].height ?? 512,
    onHeightChange: (height: number) => workspace.setSize(slotId, { height }),
    liftResizeHandle: layout.presentation === "split",
    onResizeEnd: () => settleResize(slotId),
    ...(layout.mode === "stacked" && layout.presentation === "overlay" && !imageCompact
      ? { onResizeSideChange: (side: DockSide, width: number) => resizeAnchoredWindow(slotId, side, width) }
      : {}),
    ...(imageCompact
      ? {
          flow: true,
          edgeOffsetPx: 0,
          topOffsetPx: 0,
          resizeAxes: "height" as const,
          ...(layout.presentation === "split" ? { expandedMaxHeightCss: "50dvh", maxHeightRatio: 0.5 } : {}),
        }
      : layout.side === (slotId === "primary" ? "left" : "right") ? singlePanel : flushPanel),
    ...(inContext && context.ready && context.measureEntry && display[slotId].activeTab === context.entryTabId
      ? { contentFit: { key: contextVisit.current, measure: context.measureEntry } }
      : {}),
  });

  // A tab that shows its picture where the globe is carries a mark that tells it from the panels.
  const tabIcon = (tabId: TabId): ReactNode => {
    const icon = tabDefinitions.find(tab => tab.id === tabId)?.icon;
    return icon ? <TabIcon icon={icon} /> : null;
  };

  return (
    <div {...secondaryTouchClick} ref={setOverlay} className="foss-earth-window-overlay" data-image-compact={imageCompact ? "true" : undefined}>
      {slotOrder.map((slotId, identity) => {
        const primary = slotId === "primary";
        const side = primary ? "left" : "right";
        return <WorkspaceDockSlot<TabId>
          key={identity}
          side={side}
          slotId={slotId}
          visible={presented === "both" || presented === slotId || tabDragSide !== null}
          emptyDropActive={tabDragSide !== null && tabDragSide !== side}
          workspaceState={display}
          rowLabel={imageCompact ? (primary ? "Left" : "Right") : undefined}
          onWorkspaceStateChange={updateWorkspace}
          onWidthChange={(width) => resizeWindow(slotId, width)}
          tabDefinitions={tabDefinitions}
          getTabLabel={(tabId) => tabDefinitions.find((tab) => tab.id === tabId)?.label ?? tabId}
          renderTabIcon={tabIcon}
          renderTabContent={renderTabContent}
          tabPicker={tabPicker}
          onTabPickerChange={onTabPickerChange}
          restoreOnTabSelect
          width={imageCompact ? compactWidth : primary ? layout.primaryWidth : layout.secondaryWidth}
          maxWidth={layout.maxWindowWidth}
          dockPanelProps={panelProps(slotId)}
          addMenuOpen={primary ? primaryAddOpen : secondaryAddOpen}
          onAddMenuOpenChange={(open) => {
            if (primary) { setPrimaryAddOpen(open); if (open) setSecondaryAddOpen(false); }
            else { setSecondaryAddOpen(open); if (open) setPrimaryAddOpen(false); }
          }}
          strings={{ openPanelTabAriaLabel: `Open ${side} panel`, openPanelTabTitle: `Open ${side} panel` }}
          onBeforeCloseTab={beforeCloseTab}
          menuContainer={overlayElement}
          menuBottom={geometry.menuBottom}
          onHoldPresentation={presentation ? setHoldAt : undefined}
          joined={joined !== null}
          onActivate={(tabId) => activateSide(slotId, tabId)}
        />;
      })}
      {joined && surfaces && overlayElement ? (
        <JoinedSurface
          overlay={overlayElement}
          height={joinedHeight}
          onHeightChange={setJoinedHeight}
          menuBottom={geometry.menuBottom}
          presentation={layout.presentation}
          liftResizeHandle={layout.presentation === "split"}
        >
          {surfaces.renderJoined(joined)}
        </JoinedSurface>
      ) : null}
      {holdAt && presentation ? (
        <PresentationMenu
          point={holdAt}
          value={layout.presentation}
          onChange={presentation.onChoice}
          onClose={() => setHoldAt(null)}
        />
      ) : null}
    </div>
  );
}
