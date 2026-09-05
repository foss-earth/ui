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
