/** Browser chrome inset observation. The host supplies its target and view. */
export const VIEWPORT_INSET_BOTTOM_PROPERTY = "--foss-inset-bottom";

/** Existing keyboard cap and pinch rounding guard; units are CSS px and fractions. */
export const DEFAULT_VIEWPORT_INSET_POLICY = Object.freeze({ maxInsetPx: 200, maxInsetFraction: 0.25, scaleTolerance: 0.05 });
export interface ViewportInsetPolicy { maxInsetPx: number; maxInsetFraction: number; scaleTolerance: number }
export interface ViewportInsetsHandle { refresh(): void; dispose(): void }
export type ViewportInsetsView = Pick<Window, "visualViewport" | "addEventListener" | "removeEventListener">;

/** No global document/window access, observer timer, world frame request or private scheduler. */
export function trackViewportInsets(target: HTMLElement, view: ViewportInsetsView, policy: Readonly<ViewportInsetPolicy> = DEFAULT_VIEWPORT_INSET_POLICY): ViewportInsetsHandle {
  if (!Number.isFinite(policy.maxInsetPx) || policy.maxInsetPx < 0 || !Number.isFinite(policy.maxInsetFraction) || policy.maxInsetFraction < 0 || policy.maxInsetFraction > 1 || !Number.isFinite(policy.scaleTolerance) || policy.scaleTolerance < 0) {
    throw new RangeError("Viewport inset policy needs nonnegative finite CSS pixels/tolerance and a fraction in [0,1].");
  }
  let lastApplied: number | null = null, disposed = false;
  const resolveBottomInset = (): number => {
    const viewport = view.visualViewport;
    if (!viewport || Math.abs(viewport.scale - 1) > policy.scaleTolerance || !(target.clientHeight > 0)) return 0;
    const covered = target.clientHeight - viewport.height - viewport.offsetTop;
    const limit = Math.min(policy.maxInsetPx, target.clientHeight * policy.maxInsetFraction);
    return Math.min(Math.max(Math.round(covered), 0), limit);
  };
  const refresh = (): void => {
    if (disposed) return;
    const inset = resolveBottomInset();
    if (inset === lastApplied) return;
    lastApplied = inset;
    target.style.setProperty(VIEWPORT_INSET_BOTTOM_PROPERTY, `${inset}px`);
  };
  refresh();
  const viewport = view.visualViewport ?? null;
  viewport?.addEventListener("resize", refresh);
  viewport?.addEventListener("scroll", refresh);
  view.addEventListener("orientationchange", refresh);
  return { refresh, dispose() {
    if (disposed) return;
    disposed = true;
    viewport?.removeEventListener("resize", refresh);
    viewport?.removeEventListener("scroll", refresh);
    view.removeEventListener("orientationchange", refresh);
    target.style.removeProperty(VIEWPORT_INSET_BOTTOM_PROPERTY);
  } };
}
