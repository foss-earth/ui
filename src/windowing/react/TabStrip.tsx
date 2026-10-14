import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { fitMenu, menuBottom as menuBottomOf, MENU_EDGE_PX } from "./menuFit.js";
import { usePresentationHold } from "./presentationHold.js";

/** The scrollbar's thumb never gets narrower than this, however many tabs are open. */
const MIN_THUMB_PX = 24;

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
  onMoveTab?: (tabId: TabId) => void;
  onAddMenuOpenChange: (open: boolean) => void;
  getLabel: (tabId: TabId) => string;
  classNames?: TabStripClassNames;
  strings?: TabStripStrings;
  renderAddButtonContent?: ReactNode;
  renderCloseButtonContent?: (tabId: TabId) => ReactNode;
  /**
   * Where the + menu is drawn: outside the panel, which clips what passes its
   * edges, and in front of everything under it. The document's body when absent.
   */
  menuContainer?: HTMLElement | null;
  /**
   * The y, in the window, of the top of what the host draws over the window's
   * bottom edge, such as a toolbar: the + menu ends above it, taking further
   * columns when it has more items than fit. The window's edge when absent.
   */
  menuBottom?: () => number | null | undefined;
  /** A still press on a tab. Moving starts the usual drag instead. */
  onHoldPresentation?: (point: { x: number; y: number }) => void;
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
    onMoveTab,
    onAddMenuOpenChange,
    getLabel,
    classNames,
    strings,
    renderAddButtonContent,
    renderCloseButtonContent,
    menuContainer,
    menuBottom,
    onHoldPresentation,
  } = props;
  const hold = usePresentationHold(onHoldPresentation);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const thumbDrag = useRef<{ pointerId: number; grab: number } | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [menuAlignsRight, setMenuAlignsRight] = useState(false);
  const [menuPlace, setMenuPlace] = useState<CSSProperties | null>(null);

  const closeAriaLabel = strings?.closeTabAriaLabel ?? ((tabLabel: string) => `Close ${tabLabel} tab`);
  useEffect(() => {
    if (!addMenuOpen) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        onAddMenuOpenChange(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [addMenuOpen, onAddMenuOpenChange]);
  useEscapeToClose(addMenuOpen, () => onAddMenuOpenChange(false), () => addRef.current);

  // The menu is fixed to the window where the + button is: over it, starting at
  // its left edge, or ending at its right edge where it would pass the window's.
  useLayoutEffect(() => {
    if (!addMenuOpen) return;
    const place = (): void => {
      const menu = menuRef.current;
      const anchor = addRef.current?.getBoundingClientRect();
      if (!menu || !anchor) return;
      // Fitted first: a menu that takes more columns to end above the host's toolbar is wider.
      const fit = fitMenu(menu, anchor.top, menuBottomOf(menuBottom));
      const alignsRight = anchor.left + menu.offsetWidth > window.innerWidth - MENU_EDGE_PX;
      setMenuAlignsRight(alignsRight);
      setMenuPlace({
        position: "fixed",
        top: anchor.top,
        ...(alignsRight ? { right: Math.max(MENU_EDGE_PX, window.innerWidth - anchor.right) } : { left: Math.max(MENU_EDGE_PX, anchor.left) }),
        ...fit,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [addMenuOpen, openTabs.length, availableTabs.length, menuBottom]);

  // A tab opened, moved here or selected where the strip has scrolled past is
  // brought into view, as a browser's tab strip does. Only the strip scrolls,
  // and only when the selection or the tabs change, so a strip scrolled by hand
  // stays where it was through other updates.
  useLayoutEffect(() => {
    const list = listRef.current;
    const shell = list?.querySelector<HTMLElement>(".foss-earth-tab-shell-selected");
    if (!list || !shell) return;
    const bounds = list.getBoundingClientRect(), tab = shell.getBoundingClientRect();
    if (tab.left < bounds.left) list.scrollLeft -= bounds.left - tab.left;
    else if (tab.right > bounds.right) list.scrollLeft += Math.min(tab.right - bounds.right, tab.left - bounds.left);
  }, [activeTab, openTabs.length]);

  // The browser's own scrollbar is hidden (see windowing.css): on a phone, a
  // tablet or a Mac it is drawn over the bottom of the tabs, and while it
  // shows, it takes presses meant for them. This one is drawn under the tabs,
  // while they are wider than the strip.
  const placeThumb = useCallback((): void => {
    const list = listRef.current;
    if (!list) return;
    const range = list.scrollWidth - list.clientWidth;
    setOverflowing(range > 0);
    const thumb = thumbRef.current;
    if (!thumb || range <= 0) return;
    const width = Math.max(MIN_THUMB_PX, list.clientWidth * list.clientWidth / list.scrollWidth);
    thumb.style.width = `${width}px`;
    thumb.style.transform = `translateX(${list.scrollLeft / range * (list.clientWidth - width)}px)`;
  }, []);
  // Every render: tabs opened, closed or renamed change how far the strip scrolls.
  useLayoutEffect(() => placeThumb());
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.addEventListener("scroll", placeThumb, { passive: true });
    const Observer = list.ownerDocument.defaultView?.ResizeObserver;
    const resize = Observer ? new Observer(placeThumb) : null;
    resize?.observe(list);
    return () => {
      list.removeEventListener("scroll", placeThumb);
      resize?.disconnect();
    };
  }, [placeThumb]);

  const dragThumb = (clientX: number): void => {
    const list = listRef.current, track = scrollbarRef.current?.getBoundingClientRect(), thumb = thumbRef.current;
    if (!list || !track || !thumb || !thumbDrag.current) return;
    const free = track.width - thumb.offsetWidth;
    if (free > 0) list.scrollLeft = (clientX - track.left - thumbDrag.current.grab) / free * (list.scrollWidth - list.clientWidth);
  };
  const endThumbDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (thumbDrag.current?.pointerId === event.pointerId) thumbDrag.current = null;
  };

  const alignClassName = menuAlignsRight
    ? (classNames?.addMenuAlignRight ?? "foss-earth-window-menu-align-right")
    : (classNames?.addMenuAlignLeft ?? "foss-earth-window-menu-align-left");

  return (
    <div
      ref={rootRef}
      className={cx("foss-earth-tab-strip", classNames?.root)}
      data-overflowing={overflowing ? "true" : undefined}
      onDragOver={onMoveTab ? (event) => event.preventDefault() : undefined}
      onDrop={onMoveTab ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        const tabId = event.dataTransfer.getData("text/plain") as TabId;
        window.dispatchEvent(new Event("foss-earth-tab-drag-end"));
        if (tabId && openTabs.includes(tabId)) return;
        if (tabId) onMoveTab(tabId);
      } : undefined}
    >
      <div className="foss-earth-tab-strip-scroll">
        <div ref={listRef} className={cx("foss-earth-tab-strip-list", classNames?.tabList)}>
          {openTabs.map((tabId) => {
            const selected = tabId === activeTab;
            const label = getLabel(tabId);

            return (
              <div
                key={tabId}
                draggable={Boolean(onMoveTab)}
                onDragStart={onMoveTab ? (event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", tabId);
                  window.dispatchEvent(new CustomEvent("foss-earth-tab-drag-start", {
                    detail: { side },
                  }));
                } : undefined}
                onDragEnd={onMoveTab ? () => {
                  window.dispatchEvent(new Event("foss-earth-tab-drag-end"));
                } : undefined}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  const target = event.target as Element;
                  if (target.closest(".foss-earth-tab-close")) return;
                  hold.arm(event.clientX, event.clientY);
                }}
                onContextMenu={onHoldPresentation ? (event) => event.preventDefault() : undefined}
                className={cx(
                  "foss-earth-tab-shell",
                  selected ? "foss-earth-tab-shell-selected" : "foss-earth-tab-shell-unselected",
                  classNames?.tabShell,
                  selected ? classNames?.tabShellSelected : classNames?.tabShellUnselected,
                )}
              >
                <button
                  type="button"
                  onClick={() => { if (hold.take()) return; onSelectTab(tabId); }}
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

        {overflowing ? (
          <div
            ref={scrollbarRef}
            className="foss-earth-tab-strip-scrollbar"
            aria-hidden="true"
            onPointerDown={(event) => {
              const thumb = thumbRef.current?.getBoundingClientRect();
              if (event.button !== 0 || !thumb) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              // A press on the thumb holds it where it was taken. One beside it brings the thumb's middle there.
              const onThumb = event.clientX >= thumb.left && event.clientX <= thumb.right;
              thumbDrag.current = { pointerId: event.pointerId, grab: onThumb ? event.clientX - thumb.left : thumb.width / 2 };
              dragThumb(event.clientX);
            }}
            onPointerMove={(event) => {
              if (thumbDrag.current?.pointerId === event.pointerId) dragThumb(event.clientX);
            }}
            onPointerUp={endThumbDrag}
            onPointerCancel={endThumbDrag}
          >
            <div ref={thumbRef} className="foss-earth-tab-strip-scrollbar-thumb" />
          </div>
        ) : null}
      </div>

      <div className={cx("foss-earth-tab-add-wrap", classNames?.addButtonWrap)}>
        <button
          ref={addRef}
          type="button"
          onClick={() => onAddMenuOpenChange(!addMenuOpen)}
          className={cx("foss-earth-tab-add", classNames?.addButton)}
          aria-label={strings?.addButtonAriaLabel ?? "Open new tab"}
          title={strings?.addButtonTitle ?? "Open new tab"}
        >
          {renderAddButtonContent ?? "+"}
        </button>

        {addMenuOpen && typeof document !== "undefined" ? createPortal(
          <div
            role="menu"
            ref={menuRef}
            className={cx("foss-earth-window-menu", "foss-earth-window-menu-floating", classNames?.addMenu, alignClassName)}
            // Measured before it is placed, so hidden until then.
            style={menuPlace ?? { position: "fixed", top: 0, left: 0, visibility: "hidden" }}
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
          </div>,
          menuContainer ?? document.body,
        ) : null}
      </div>
    </div>
  );
}
