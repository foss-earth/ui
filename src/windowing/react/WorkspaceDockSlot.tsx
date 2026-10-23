import type { ReactNode } from "react";
import {
  allWorkspaceOpenTabs,
  closeTabInWorkspace,
  openTabAndExpandWorkspaceSlot,
  openTabInWorkspace,
  selectTabInWorkspace,
  selectTabAndToggleWorkspaceSlot,
  setWorkspaceSlotCollapsed,
  setWorkspaceSlotSize,
} from "../core/workspaceState.js";
import type {
  WindowSlotId,
  WindowTabDefinition,
  WindowWorkspaceState,
} from "../core/types.js";
import {
  DockPanel,
  type DockPanelClassNames,
  type DockPanelProps,
} from "./DockPanel.js";
import {
  PanelLauncher,
  type PanelLauncherClassNames,
} from "./PanelLauncher.js";
import {
  TabStrip,
  type TabStripClassNames,
} from "./TabStrip.js";
import { NewTabPicker } from "./NewTabPicker.js";

function cx(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

export type WorkspaceDockPanelOverrides = Partial<Omit<
  DockPanelProps,
  | "side"
  | "width"
  | "maxWidth"
  | "onWidthChange"
  | "collapsed"
  | "onCollapsedChange"
  | "addMenuOpen"
  | "header"
  | "children"
  | "classNames"
>>;

export interface WorkspaceDockSlotClassNames {
  launcherRoot?: string;
  dockPanel?: DockPanelClassNames;
  panelLauncher?: PanelLauncherClassNames;
  tabStrip?: TabStripClassNames;
}

export interface WorkspaceDockSlotStrings {
  allTabsOpenText?: string;
  openPanelTabAriaLabel?: string;
  openPanelTabTitle?: string;
  openNewTabAriaLabel?: string;
  openNewTabTitle?: string;
  newTabLabel?: string;
  closeTabAriaLabel?: (tabLabel: string) => string;
}

export interface WorkspaceDockSlotProps<TabId extends string> {
  side: "left" | "right";
  slotId: WindowSlotId;
  workspaceState: WindowWorkspaceState<TabId>;
  onWorkspaceStateChange: (next: WindowWorkspaceState<TabId>) => void;
  /** Lets a shell coordinate a width request with its other windows. */
  onWidthChange?: (width: number) => void;
  tabDefinitions: readonly WindowTabDefinition<TabId>[];
  getTabLabel: (tabId: TabId) => string;
  renderTabContent: (tabId: TabId) => ReactNode;
  width: number;
  maxWidth: number;
  addMenuOpen: boolean;
  onAddMenuOpenChange: (open: boolean) => void;
  /** Opens a New tab page by default. The floating dropdown is opt-in. */
  tabPicker?: "tab" | "dropdown";
  /** Offers the picker preference in the New tab page. */
  onTabPickerChange?: (mode: "tab" | "dropdown") => void;
  visible?: boolean;
  showLauncherWhenEmpty?: boolean;
  /** Reveals an empty side as a drop target when a tab drag began before it mounted. */
  emptyDropActive?: boolean;
  compactWhenCollapsed?: boolean;
  restoreOnTabSelect?: boolean;
  restoreOnTabOpen?: boolean;
  classNames?: WorkspaceDockSlotClassNames;
  strings?: WorkspaceDockSlotStrings;
  renderLauncherButtonContent?: ReactNode;
  renderTabAddButtonContent?: ReactNode;
  renderTabCloseButtonContent?: (tabId: TabId) => ReactNode;
  /** A mark before a tab's label in the strip. */
  renderTabIcon?: (tabId: TabId) => ReactNode;
  dockPanelProps?: WorkspaceDockPanelOverrides;
  /** Return `false` to keep the tab open. */
  onBeforeCloseTab?: (tabId: TabId) => boolean | void;
  /** Where the tab strip's + menu is drawn, outside the panel; the document's body when absent. */
  menuContainer?: HTMLElement | null;
  /** The top of what the host draws over the window's bottom edge, such as a toolbar: the + menus end above it. */
  menuBottom?: () => number | null | undefined;
  /** A still press on a tab or the resize grip. */
  onHoldPresentation?: (point: { x: number; y: number }) => void;
  /** Another element draws this window's body, shared with the other window: only the tab strip shows. */
  joined?: boolean;
  /** The person used this window: the tab they chose or opened, else the one it shows. */
  onActivate?: (tabId: TabId | null) => void;
  /** A compact row's side name, shown beside the strip or the empty-side launcher. */
  rowLabel?: string;
}

function availableTabsFromWorkspace<TabId extends string>(
  workspaceState: WindowWorkspaceState<TabId>,
  tabDefinitions: readonly WindowTabDefinition<TabId>[],
): TabId[] {
  const openTabs = new Set(allWorkspaceOpenTabs(workspaceState));
  return tabDefinitions
    .filter((tab) => tab.available !== false && !openTabs.has(tab.id))
    .map((tab) => tab.id);
}

export function WorkspaceDockSlot<TabId extends string>(props: WorkspaceDockSlotProps<TabId>) {
  const {
    side,
    slotId,
    workspaceState,
    onWorkspaceStateChange,
    onWidthChange,
    tabDefinitions,
    getTabLabel,
    renderTabContent,
    width,
    maxWidth,
    addMenuOpen,
    onAddMenuOpenChange,
    tabPicker = "tab",
    onTabPickerChange,
    visible = true,
    showLauncherWhenEmpty = true,
    emptyDropActive = false,
    compactWhenCollapsed = true,
    restoreOnTabSelect = false,
    restoreOnTabOpen = true,
    classNames,
    strings,
    renderLauncherButtonContent,
    renderTabAddButtonContent,
    renderTabCloseButtonContent,
    renderTabIcon,
    dockPanelProps,
    onBeforeCloseTab,
    menuContainer,
    menuBottom,
    onHoldPresentation,
    joined = false,
    onActivate,
    rowLabel,
  } = props;

  if (!visible) return null;

  const slotState = workspaceState[slotId];
  const openTabs = slotState.tabs;
  const activeTab = slotState.activeTab ?? slotState.tabs[slotState.tabs.length - 1] ?? null;
  const availableTabs = availableTabsFromWorkspace(workspaceState, tabDefinitions);
  const pickerSelected = tabPicker === "tab" && addMenuOpen;

  const handleOpenNewTab = () => {
    if (slotState.collapsed) {
      onWorkspaceStateChange(setWorkspaceSlotCollapsed(workspaceState, slotId, false));
    }
    onAddMenuOpenChange(true);
    onActivate?.(null);
  };

  // The selected New tab minimizes and restores its window, as any other selected tab does.
  const handleSelectNewTab = () => {
    if (restoreOnTabSelect && pickerSelected && !slotState.collapsed) {
      onWorkspaceStateChange(setWorkspaceSlotCollapsed(workspaceState, slotId, true));
      return;
    }
    handleOpenNewTab();
  };

  const handleUseNewTab = onTabPickerChange ? () => {
    onTabPickerChange("tab");
    handleOpenNewTab();
  } : undefined;

  const handleOpenTab = (tabId: TabId) => {
    const next = restoreOnTabOpen
      ? openTabAndExpandWorkspaceSlot(workspaceState, slotId, tabId, tabDefinitions)
      : openTabInWorkspace(workspaceState, slotId, tabId, tabDefinitions);
    onWorkspaceStateChange(next);
    onAddMenuOpenChange(false);
    onActivate?.(tabId);
  };

  const handleSelectTab = (tabId: TabId) => {
    const next = pickerSelected
      ? setWorkspaceSlotCollapsed(selectTabInWorkspace(workspaceState, slotId, tabId), slotId, false)
      : restoreOnTabSelect
      ? selectTabAndToggleWorkspaceSlot(workspaceState, slotId, tabId)
      : selectTabInWorkspace(workspaceState, slotId, tabId);
    onWorkspaceStateChange(next);
    onAddMenuOpenChange(false);
    onActivate?.(tabId);
  };

  const handleCloseTab = (tabId: TabId) => {
    if (onBeforeCloseTab?.(tabId) === false) return;
    onWorkspaceStateChange(closeTabInWorkspace(workspaceState, slotId, tabId));
  };

  const handleMoveTab = (tabId: TabId) => {
    onWorkspaceStateChange(openTabAndExpandWorkspaceSlot(workspaceState, slotId, tabId, tabDefinitions));
    onAddMenuOpenChange(false);
    onActivate?.(tabId);
  };

  const handleTabDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleTabDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new Event("foss-earth-tab-drag-end"));
    const tabId = event.dataTransfer.getData("text/plain") as TabId;
    if (tabId && !openTabs.includes(tabId)) handleMoveTab(tabId);
  };

  const hasCustomLauncherRoot = Boolean(
    classNames?.launcherRoot || classNames?.panelLauncher?.root,
  );

  const launcherClassNames: PanelLauncherClassNames = {
    ...classNames?.panelLauncher,
    root: cx(
      "foss-earth-workspace-slot-launcher",
      hasCustomLauncherRoot
        ? undefined
        : side === "right"
          ? "foss-earth-workspace-slot-launcher-right"
          : "foss-earth-workspace-slot-launcher-left",
      classNames?.launcherRoot,
      classNames?.panelLauncher?.root,
    ),
  };

  if (openTabs.length === 0 && !pickerSelected) {
    if (!showLauncherWhenEmpty) return null;

    const launcher = (
      <PanelLauncher<TabId>
        dropActive={emptyDropActive}
        open={tabPicker === "dropdown" && addMenuOpen}
        side={side}
        availableTabs={availableTabs}
        onOpenChange={tabPicker === "tab" ? (open) => { if (open) handleOpenNewTab(); } : onAddMenuOpenChange}
        onUseNewTab={tabPicker === "dropdown" ? handleUseNewTab : undefined}
        onOpenTab={handleOpenTab}
        onMoveTab={handleMoveTab}
        dropWidth={width}
        dropMaxWidth={maxWidth}
        dropHeight={dockPanelProps?.initialHeight ?? 512}
        getLabel={getTabLabel}
        classNames={launcherClassNames}
        strings={{
          allTabsOpenText: strings?.allTabsOpenText,
        }}
        renderButtonContent={renderLauncherButtonContent}
        buttonAriaLabel={strings?.openPanelTabAriaLabel}
        buttonTitle={strings?.openPanelTabTitle}
        menuBottom={menuBottom}
      />
    );
    if (!rowLabel) return launcher;
    return (
      <div className="foss-earth-compact-row" data-side={side}>
        <span className="foss-earth-compact-row-label">{rowLabel}</span>
        {launcher}
      </div>
    );
  }

  if (!activeTab && !pickerSelected) return null;
  const surface = !pickerSelected && tabDefinitions.some(tab => tab.id === activeTab && tab.surface !== undefined);

  return (
    <DockPanel
      side={side}
      width={width}
      maxWidth={maxWidth}
      onWidthChange={(nextWidth) => {
        if (onWidthChange) onWidthChange(nextWidth);
        else onWorkspaceStateChange(setWorkspaceSlotSize(workspaceState, slotId, { width: nextWidth }));
      }}
      collapsed={slotState.collapsed}
      onCollapsedChange={(collapsed) => {
        onWorkspaceStateChange(setWorkspaceSlotCollapsed(workspaceState, slotId, collapsed));
      }}
      addMenuOpen={tabPicker === "dropdown" && addMenuOpen}
      onDragOver={handleTabDragOver}
      onDrop={handleTabDrop}
      classNames={classNames?.dockPanel}
      header={(
        <div className={rowLabel ? "foss-earth-compact-row" : undefined}>
          {rowLabel ? <span className="foss-earth-compact-row-label">{rowLabel}</span> : null}
          <TabStrip<TabId>
            openTabs={openTabs}
            activeTab={pickerSelected ? null : activeTab}
            addMenuOpen={tabPicker === "dropdown" && addMenuOpen}
            availableTabs={availableTabs}
            side={side}
            compact={compactWhenCollapsed && slotState.collapsed}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onOpenTab={handleOpenTab}
            onMoveTab={handleMoveTab}
            onAddMenuOpenChange={onAddMenuOpenChange}
            onAddTab={tabPicker === "tab" ? handleOpenNewTab : undefined}
            onUseNewTab={tabPicker === "dropdown" ? handleUseNewTab : undefined}
            newTab={pickerSelected ? {
              label: strings?.newTabLabel,
              onSelect: handleSelectNewTab,
              onClose: () => onAddMenuOpenChange(false),
            } : undefined}
            getLabel={getTabLabel}
            classNames={classNames?.tabStrip}
            strings={{
              allTabsOpenText: strings?.allTabsOpenText,
              addButtonAriaLabel: strings?.openNewTabAriaLabel,
              addButtonTitle: strings?.openNewTabTitle,
              closeTabAriaLabel: strings?.closeTabAriaLabel,
            }}
            renderAddButtonContent={renderTabAddButtonContent}
            renderCloseButtonContent={renderTabCloseButtonContent}
            renderTabIcon={renderTabIcon}
            menuContainer={menuContainer}
            menuBottom={menuBottom}
            onHoldPresentation={onHoldPresentation}
          />
        </div>
      )}
      {...dockPanelProps}
      contentFit={pickerSelected ? undefined : dockPanelProps?.contentFit}
      onHoldPresentation={onHoldPresentation}
      surface={surface}
      bodyless={joined && !pickerSelected}
      onActivate={onActivate ? () => onActivate(pickerSelected ? null : activeTab) : undefined}
    >
      {pickerSelected ? (
        <NewTabPicker
          availableTabs={availableTabs}
          getLabel={getTabLabel}
          onOpenTab={handleOpenTab}
          allTabsOpenText={strings?.allTabsOpenText}
          onTabPickerChange={onTabPickerChange}
        />
      ) : joined || !activeTab ? null : renderTabContent(activeTab)}
    </DockPanel>
  );
}
