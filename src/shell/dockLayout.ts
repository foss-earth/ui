const GAP = 12;
/** An overlay window's distance from the screen corner, and the HUD bar's side inset. */
const OVERLAY_EDGE = 6;
const MIN_DOCK_WIDTH = 160;
const DEFAULT_DOCK_WIDTH = 320;
const MIN_LOG_WIDTH = 160;
// A phone needs one readable window, rather than two compressed columns.
const STACKED_BREAKPOINT = 320 + MIN_LOG_WIDTH + GAP * 3;

export type DockLayoutMode = "stacked" | "columns" | "dual";
export type DockResizePriority = "log" | "windows";
export type DockSide = "left" | "right";
/** Overlay keeps the world full-screen under the windows. Split gives the windows the top band and the world only the remainder. */
export type WorldPresentation = "overlay" | "split";
/** Auto follows the screen: split on a phone, overlay when two windows fit. */
export type WorldPresentationChoice = "auto" | WorldPresentation;
/** Top puts the toolbar above the tabs. Bottom puts it on the edge with the world. */
export type ToolbarEdge = "top" | "bottom";
/** Auto is the top on a phone and the bottom when two windows fit. */
export type ToolbarEdgeChoice = "auto" | ToolbarEdge;

export interface DockLayoutInput {
  availableWidth: number;
  /** Null is a window the person never resized: 320 px, or a phone's full width. */
  primaryWidth: number | null;
  secondaryWidth: number | null;
  /** A resized log's preferred width; null uses its natural content width. */
  logWidth: number | null;
  /** The most recent manual resize keeps its requested space first. */
  priority?: DockResizePriority;
  previousMode?: DockLayoutMode;
  /**
   * The window resized last. When both no longer fit at their requested
   * widths it keeps its own and the other gives way; when the screen is only
   * wide enough for one, it is the one that stays.
   */
  widened?: DockSide;
  /** Auto is split on a phone and overlay once two windows fit. */
  presentation?: WorldPresentationChoice;
  /**
   * Which sides have a tab open. When split leaves one side empty, that window
   * takes the whole width. Absent means both sides are occupied.
   */
  open?: { left: boolean; right: boolean };
  /**
   * False keeps the log a tab at every width, as while two images share one
   * body. Absent lets it float whenever the widest arrangement fits.
   */
  floatingLog?: boolean;
}

export interface DockLayout {
  mode: DockLayoutMode;
  /** The floating log is only the widest arrangement: both windows, log centered. */
  logVisible: boolean;
  /** Split is the phone band: the drawing buffer is only the world under the windows. */
  presentation: WorldPresentation;
  side: DockSide;
  /**
   * The requested widths do not apply: the window spans the screen and its
   * grip changes only its height. Hosts take the grip's axes from this alone.
   */
  windowWidthFixed: boolean;
  primaryWidth: number;
  secondaryWidth: number;
  logLeft: number;
  logTop: number;
  logWidth: number;
  logCenter: number;
  maxWindowWidth: number;
}

function clampWidth(width: number, max: number): number {
  return Math.min(max, Math.max(MIN_DOCK_WIDTH, width));
}

/**
 * Both windows share the row. The window resized last keeps its size, so
 * either one can be dragged wider; with no resize yet, the wider request does.
 * The other takes what remains, down to the minimum.
 */
function fitColumns(primary: number, secondary: number, width: number, resized: DockSide | undefined): { primaryWidth: number; secondaryWidth: number; maxWindowWidth: number } {
  const maxWindowWidth = Math.max(MIN_DOCK_WIDTH, width - GAP * 3 - MIN_DOCK_WIDTH);
  const budget = Math.max(MIN_DOCK_WIDTH * 2, width - GAP * 3);
  let primaryWidth = clampWidth(primary, maxWindowWidth);
  let secondaryWidth = clampWidth(secondary, maxWindowWidth);
  if (primaryWidth + secondaryWidth > budget) {
    const kept = resized ?? (Math.abs(primaryWidth - secondaryWidth) < 1 ? null : primaryWidth > secondaryWidth ? "left" : "right");
    if (kept === null) {
      primaryWidth = budget / 2;
      secondaryWidth = budget / 2;
    } else if (kept === "left") {
      primaryWidth = Math.min(primaryWidth, budget - MIN_DOCK_WIDTH);
      secondaryWidth = budget - primaryWidth;
    } else {
      secondaryWidth = Math.min(secondaryWidth, budget - MIN_DOCK_WIDTH);
      primaryWidth = budget - secondaryWidth;
    }
  }
  return { primaryWidth, secondaryWidth, maxWindowWidth };
}

function chosenPresentation(choice: WorldPresentationChoice | undefined, automatic: WorldPresentation): WorldPresentation {
  return choice === "overlay" || choice === "split" ? choice : automatic;
}

/** Bottom unless Auto is asked to follow a phone, or Top is chosen. */
export function chosenToolbarEdge(choice: ToolbarEdgeChoice | undefined, stacked: boolean): ToolbarEdge {
  if (choice === "top" || choice === "bottom") return choice;
  return choice === "auto" && stacked ? "top" : "bottom";
}

