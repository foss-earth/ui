/** How far the resize grip hangs below the panel's border box. */
export const PANEL_HANDLE_OVERFLOW_PX = 13;

/**
 * The tallest a panel may be while its resize grip stays inside the visual viewport.
 * `capPx` is an extra ceiling, such as half the screen on a phone.
 */
export function panelHeightLimit(viewportHeight: number, topPx: number, bottomClearancePx: number, minHeight: number, capPx?: number): number {
  const available = viewportHeight - topPx - bottomClearancePx;
  const capped = capPx === undefined ? available : Math.min(available, capPx);
  return Math.max(minHeight, capped);
}
