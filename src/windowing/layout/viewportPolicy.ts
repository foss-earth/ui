export interface WindowViewportPolicyInput {
  width: number;
  height: number;
  minSecondaryWidth: number;
  minSecondaryAspectRatio: number;
}

export interface WindowViewportPolicy {
  secondaryAvailable: boolean;
  interactionMode: "compact" | "dual";
}

export const DEFAULT_MIN_SECONDARY_WIDTH = 1100;
export const DEFAULT_MIN_SECONDARY_ASPECT_RATIO = 1.25;

export interface SecondarySlotFitInput {
  availableWidth: number;
  primaryMinWidth: number;
  secondaryMinWidth: number;
  centerGap: number;
  edgeGap: number;
}

/** Whether both side slots can fit without crowding the map between them. */
export function canFitSecondarySlot(input: SecondarySlotFitInput): boolean {
  const requiredWidth = input.primaryMinWidth
    + input.secondaryMinWidth
    + input.centerGap
    + input.edgeGap * 2;
  return Math.max(0, input.availableWidth) >= requiredWidth;
}

export function resolveWindowViewportPolicy(input: WindowViewportPolicyInput): WindowViewportPolicy {
  const safeWidth = Math.max(1, input.width);
  const safeHeight = Math.max(1, input.height);
  const aspectRatio = safeWidth / safeHeight;

  const secondaryAvailable =
    safeWidth >= input.minSecondaryWidth
    && aspectRatio >= input.minSecondaryAspectRatio;

  return {
    secondaryAvailable,
    interactionMode: secondaryAvailable ? "dual" : "compact",
  };
}
