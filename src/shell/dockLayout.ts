const GAP = 12;
const MIN_DOCK_WIDTH = 160;
const MIN_LOG_WIDTH = 160;
// A phone needs a readable window, rather than two compressed columns.
const STACKED_BREAKPOINT = 320 + MIN_LOG_WIDTH + GAP * 3;

export type DockLayoutMode = "stacked" | "single" | "dual";
export type DockResizePriority = "log" | "windows";
export type DockSide = "left" | "right";

export interface DockLayoutInput {
  availableWidth: number;
  primaryWidth: number;
  secondaryWidth: number;
  /** A resized log's preferred width; null uses its natural content width. */
  logWidth: number | null;
  /** The most recent manual resize keeps its requested space first. */
  priority?: DockResizePriority;
  previousMode?: DockLayoutMode;
  /** Measured height of the phone's window or launcher. */
  stackHeight?: number;
  /**
   * A window widened out of two. It stays alone, on its side, until it is narrowed
   * back, and a resized log does not shrink it to bring the other back. Otherwise
   * the right window is the one that stays when there is room for only one.
   */
  widened?: DockSide;
}

/**
 * One allocation for the windows and log, including the gaps between them.
 * Windows keep their requested widths, and the log takes the room left: centered
 * between two windows, beside one on the other side, or under one once a window is
 * too wide for the log beside it. A phone gives its window and log the full width.
 */
export function resolveDockLayout(input: DockLayoutInput) {
  const width = Math.max(0, input.availableWidth);
  const side = input.widened ?? "right";
  // A window may grow until it fills the row, which leaves the log room only under it.
  const maxWindowWidth = Math.max(MIN_DOCK_WIDTH, width - GAP * 2);
  const primary = Math.min(maxWindowWidth, Math.max(MIN_DOCK_WIDTH, input.primaryWidth));
  const secondary = Math.min(maxWindowWidth, Math.max(MIN_DOCK_WIDTH, input.secondaryWidth));
  const stackTop = GAP * 2 + Math.max(0, input.stackHeight ?? 30);
  if (width < STACKED_BREAKPOINT) {
    const fullWidth = Math.max(0, width - GAP * 2);
    return {
      mode: "stacked" as const,
      side,
      // The phone's window fills the row whatever its preference, so only its height changes.
      windowWidthFixed: true,
      primaryWidth: side === "left" ? fullWidth : primary,
      secondaryWidth: side === "right" ? fullWidth : secondary,
      logLeft: GAP,
      logTop: stackTop,
      logWidth: fullWidth,
      logCenter: width / 2,
      maxWindowWidth: fullWidth,
    };
  }
  const logPriority = input.priority === "log" && input.logWidth !== null;
  const requestedLog = Math.max(MIN_LOG_WIDTH, input.logWidth ?? 560);
  const kept = side === "left" ? primary : secondary;
  // A centered log must clear the larger dock on BOTH halves of the viewport.
  const centerCapacity = width - 2 * Math.max(primary, secondary) - GAP * 4;
  const sideCapacity = (width - requestedLog) / 2 - GAP * 2;
  const singleBudget = Math.max(0, width - GAP * 3);
  const singleLog = Math.min(requestedLog, singleBudget - kept);
  const dual = logPriority
    ? sideCapacity >= (input.widened ? Math.max(primary, secondary) : MIN_DOCK_WIDTH)
    : centerCapacity >= MIN_LOG_WIDTH && (
      input.previousMode !== "single" || input.logWidth === null || singleLog <= centerCapacity
    );

  if (dual) {
    const primaryWidth = logPriority ? Math.min(primary, sideCapacity) : primary;
    const secondaryWidth = logPriority ? Math.min(secondary, sideCapacity) : secondary;
    const logWidth = logPriority ? requestedLog : Math.min(requestedLog, centerCapacity);
    return {
      mode: "dual" as const,
      side,
      windowWidthFixed: false,
      primaryWidth,
      secondaryWidth,
      logLeft: (width - logWidth) / 2,
      logTop: GAP,
      logWidth,
      logCenter: width / 2,
      maxWindowWidth,
    };
  }

  // A resized log narrows the window beside it, down to the window's minimum.
  const singleMinimum = Math.min(MIN_DOCK_WIDTH, singleBudget / 2);
  const windowWidth = logPriority ? Math.min(kept, Math.max(singleMinimum, singleBudget - requestedLog)) : kept;
  const logRoom = singleBudget - windowWidth;
  const windowLeft = side === "left" ? GAP : width - GAP - windowWidth;
  const widths = side === "left"
    ? { primaryWidth: windowWidth, secondaryWidth: secondary }
    : { primaryWidth: primary, secondaryWidth: windowWidth };

  if (logRoom < MIN_LOG_WIDTH) {
    return {
      mode: "stacked" as const,
      side,
      windowWidthFixed: false,
      ...widths,
      logLeft: windowLeft,
      logTop: stackTop,
      logWidth: windowWidth,
      logCenter: windowLeft + windowWidth / 2,
      maxWindowWidth,
    };
  }

  const logWidth = Math.min(input.logWidth === null ? 380 : requestedLog, logRoom);
  const logLeft = side === "left" ? width - GAP - logWidth : GAP;
  return {
    mode: "single" as const,
    side,
    windowWidthFixed: false,
    ...widths,
    logLeft,
    logTop: GAP,
    logWidth,
    logCenter: logLeft + logWidth / 2,
    maxWindowWidth,
  };
}
