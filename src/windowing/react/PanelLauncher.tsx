import type { ReactNode } from "react";

function cx(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

export interface PanelLauncherClassNames {
  root?: string;
  button?: string;
  menu?: string;
  menuAlignLeft?: string;
  menuAlignRight?: string;
  menuItem?: string;
  menuEmpty?: string;
}

export interface PanelLauncherStrings {
  allTabsOpenText?: string;
}

export interface PanelLauncherProps<TabId extends string> {
  open: boolean;
  side?: "left" | "right";
  availableTabs: readonly TabId[];
  onOpenChange: (open: boolean) => void;
  onOpenTab: (tabId: TabId) => void;
  getLabel: (tabId: TabId) => string;
  classNames?: PanelLauncherClassNames;
  strings?: PanelLauncherStrings;
  renderButtonContent?: ReactNode;
  buttonAriaLabel?: string;
  buttonTitle?: string;
}

export function PanelLauncher<TabId extends string>(props: PanelLauncherProps<TabId>) {
  const {
    open,
    side = "left",
    availableTabs,
    onOpenChange,
    onOpenTab,
    getLabel,
    classNames,
    strings,
    renderButtonContent,
    buttonAriaLabel = "Open panel tab",
    buttonTitle = "Open panel tab",
  } = props;

  const alignClassName = side === "right"
    ? (classNames?.menuAlignRight ?? "foss-earth-window-menu-align-right")
    : (classNames?.menuAlignLeft ?? "foss-earth-window-menu-align-left");

  return (
    <div className={cx("foss-earth-panel-launcher", classNames?.root)}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cx("foss-earth-panel-launcher-button", classNames?.button)}
        aria-label={buttonAriaLabel}
        title={buttonTitle}
      >
        {renderButtonContent ?? "+"}
      </button>

      {open ? (
        <div
          role="menu"
          className={cx("foss-earth-window-menu", classNames?.menu, alignClassName)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {availableTabs.length === 0 ? (
            <div className={cx("foss-earth-window-menu-empty", classNames?.menuEmpty)}>
              {strings?.allTabsOpenText ?? "All tabs open"}
            </div>
          ) : (
            availableTabs.map((tabId) => (
              <button
                key={tabId}
                type="button"
                role="menuitem"
                className={cx("foss-earth-window-menu-item", classNames?.menuItem)}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenTab(tabId);
                  onOpenChange(false);
                }}
              >
                {getLabel(tabId)}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
