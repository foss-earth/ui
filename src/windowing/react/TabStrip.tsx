import type { ReactNode } from "react";

function cx(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

export interface TabStripClassNames {
  root?: string;
  tabList?: string;
  tabShell?: string;
  tabShellSelected?: string;
  tabShellUnselected?: string;
  tabButton?: string;
  tabButtonCompact?: string;
  closeButton?: string;
  addButtonWrap?: string;
  addButton?: string;
  addMenu?: string;
  addMenuAlignLeft?: string;
  addMenuAlignRight?: string;
  addMenuItem?: string;
  addMenuEmpty?: string;
}

export interface TabStripStrings {
  allTabsOpenText?: string;
  addButtonAriaLabel?: string;
  addButtonTitle?: string;
  closeTabAriaLabel?: (tabLabel: string) => string;
}

export interface TabStripProps<TabId extends string> {
  openTabs: readonly TabId[];
  activeTab: TabId | null;
  availableTabs: readonly TabId[];
  addMenuOpen: boolean;
  side?: "left" | "right";
  compact?: boolean;
  onSelectTab: (tabId: TabId) => void;
  onCloseTab: (tabId: TabId) => void;
  onOpenTab: (tabId: TabId) => void;
  onAddMenuOpenChange: (open: boolean) => void;
  getLabel: (tabId: TabId) => string;
  classNames?: TabStripClassNames;
  strings?: TabStripStrings;
  renderAddButtonContent?: ReactNode;
  renderCloseButtonContent?: (tabId: TabId) => ReactNode;
}

export function TabStrip<TabId extends string>(props: TabStripProps<TabId>) {
  const {
    openTabs,
    activeTab,
    availableTabs,
    addMenuOpen,
    side = "left",
    compact = false,
    onSelectTab,
    onCloseTab,
    onOpenTab,
    onAddMenuOpenChange,
    getLabel,
    classNames,
    strings,
    renderAddButtonContent,
    renderCloseButtonContent,
  } = props;

  const closeAriaLabel = strings?.closeTabAriaLabel ?? ((tabLabel: string) => `Close ${tabLabel} tab`);
  const alignClassName = side === "right"
    ? (classNames?.addMenuAlignRight ?? "foss-earth-window-menu-align-right")
    : (classNames?.addMenuAlignLeft ?? "foss-earth-window-menu-align-left");

  return (
    <div className={cx("foss-earth-tab-strip", classNames?.root)}>
      <div className={cx("foss-earth-tab-strip-list", classNames?.tabList)}>
        {openTabs.map((tabId) => {
          const selected = tabId === activeTab;
          const label = getLabel(tabId);

          return (
            <div
              key={tabId}
              className={cx(
                "foss-earth-tab-shell",
                classNames?.tabShell,
                selected ? classNames?.tabShellSelected : classNames?.tabShellUnselected,
              )}
            >
              <button
                type="button"
                onClick={() => onSelectTab(tabId)}
                className={cx(
                  "foss-earth-tab-button",
                  classNames?.tabButton,
                  compact ? classNames?.tabButtonCompact : undefined,
                )}
              >
                {label}
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tabId)}
                className={cx("foss-earth-tab-close", classNames?.closeButton)}
                aria-label={closeAriaLabel(label)}
              >
                {renderCloseButtonContent?.(tabId) ?? "x"}
              </button>
            </div>
          );
        })}
      </div>

      <div className={cx("foss-earth-tab-add-wrap", classNames?.addButtonWrap)}>
        <button
          type="button"
          onClick={() => onAddMenuOpenChange(!addMenuOpen)}
          className={cx("foss-earth-tab-add", classNames?.addButton)}
          aria-label={strings?.addButtonAriaLabel ?? "Open new tab"}
          title={strings?.addButtonTitle ?? "Open new tab"}
        >
          {renderAddButtonContent ?? "+"}
        </button>

        {addMenuOpen ? (
          <div
            role="menu"
            className={cx("foss-earth-window-menu", classNames?.addMenu, alignClassName)}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {availableTabs.length === 0 ? (
              <div className={cx("foss-earth-window-menu-empty", classNames?.addMenuEmpty)}>
                {strings?.allTabsOpenText ?? "All tabs open"}
              </div>
            ) : (
              availableTabs.map((tabId) => (
                <button
                  key={tabId}
                  type="button"
                  role="menuitem"
                  className={cx("foss-earth-window-menu-item", classNames?.addMenuItem)}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenTab(tabId);
                    onAddMenuOpenChange(false);
                  }}
                >
                  {getLabel(tabId)}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
