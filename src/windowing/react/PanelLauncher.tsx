import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { fitMenu, menuBottom as menuBottomOf } from "./menuFit.js";

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
  /** Returns from the opt-in dropdown to the New tab page. */
  onUseNewTab?: () => void;
  onOpenTab: (tabId: TabId) => void;
  onMoveTab?: (tabId: TabId) => void;
  dropWidth?: number;
  dropMaxWidth?: number;
  dropHeight?: number;
  /** An already-running drag from another window, supplied when this launcher mounts late. */
  dropActive?: boolean;
  getLabel: (tabId: TabId) => string;
  classNames?: PanelLauncherClassNames;
  strings?: PanelLauncherStrings;
  renderButtonContent?: ReactNode;
  buttonAriaLabel?: string;
  buttonTitle?: string;
  /** The top of what the host draws over the window's bottom edge: the menu ends above it, in more columns if it must. */
  menuBottom?: () => number | null | undefined;
}

export function PanelLauncher<TabId extends string>(props: PanelLauncherProps<TabId>) {
  const {
    open,
    side = "left",
    availableTabs,
    onOpenChange,
    onUseNewTab,
    onOpenTab,
    onMoveTab,
    dropWidth,
    dropMaxWidth,
    dropHeight,
    dropActive = false,
    getLabel,
    classNames,
    strings,
    renderButtonContent,
    buttonAriaLabel = "Open panel tab",
    buttonTitle = "Open panel tab",
    menuBottom,
  } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuFit, setMenuFit] = useState<CSSProperties | undefined>(undefined);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!onMoveTab) return;

    const handleDragStart = (event: Event) => {
      const sourceSide = (event as CustomEvent<{ side?: "left" | "right" }>).detail?.side;
      if (sourceSide !== side) setDragActive(true);
    };
    const handleDragEnd = () => {
      dragDepthRef.current = 0;
      setDragActive(false);
    };

    window.addEventListener("foss-earth-tab-drag-start", handleDragStart);
    window.addEventListener("foss-earth-tab-drag-end", handleDragEnd);
    return () => {
      window.removeEventListener("foss-earth-tab-drag-start", handleDragStart);
      window.removeEventListener("foss-earth-tab-drag-end", handleDragEnd);
    };
  }, [onMoveTab, side]);

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [onOpenChange, open]);
  useEscapeToClose(open, () => onOpenChange(false), () => buttonRef.current);

  // Every tab of the menu stays in sight: it ends above the host's toolbar, in more columns if it must.
  useLayoutEffect(() => {
    if (!open) return;
    const fit = (): void => {
      const menu = menuRef.current;
      if (menu) setMenuFit(fitMenu(menu, menu.getBoundingClientRect().top, menuBottomOf(menuBottom)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open, availableTabs.length, menuBottom]);

  const alignClassName = side === "right"
    ? (classNames?.menuAlignRight ?? "foss-earth-window-menu-align-right")
    : (classNames?.menuAlignLeft ?? "foss-earth-window-menu-align-left");

  const activeDrop = dragActive || dropActive;
  const dropStyle: CSSProperties | undefined = activeDrop
    ? {
        width: dropWidth,
        maxWidth: dropMaxWidth,
        height: dropHeight,
      }
    : undefined;

  return (
    <div
      ref={rootRef}
      className={cx(
        "foss-earth-panel-launcher",
        activeDrop && "foss-earth-panel-launcher-drop-active",
        classNames?.root,
      )}
      style={dropStyle}
      onDragEnter={onMoveTab ? () => {
        dragDepthRef.current += 1;
        setDragActive(true);
      } : undefined}
      onDragLeave={onMoveTab ? () => {
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0;
          setDragActive(false);
        }
      } : undefined}
      onDragOver={onMoveTab ? (event) => event.preventDefault() : undefined}
      onDrop={onMoveTab ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current = 0;
        setDragActive(false);
        window.dispatchEvent(new Event("foss-earth-tab-drag-end"));
        const tabId = event.dataTransfer.getData("text/plain") as TabId;
        if (tabId) onMoveTab(tabId);
      } : undefined}
    >
      <button
        ref={buttonRef}
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
          ref={menuRef}
          className={cx("foss-earth-window-menu", classNames?.menu, alignClassName)}
          style={menuFit}
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
                data-tab-id={tabId}
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
          {onUseNewTab ? (
            <button
              type="button"
              role="menuitem"
              className={cx("foss-earth-window-menu-item", "foss-earth-window-menu-picker", classNames?.menuItem)}
              onClick={(event) => { event.stopPropagation(); onUseNewTab(); }}
            >
              Use New tab
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
