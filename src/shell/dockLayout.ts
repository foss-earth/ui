const GAP = 12;
/** An overlay window's distance from the screen corner, and the HUD bar's side inset. */
const OVERLAY_EDGE = 6;
const MIN_DOCK_WIDTH = 160;
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
  primaryWidth: number;
  secondaryWidth: number;
  /** A resized log's preferred width; null uses its natural content width. */
  logWidth: number | null;
  /** The most recent manual resize keeps its requested space first. */
  priority?: DockResizePriority;
  previousMode?: DockLayoutMode;
  /**
   * Which window stays when the screen is only wide enough for one, as after
   * that window was the one last resized. It does not hide the other window
   * while both columns fit.
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

/** Both windows share the row. The wider request keeps its size; the other takes what remains, down to the minimum. */
function fitColumns(primary: number, secondary: number, width: number): { primaryWidth: number; secondaryWidth: number; maxWindowWidth: number } {
  const maxWindowWidth = Math.max(MIN_DOCK_WIDTH, width - GAP * 3 - MIN_DOCK_WIDTH);
  const budget = Math.max(MIN_DOCK_WIDTH * 2, width - GAP * 3);
  let primaryWidth = clampWidth(primary, maxWindowWidth);
  let secondaryWidth = clampWidth(secondary, maxWindowWidth);
  if (primaryWidth + secondaryWidth > budget) {
    if (Math.abs(primaryWidth - secondaryWidth) < 1) {
      primaryWidth = budget / 2;
      secondaryWidth = budget / 2;
    } else if (primaryWidth > secondaryWidth) {
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
 * the screen is only wide enough for one window, which then fills the width.
 */
export function resolveDockLayout(input: DockLayoutInput): DockLayout {
  const width = Math.max(0, input.availableWidth);
  const side = input.widened ?? "right";
  if (width < STACKED_BREAKPOINT) {
    const presentation = chosenPresentation(input.presentation, "split");
    const full = presentation === "split" ? width : Math.max(0, width - OVERLAY_EDGE * 2);
    const primary = clampWidth(input.primaryWidth, Math.max(full, MIN_DOCK_WIDTH));
    const secondary = clampWidth(input.secondaryWidth, Math.max(full, MIN_DOCK_WIDTH));
    return {
      mode: "stacked",
      presentation,
      side,
      windowWidthFixed: true,
      primaryWidth: side === "left" ? full : primary,
      secondaryWidth: side === "right" ? full : secondary,
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
      primaryWidth: span === "left" ? width : clampWidth(input.primaryWidth, Math.max(width, MIN_DOCK_WIDTH)),
      secondaryWidth: span === "right" ? width : clampWidth(input.secondaryWidth, Math.max(width, MIN_DOCK_WIDTH)),
      maxWindowWidth: width,
      ...hiddenLog(width),
    };
  }

  const requestedLog = Math.max(MIN_LOG_WIDTH, input.logWidth ?? 560);
  const logPriority = input.priority === "log" && input.logWidth !== null;
  const floatingLog = input.floatingLog !== false;
  const fitted = fitColumns(input.primaryWidth, input.secondaryWidth, width);
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
