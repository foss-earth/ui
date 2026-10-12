import type { SettingsRegistry } from "../settings/registry.js";
import { fitLogResize, LOG_DOCK_GAP } from "./fitLogResize.js";
import { GAME_LOG_LINE_MS, GAME_LOG_MAX_LINES } from "./gameLogDefaults.js";

export type GameLogTone = "info" | "progress" | "success" | "warning" | "error";

export interface GameLogAction {
  label: string;
  onClick(): void;
  /** Set for toggles; exposed as aria-pressed. */
  pressed?: boolean;
  disabled?: boolean;
}

export interface GameLogEntry {
  text: string;
  tone?: GameLogTone;
  /** False removes a finished notice after its TTL, including from open history. */
  keepInHistory?: boolean;
  /** Omit for no bar, null when the total is unknown, else completion from 0 to 1. */
  progress?: number | null;
  actions?: readonly GameLogAction[];
}

export interface GameLogLine {
  update(entry: GameLogEntry): void;
  focusAction(): void;
  remove(): void;
}

export interface GameLog {
  readonly element: HTMLElement;
  print(entry: GameLogEntry): GameLogLine;
  /** While busy, lines offering an action (such as fullscreen) stay on screen. */
  setBusy(busy: boolean): void;
  /** Shows the whole scrollable history, including lines that have faded. */
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /** Collapse to the latest line's icon and a short preview. */
  minimize(): void;
  isMinimized(): boolean;
  destroy(): void;
}

export { GAME_LOG_LINE_MS, GAME_LOG_MAX_LINES } from "./gameLogDefaults.js";
export const GAME_LOG_FADE_MS = 500;
/** Preferred log width, or null when the shell can use its natural width. */
export const GAME_LOG_SIZE_EVENT = "foss-earth-game-log-size";
export interface GameLogSizeChange {
  width: number | null;
  /** Ordinary log messages and restore calls must not steal resize priority. */
  resized: boolean;
}

/** Resizing remembers dimensions; the shell always owns placement. */
interface LogSize { width: number; height: number }
const PREVIEW_CHARS = 28;
const RESIZE_CLICK_PX = 6;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 128;
const ICONS: Record<GameLogTone, string> = { info: "›", progress: "›", success: "✓", warning: "!", error: "✕" };
const TRASH_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4 4.25l.6 9h6.8l.6-9M6.75 6.75v4.5M9.25 6.75v4.5"/></svg>`;
/** A sideways drag this far is a swipe, not a click or a scroll. */
const SWIPE_START_PX = 8;
/** A swipe deletes a line past this share of its width, kept between these distances so a wide line needs no long swipe. */
const SWIPE_DELETE_SHARE = 0.35;
const SWIPE_DELETE_PX = { min: 64, max: 120 };
/** How long a swiped line takes to slide out. */
const DISMISS_MS = 160;
/** A trackpad swipe that stops short of deleting springs back after this pause. */
const WHEEL_SETTLE_MS = 150;


function previewText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_CHARS) return flat;
  return `${flat.slice(0, PREVIEW_CHARS - 1)}…`;
}

function positive(settings: SettingsRegistry, id: string, fallback: number): number {
  const value = settings.get(id);
  return typeof value === "number" && value > 0 ? value : fallback;
}


/**
 * A chat-style log in the surface the host supplies.
 * Newest first. Each line fades on its own once finished, so a new message
 * appears alone rather than bringing the whole history back over the world.
 * How long a line stays and how many are kept are `interface.log.*`, read
 * from `settings` (the app's registry) each time they apply.
 */
