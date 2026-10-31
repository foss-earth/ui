/** CSS zoom is not inherited in computed styles, but every ancestor scales the element. */
export function elementZoom(element: Element): number {
  const view = element.ownerDocument.defaultView;
  if (!view) return 1;
  let scale = 1;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const zoom = Number.parseFloat(view.getComputedStyle(current).zoom);
    if (Number.isFinite(zoom) && zoom > 0) scale *= zoom;
  }
  return scale;
}
