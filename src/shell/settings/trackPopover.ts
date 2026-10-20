/**
 * A track shown on demand: in a popover under its control's value while the
 * pointer is over the control, and pinned once the control is clicked,
 * focused or tapped, until a press elsewhere or Escape. One shows at a time
 * in a document.
 *
 * The popover stays inside its control, so its range inputs keep their place
 * for keyboards, screen readers and the panel's pointer routing. Closed, it is
 * clipped to nothing rather than hidden, so Tab still reaches its thumbs and
 * focusing one pins it open. Open, it uses the top layer where the browser has
 * one, so it overlays the panel and never moves the layout.
 */

export interface TrackPopoverOptions {
  /** The control: hovering it shows the track, and a press or focus inside it pins the track. */
  owner: HTMLElement;
  /** What the popover sits under: the control's value. */
  anchor: HTMLElement;
  /** The track. */
  content: HTMLElement;
  label: string;
  /** False while there is no track to show, such as while a named value is chosen. */
  isAvailable?(): boolean;
}

export interface TrackPopoverHandle {
  element: HTMLElement;
  isOpen(): boolean;
  isPinned(): boolean;
  open(pin: boolean): void;
  close(): void;
  /** Closes the popover when it can no longer show, and moves it with its anchor. */
  update(): void;
  destroy(): void;
}

/** How long the pointer may be between the control and its popover before it closes. */
const HOVER_GRACE_MS = 150;

const openByDocument = new WeakMap<Document, { close: () => void; pinned: () => boolean; owner: HTMLElement }>();

/** Presses and focus on the control's help are the help's, not the track's. */
const HELP = ".foss-earth-help-tooltip, .foss-earth-parameter__help";

export function createTrackPopover(options: TrackPopoverOptions): TrackPopoverHandle {
  const { owner, anchor, content } = options;
  const document = owner.ownerDocument;
  const window = document.defaultView;
  const element = document.createElement("div");
  element.className = "foss-earth-track-popover";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", options.label);
  const nativePopover = typeof element.showPopover === "function" && typeof element.hidePopover === "function";
  if (nativePopover) element.setAttribute("popover", "manual");
  element.append(content);
  let opened = false;
  let pinned = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const available = (): boolean => !destroyed && (options.isAvailable?.() ?? true);
  const cancelClose = (): void => {
    if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
  };

  const position = (): void => {
    if (!opened || !window) return;
    const at = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    element.style.maxWidth = `${Math.max(0, width - 16)}px`;
    const box = element.getBoundingClientRect();
    // Centred under the value, inside the viewport; above it when there is no room below.
    const x = Math.max(left + 8, Math.min(at.left + at.width / 2 - box.width / 2, left + width - box.width - 8));
    const below = at.bottom + 4;
    const y = below + box.height > top + height - 8 ? Math.max(top + 8, at.top - 4 - box.height) : below;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  };

  const close = (): void => {
    cancelClose();
    if (!opened) return;
    opened = false;
    pinned = false;
    if (nativePopover && element.isConnected && element.matches(":popover-open")) element.hidePopover();
    element.classList.remove("is-open", "is-pinned");
    element.style.removeProperty("left");
    element.style.removeProperty("top");
    element.style.removeProperty("max-width");
    owner.classList.remove("is-track-open");
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("scroll", position, true);
    window?.removeEventListener("resize", position);
    window?.visualViewport?.removeEventListener("resize", position);
    window?.visualViewport?.removeEventListener("scroll", position);
    if (openByDocument.get(document)?.close === close) openByDocument.delete(document);
  };

  const open = (pin: boolean): void => {
    cancelClose();
    if (!available()) return;
    if (pin && !pinned) { pinned = true; element.classList.add("is-pinned"); }
    if (opened) return;
    const other = openByDocument.get(document);
    // A pinned track stays until it is dismissed; hovering another control does not replace it.
    if (other && other.close !== close) {
      if (other.pinned() && !pin && other.owner.isConnected) { pinned = false; element.classList.remove("is-pinned"); return; }
      other.close();
    }
    opened = true;
    if (nativePopover && element.isConnected) element.showPopover();
    element.classList.add("is-open");
    owner.classList.add("is-track-open");
    openByDocument.set(document, { close, pinned: () => pinned, owner });
    position();
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", position, true);
    window?.addEventListener("resize", position);
    window?.visualViewport?.addEventListener("resize", position);
    window?.visualViewport?.addEventListener("scroll", position);
  };

  const onEnter = (event: PointerEvent): void => {
    cancelClose();
    // A touch has no hover: its tap pins the track instead.
    if (event.pointerType === "touch") return;
    open(false);
  };
  const onLeave = (): void => {
    if (pinned || !opened) return;
    cancelClose();
    closeTimer = setTimeout(() => { closeTimer = null; if (!pinned) close(); }, HOVER_GRACE_MS);
  };
  const isHelp = (target: EventTarget | null): boolean => target instanceof Element && target.closest(HELP) !== null;
  const onPress = (event: Event): void => {
    if (!isHelp(event.target)) open(true);
  };
  const onFocusIn = (event: FocusEvent): void => {
    if (!isHelp(event.target)) open(true);
  };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    // A press on empty space moves focus nowhere; the outside press closes it instead.
    if (next && !owner.contains(next)) close();
  };
  const onOutside = (event: Event): void => {
    const target = event.target as Node | null;
    if (target?.nodeType && !owner.contains(target)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !opened) return;
    close();
    event.preventDefault();
  };
  const onToggle = (): void => {
    if (nativePopover && opened && !element.matches(":popover-open")) close();
  };

  owner.addEventListener("pointerenter", onEnter);
  owner.addEventListener("pointerleave", onLeave);
  owner.addEventListener("pointerdown", onPress);
  owner.addEventListener("focusin", onFocusIn);
  owner.addEventListener("focusout", onFocusOut);
  element.addEventListener("toggle", onToggle);

  return {
    element,
    isOpen: () => opened,
    isPinned: () => pinned,
    open,
    close,
    update() {
      if (!opened) return;
      if (!available()) close(); else position();
    },
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      owner.removeEventListener("pointerenter", onEnter);
      owner.removeEventListener("pointerleave", onLeave);
      owner.removeEventListener("pointerdown", onPress);
      owner.removeEventListener("focusin", onFocusIn);
      owner.removeEventListener("focusout", onFocusOut);
      element.removeEventListener("toggle", onToggle);
      element.remove();
    },
  };
}
