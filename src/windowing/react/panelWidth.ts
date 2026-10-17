/**
 * Continue a window's width drag through the full available width. Past the
 * opposite edge, the window narrows from that edge; using the original side
 * and width lets the same gesture turn around without resetting its origin.
 */
export function resizePanelAcrossSides(
  startSide: "left" | "right",
  startWidth: number,
  maxWidth: number,
  deltaX: number,
  snapPx = 24,
): { side: "left" | "right"; width: number } {
  const requested = startWidth + (startSide === "right" ? -deltaX : deltaX);
  const crossed = requested > maxWidth + snapPx;
  return {
    side: crossed ? (startSide === "right" ? "left" : "right") : startSide,
    width: Math.abs(requested - maxWidth) <= snapPx
      ? maxWidth
      : crossed ? 2 * maxWidth - requested : requested,
  };
}