export interface GameLogPorts {
  element: HTMLElement;
  copy(text: string): Promise<void>;
  onSize(change: GameLogSizeChange): void;
  viewportHeight(): number;
  isCentered(): boolean;
  /** False while the layout gives the log the screen's width, as on a phone: its grip changes only the height. */
  resizesWidth?(): boolean;
  /** True while the log keeps to the right of the screen, beside a window on the left: its grip moves its left edge. */
  isRightAligned?(): boolean;
  timers: { set(work: () => void, ms: number): unknown; clear(timer: unknown | undefined): void };
}
export function createGameLog(settings: SettingsRegistry, ports: GameLogPorts): GameLog {
  const document = ports.element.ownerDocument;
  function span(className: string): HTMLSpanElement {
    const element = document.createElement("span");
    element.className = className;
    return element;
  }

  const copyText = ports.copy;
  const lineMs = (): number => positive(settings, "interface.log.lineDuration", GAME_LOG_LINE_MS / 1000) * 1000;
  const maxLines = (): number => Math.round(positive(settings, "interface.log.maxLines", GAME_LOG_MAX_LINES));
  const element = ports.element;
  element.className = "game-log";
  element.setAttribute("role", "log");
  element.setAttribute("aria-label", "Game log");
  // Progress lines update in place; only new lines are announced.
  element.setAttribute("aria-relevant", "additions");
  element.replaceChildren();
  element.hidden = false;

  const lines = document.createElement("div");
  lines.className = "game-log__lines";
  const peek = document.createElement("button");
  peek.type = "button";
  peek.className = "game-log__peek";
  peek.hidden = true;
  const peekIcon = span("game-log__icon");
  peekIcon.setAttribute("aria-hidden", "true");
  const peekText = span("game-log__peek-text");
  peek.append(peekIcon, peekText);
  const resize = document.createElement("div");
  resize.className = "game-log__resize";
  resize.setAttribute("role", "separator");
  resize.setAttribute("aria-label", "Resize log, click to minimize");
  resize.title = "Drag to resize, click to minimize";
  // The dock grips' arrows (DockPanel); log.css shows the one for where the grip is.
  resize.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="game-log__resize-corner" d="M10.75 2.75v8h-8M8.25 5.25l2.5-2.5 2.5 2.5M5.25 8.25l-2.5 2.5 2.5 2.5"/><path class="game-log__resize-corner-left" d="M5.25 2.75v8h8M2.75 5.25l2.5-2.5 2.5 2.5M10.75 8.25l2.5 2.5-2.5 2.5"/><path class="game-log__resize-height" d="M8 2.5v11M5.5 5 8 2.5 10.5 5M5.5 11 8 13.5 10.5 11"/></svg>`;
  // Under the newest-first lines, at the bottom: deletes every message.
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "game-log__clear";
  clear.setAttribute("aria-label", "Delete all messages");
  clear.title = "Delete all messages";
  clear.innerHTML = `${TRASH_ICON}<span>Delete all</span>`;
  element.append(peek, lines, clear, resize);

  let busy = false;
  let open = false;
  let minimized = false;
  let destroyed = false;
  let sized: LogSize | null = null;
  let drag: {
    startX: number; startY: number; startW: number; startH: number;
    originLeft: number; originTop: number; pointerId: number; moved: boolean;
    previous: LogSize | null; centered: boolean; rightAligned: boolean; widthFixed: boolean;
  } | null = null;
  const timers = new Map<Element, unknown>();
  const swipeTimers = new Map<Element, unknown>();

  const requestWidth = (width: number | null, resized = false): void => {
    ports.onSize({ width, resized });
  };

  const applySize = (resized = false): void => {
    element.style.left = "";
    element.style.top = "";
    element.style.transform = "";
    if (!sized || minimized) {
      element.style.width = "";
      element.style.height = "";
      element.removeAttribute("data-sized");
      requestWidth(null);
      return;
    }
    element.style.width = `${sized.width}px`;
    element.style.height = `${sized.height}px`;
    element.setAttribute("data-sized", "");
    requestWidth(sized.width, resized);
  };

  const syncScrollable = (): void => {
    lines.toggleAttribute("data-scrollable", lines.scrollHeight > lines.clientHeight + 1);
  };

  const syncPeek = (): void => {
    const newest = lines.querySelector<HTMLElement>(":scope > .game-log__line");
    if (!newest) {
      peek.hidden = true;
      return;
    }
    peek.hidden = false;
    peek.dataset.tone = newest.dataset.tone ?? "info";
    peekIcon.textContent = newest.querySelector(".game-log__icon")?.textContent ?? "›";
    const text = newest.querySelector(".game-log__text")?.textContent ?? "";
    peekText.textContent = previewText(text);
    peek.setAttribute("aria-label", `Show log: ${text}`);
  };

  const setMinimized = (next: boolean): void => {
    minimized = next && lines.childElementCount > 0;
    element.toggleAttribute("data-minimized", minimized);
    if (minimized) {
      open = false;
      element.removeAttribute("data-open");
    }
    applySize();
    syncPeek();
  };

  const canFade = (row: HTMLElement): boolean => {
    if (row.dataset.tone === "progress") return false;
    if (!row.querySelector(".game-log__actions button:not(:disabled)")) return true;
    return !busy && row.dataset.tone !== "error";
  };

  const maybeMinimize = (): void => {
    if (open || minimized) return;
    const rows = [...lines.children] as HTMLElement[];
    if (rows.length > 0 && rows.every((row) => row.hasAttribute("data-expired"))) setMinimized(true);
  };

  const forgetTimers = (row: Element): void => {
    ports.timers.clear(timers.get(row));
    timers.delete(row);
    ports.timers.clear(swipeTimers.get(row));
    swipeTimers.delete(row);
  };

  const removeRow = (row: HTMLElement): void => {
    if (destroyed || row.parentElement !== lines) return;
    forgetTimers(row);
    row.remove();
    syncPeek();
    syncScrollable();
    if (lines.childElementCount === 0) setMinimized(false);
    else maybeMinimize();
  };

  const schedule = (row: HTMLElement): void => {
    // A line sliding out keeps the timer that deletes it.
    if (row.hasAttribute("data-dismissed")) return;
    ports.timers.clear(timers.get(row));
    timers.delete(row);
    row.removeAttribute("data-fading");
    if (destroyed || row.hasAttribute("data-expired") || !canFade(row)) return;
    timers.set(row, ports.timers.set(() => {
      if (destroyed || row.parentElement !== lines) return;
      row.setAttribute("data-fading", "");
      timers.set(row, ports.timers.set(() => {
        if (destroyed || row.parentElement !== lines) return;
        if (row.hasAttribute("data-transient")) {
          removeRow(row);
          return;
        }
        timers.delete(row);
        row.removeAttribute("data-fading");
        row.setAttribute("data-expired", "");
        syncScrollable();
        maybeMinimize();
      }, GAME_LOG_FADE_MS));
    }, lineMs()));
  };

  /** How far a line must be swiped to delete it. */
  const swipeDistance = (row: HTMLElement): number => Math.min(SWIPE_DELETE_PX.max, Math.max(SWIPE_DELETE_PX.min, row.offsetWidth * SWIPE_DELETE_SHARE));

  /** A line follows a swipe, fading as it goes. */
  const follow = (row: HTMLElement, dx: number): void => {
    row.setAttribute("data-swiping", "");
    row.style.transform = `translateX(${dx}px)`;
    row.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / Math.max(1, row.offsetWidth)));
  };

  /** Slides a line out to the side it was swiped to, then deletes it. */
  const dismiss = (row: HTMLElement, direction: number): void => {
    if (destroyed || row.parentElement !== lines || row.hasAttribute("data-dismissed")) return;
    forgetTimers(row);
    row.setAttribute("data-dismissed", "");
    row.removeAttribute("data-swiping");
    row.style.transform = `translateX(${direction * (row.offsetWidth + 24)}px)`;
    row.style.opacity = "0";
    timers.set(row, ports.timers.set(() => removeRow(row), DISMISS_MS));
  };

  /** Where a swipe ends: far enough deletes the line, short of that it springs back. */
  const settleSwipe = (row: HTMLElement, dx: number): void => {
    if (destroyed || row.hasAttribute("data-dismissed")) return;
    if (Math.abs(dx) >= swipeDistance(row)) {
      dismiss(row, Math.sign(dx));
      return;
    }
    row.removeAttribute("data-swiping");
    row.style.transform = "";
    row.style.opacity = "";
  };

  const clearAll = (): void => {
    if (destroyed) return;
    for (const row of lines.children) forgetTimers(row);
    lines.replaceChildren();
    // Nothing is left to read in the history.
    open = false;
    element.removeAttribute("data-open");
    syncPeek();
    syncScrollable();
    setMinimized(false);
  };
  clear.addEventListener("click", clearAll);

  const print = (entry: GameLogEntry): GameLogLine => {
    const row = document.createElement("div");
    row.className = "game-log__line";
    const icon = span("game-log__icon");
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("button");
    text.type = "button";
    text.className = "game-log__text";
    text.title = "Copy message to clipboard";
    const value = span("game-log__value");
    const actions = span("game-log__actions");
    const bar = span("game-log__bar");
    // At the end of the line, as in a chat: deletes this message.
    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "game-log__delete";
    trash.setAttribute("aria-label", "Delete message");
    trash.title = "Delete message";
    trash.innerHTML = TRASH_ICON;
    trash.addEventListener("click", () => removeRow(row));
    row.append(icon, text, value, trash, actions, bar);

    let content = "";
    let removed = false;
    let revision = 0;
    // A sideways swipe, by touch, pen or mouse, deletes the line.
    let swipe: { pointerId: number; x: number; y: number; dx: number; active: boolean } | null = null;
    // The click that ends a swipe is not a request to copy.
    let swiped = false;
    const controls = (event: Event): boolean => event.composedPath().some(target => target === actions || target === trash);
    row.addEventListener("pointerdown", (event) => {
      swiped = false;
      if (destroyed || event.button !== 0 || controls(event)) return;
      swipe = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, active: false };
    });
    row.addEventListener("pointermove", (event) => {
      if (destroyed || !swipe || swipe.pointerId !== event.pointerId || row.hasAttribute("data-dismissed")) return;
      const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
      if (!swipe.active) {
        // A vertical move is the history scrolling.
        if (Math.abs(dy) > SWIPE_START_PX && Math.abs(dy) >= Math.abs(dx)) { swipe = null; return; }
        if (Math.abs(dx) <= SWIPE_START_PX) return;
        swipe.active = true;
        row.setPointerCapture?.(event.pointerId);
        // A mouse drag may have begun selecting the text it now moves.
        document.getSelection()?.removeAllRanges();
      }
      swipe.dx = dx;
      follow(row, dx);
    });
    const endSwipe = (event: PointerEvent, cancelled: boolean): void => {
      if (!swipe || swipe.pointerId !== event.pointerId) return;
      const { active, dx } = swipe;
      swipe = null;
      if (row.hasPointerCapture?.(event.pointerId)) row.releasePointerCapture(event.pointerId);
      if (!active) return;
      swiped = true;
      settleSwipe(row, cancelled ? 0 : dx);
    };
    row.addEventListener("pointerup", event => endSwipe(event, false));
    row.addEventListener("pointercancel", event => endSwipe(event, true));
    // A trackpad's two-finger swipe arrives as sideways wheel movement.
    let wheelDx = 0;
    row.addEventListener("wheel", (event) => {
      if (destroyed || row.parentElement !== lines || row.hasAttribute("data-dismissed") || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      wheelDx -= event.deltaX;
      ports.timers.clear(swipeTimers.get(row));
      swipeTimers.delete(row);
      if (Math.abs(wheelDx) >= swipeDistance(row)) {
        dismiss(row, Math.sign(wheelDx));
        return;
      }
      follow(row, wheelDx);
      swipeTimers.set(row, ports.timers.set(() => {
        swipeTimers.delete(row);
        wheelDx = 0;
        settleSwipe(row, 0);
      }, WHEEL_SETTLE_MS));
    }, { passive: false });
    row.addEventListener("click", (event) => {
      // An action may replace its own button before this click bubbles here.
      if (controls(event)) return;
      if (swiped) { swiped = false; return; }
      if (destroyed || row.parentElement !== lines) return;
      const copiedRevision = revision;
      void copyText(content).then(
        () => confirm(" (copied 2 clipboard)"),
        () => confirm(" (could not copy)"),
      );
      function confirm(suffix: string): void {
        // A download may update or remove the message while copying.
        if (destroyed || row.parentElement !== lines || revision !== copiedRevision) return;
        text.textContent = content + suffix;
        syncPeek();
        syncScrollable();
      }
    });

    const update = (next: GameLogEntry): void => {
      if (destroyed || removed || row.hasAttribute("data-dismissed") || (row.parentElement !== lines && revision > 0)) return;
      content = next.text;
      revision++;
      const tone = next.tone ?? "info";
      row.dataset.tone = tone;
      row.toggleAttribute("data-transient", next.keepInHistory === false);
      icon.textContent = ICONS[tone];
      text.textContent = next.text;

      const measured = typeof next.progress === "number" && Number.isFinite(next.progress)
        ? Math.max(0, Math.min(1, next.progress)) : null;
      bar.hidden = next.progress === undefined;
      if (bar.hidden) {
        bar.removeAttribute("role");
      } else {
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", next.text);
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        if (measured === null) bar.removeAttribute("aria-valuenow");
        else bar.setAttribute("aria-valuenow", String(Math.round(measured * 100)));
        bar.style.setProperty("--game-log-progress", `${(measured ?? 0) * 100}%`);
      }
      value.textContent = !bar.hidden && measured !== null ? `${Math.round(measured * 100)}%` : "";
      value.hidden = !value.textContent;

      actions.replaceChildren(...(next.actions ?? []).map(action => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.disabled = Boolean(action.disabled);
        if (action.pressed !== undefined) button.setAttribute("aria-pressed", String(action.pressed));
        button.addEventListener("click", () => { if (!destroyed && !removed && row.parentElement === lines) action.onClick(); });
        return button;
      }));
      actions.hidden = actions.childElementCount === 0;

      // A changed line is news again.
      row.removeAttribute("data-expired");
      setMinimized(false);
      schedule(row);
      syncPeek();
      syncScrollable();
    };

    if (!destroyed) {
      const readingHistory = lines.scrollTop > 0;
      const previousHeight = lines.scrollHeight;
      lines.prepend(row);
      update(entry);
      if (readingHistory) lines.scrollTop += lines.scrollHeight - previousHeight;
      while (lines.childElementCount > maxLines()) {
        const oldest = lines.lastElementChild!;
        forgetTimers(oldest);
        oldest.remove();
      }
      syncScrollable();
    }
    return {
      update,
      focusAction: () => { if (!destroyed && !removed && row.parentElement === lines) actions.querySelector("button")?.focus({ preventScroll: true }); },
      remove: () => { removeRow(row); removed = true; },
    };
  };

  peek.addEventListener("click", () => {
    if (destroyed) return;
    setMinimized(false);
    open = true;
    element.setAttribute("data-open", "");
    lines.scrollTop = 0;
    syncScrollable();
  });

  const releaseDrag = (target: HTMLElement, pointerId: number): void => {
    drag = null;
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
  };

  resize.addEventListener("pointerdown", (event) => {
    if (destroyed || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      originLeft: rect.left,
      originTop: rect.top,
      pointerId: event.pointerId,
      moved: false,
      previous: sized,
      // Keep the width request continuous if this drag changes the layout mode.
      centered: ports.isCentered(),
      rightAligned: ports.isRightAligned?.() === true,
      widthFixed: ports.resizesWidth?.() === false,
    };
    resize.setPointerCapture?.(event.pointerId);
  });
  resize.addEventListener("pointermove", (event) => {
    if (destroyed || !drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) > RESIZE_CLICK_PX || Math.abs(event.clientY - drag.startY) > RESIZE_CLICK_PX) {
      drag.moved = true;
    }
    const next = fitLogResize({
      origin: { left: drag.originLeft, top: drag.originTop, width: drag.startW, height: drag.startH },
      dx: drag.widthFixed ? 0 : event.clientX - drag.startX,
      dy: event.clientY - drag.startY,
      // Request dimensions only. The shell fits both docks and the log together.
      centered: drag.centered,
      rightAligned: drag.rightAligned,
      minLeft: -Infinity,
      maxRight: Infinity,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      maxHeight: Math.max(MIN_HEIGHT, ports.viewportHeight() - drag.originTop - LOG_DOCK_GAP),
    });
    if (!next) {
      releaseDrag(resize, event.pointerId);
      setMinimized(true);
      return;
    }
    // A drag that may change only the height keeps the preferred width, and does not claim width from the windows.
    sized = { width: drag.widthFixed ? drag.previous?.width ?? next.width : next.width, height: next.height };
    applySize(!drag.widthFixed);
  });
  resize.addEventListener("pointerup", (event) => {
    if (destroyed || !drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    const previous = drag.previous;
    releaseDrag(resize, event.pointerId);
    if (!moved) {
      sized = previous;
      setMinimized(true);
    }
  });
  resize.addEventListener("pointercancel", (event) => {
    if (destroyed || !drag || drag.pointerId !== event.pointerId) return;
    releaseDrag(resize, event.pointerId);
  });

  return {
    element,
    print,
    setBusy(next) {
      if (destroyed) return;
      busy = next;
      for (const row of lines.children) schedule(row as HTMLElement);
    },
    setOpen(next) {
      if (destroyed) return;
      open = next;
      element.toggleAttribute("data-open", open);
      if (open) setMinimized(false);
      if (open) lines.scrollTop = 0;
      syncScrollable();
    },
    isOpen: () => open,
    minimize() {
      if (destroyed) return;
      setMinimized(true);
    },
    isMinimized: () => minimized,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      drag = null;
      for (const timer of [...timers.values(), ...swipeTimers.values()]) ports.timers.clear(timer);
      timers.clear();
      swipeTimers.clear();
      element.remove();
      requestWidth(null);
    },
  };
}