function hiddenLog(width: number): Pick<DockLayout, "logVisible" | "logLeft" | "logTop" | "logWidth" | "logCenter"> {
  return { logVisible: false, logLeft: 0, logTop: 0, logWidth: 0, logCenter: width / 2 };
}

/**
 * One allocation for the windows and, on a wide screen, the log.
 * The log floats only when both windows and a centered log fit: that is the
 * widest arrangement. Otherwise both windows stay and the log is a tab, until
 * the screen is only wide enough for one window, which then fills the width:
 * always in split, and in overlay until the person narrows it.
 */
export function resolveDockLayout(input: DockLayoutInput): DockLayout {
  const width = Math.max(0, input.availableWidth);
  const side = input.widened ?? "right";
  const requestedPrimary = input.primaryWidth ?? DEFAULT_DOCK_WIDTH;
  const requestedSecondary = input.secondaryWidth ?? DEFAULT_DOCK_WIDTH;
  if (width < STACKED_BREAKPOINT) {
    const presentation = chosenPresentation(input.presentation, "split");
    // Split draws the world only under the band, so its window spans the width.
    // Overlay floats the window on the world: it starts full width and can be narrowed.
    const widthFixed = presentation === "split";
    const full = widthFixed ? width : Math.max(0, width - OVERLAY_EDGE * 2);
    const shown = (requested: number | null): number => (widthFixed ? full : clampWidth(requested ?? full, full));
    const hidden = (requested: number): number => clampWidth(requested, Math.max(full, MIN_DOCK_WIDTH));
    return {
      mode: "stacked",
      presentation,
      side,
      windowWidthFixed: widthFixed,
      primaryWidth: side === "left" ? shown(input.primaryWidth) : hidden(requestedPrimary),
      secondaryWidth: side === "right" ? shown(input.secondaryWidth) : hidden(requestedSecondary),
      maxWindowWidth: full,
      ...hiddenLog(width),
    };
  }

  const widePresentation = chosenPresentation(input.presentation, "overlay");
  const openLeft = input.open?.left !== false;
  const openRight = input.open?.right !== false;
  // One window in split uses the whole width. The empty side stays a launcher, not a blank half.
  if (widePresentation === "split" && openLeft !== openRight) {
    const span = openLeft ? "left" : "right";
    return {
      mode: "columns",
      presentation: "split",
      side: span,
      windowWidthFixed: true,
      primaryWidth: span === "left" ? width : clampWidth(requestedPrimary, Math.max(width, MIN_DOCK_WIDTH)),
      secondaryWidth: span === "right" ? width : clampWidth(requestedSecondary, Math.max(width, MIN_DOCK_WIDTH)),
      maxWindowWidth: width,
      ...hiddenLog(width),
    };
  }

  const requestedLog = Math.max(MIN_LOG_WIDTH, input.logWidth ?? 560);
  const logPriority = input.priority === "log" && input.logWidth !== null;
  const floatingLog = input.floatingLog !== false;
  const fitted = fitColumns(requestedPrimary, requestedSecondary, width, input.widened);
  if (logPriority && floatingLog) {
    const sideCapacity = (width - requestedLog) / 2 - GAP * 2;
    if (sideCapacity >= MIN_DOCK_WIDTH) {
      const logWidth = requestedLog;
      return {
        mode: "dual",
        presentation: chosenPresentation(input.presentation, "overlay"),
        logVisible: true,
        side,
        windowWidthFixed: false,
        primaryWidth: Math.min(fitted.primaryWidth, sideCapacity),
        secondaryWidth: Math.min(fitted.secondaryWidth, sideCapacity),
        logLeft: (width - logWidth) / 2,
        logTop: GAP,
        logWidth,
        logCenter: width / 2,
        maxWindowWidth: fitted.maxWindowWidth,
      };
    }
  }

  const larger = Math.max(fitted.primaryWidth, fitted.secondaryWidth);
  const centerCapacity = width - 2 * larger - GAP * 4;
  // A log the person widened stays a tab until that width fits again, so the
  // windows do not jump just to bring a too-wide log back to the center.
  const logFits = floatingLog && !logPriority && centerCapacity >= MIN_LOG_WIDTH && (
    input.logWidth === null || input.previousMode !== "columns" || centerCapacity + 1e-9 >= requestedLog
  );
  if (logFits) {
    const logWidth = Math.min(requestedLog, centerCapacity);
    return {
      mode: "dual",
      presentation: chosenPresentation(input.presentation, "overlay"),
      logVisible: true,
      side,
      windowWidthFixed: false,
      primaryWidth: fitted.primaryWidth,
      secondaryWidth: fitted.secondaryWidth,
      logLeft: (width - logWidth) / 2,
      logTop: GAP,
      logWidth,
      logCenter: width / 2,
      maxWindowWidth: fitted.maxWindowWidth,
    };
  }

  return {
    mode: "columns",
    presentation: chosenPresentation(input.presentation, "overlay"),
    side,
    windowWidthFixed: false,
    ...fitted,
    ...hiddenLog(width),
  };
}
