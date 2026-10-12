import type { WindowOverlayGeometry, WindowOverlayLayoutPort } from "../windowing/core/overlayPorts.js";

/** Optional browser width observation; callers supply the surface and overlaid toolbar bound. */
export function browserOverlayGeometry(view: Window, menuBottom: WindowOverlayGeometry["menuBottom"]): WindowOverlayGeometry {
  return {
    menuBottom,
    observeWidth(element, listener) {
      const update = (): void => listener(element.clientWidth);
      update();
      const Constructor = (view as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      const observer = Constructor ? new Constructor(update) : null;
      observer?.observe(element); view.addEventListener("resize", update);
      return () => { observer?.disconnect(); view.removeEventListener("resize", update); };
    },
    observeHeight(element, listener) {
      const update = (): void => listener(element.getBoundingClientRect().height);
      update();
      const Constructor = (view as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      const observer = Constructor ? new Constructor(update) : null;
      observer?.observe(element); view.addEventListener("resize", update);
      return () => { observer?.disconnect(); view.removeEventListener("resize", update); };
    },
  };
}

/** Explicit compatibility bridge for the existing shared log/dock CSS allocation. */
export function browserOverlayLayout(root: HTMLElement): WindowOverlayLayoutPort {
  return {
    publish(layout) {
      root.dataset.dockLayout = layout.mode;
      root.dataset.worldPresentation = layout.presentation;
      root.dataset.logVisible = layout.logVisible ? "true" : "false";
      // The side of the window when only one shows.
      root.dataset.dockSide = layout.side;
      root.style.setProperty("--foss-log-left", `${layout.logLeft}px`);
      root.style.setProperty("--foss-log-top", `${layout.logTop}px`);
      root.style.setProperty("--foss-log-center", `${layout.logCenter}px`);
      root.style.setProperty("--foss-log-width", `${layout.logWidth}px`);
    },
    clear() {
      delete root.dataset.dockLayout;
      delete root.dataset.dockSide;
      delete root.dataset.worldPresentation;
      delete root.dataset.logVisible;
      delete root.dataset.hudInBand;
      for (const name of ["--foss-log-left", "--foss-log-top", "--foss-log-center", "--foss-log-width", "--foss-world-top", "--foss-split-hud-top"]) root.style.removeProperty(name);
    },
  };
}

/** The lowest window or launcher, ignoring a drop preview that only exists while a tab is dragged. */
export function lowestSplitBand(elements: Iterable<HTMLElement>): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    if (element.classList.contains("foss-earth-panel-launcher-drop-active")) continue;
    const next = element.getBoundingClientRect().bottom;
    if (next > bottom) {
      bottom = next;
      best = element;
    }
  }
  return best;
}

function toolbarBarHeight(root: HTMLElement): number {
  const raw = root.ownerDocument.defaultView?.getComputedStyle(root).getPropertyValue("--foss-hud-bar-height") ?? "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 28;
}

/**
 * The world starts where the UI ends. `edge` is where the toolbar sits in that
 * UI: on top, the window's bottom is the world; at the bottom, a short launcher
 * leaves one bar of space under it and a tall window keeps the bar inside its edge.
 */
export function publishSplitBand(root: HTMLElement, band: HTMLElement | null, edge: "top" | "bottom" = "bottom"): void {
  for (const host of root.querySelectorAll<HTMLElement>("[data-toolbar-host]")) delete host.dataset.toolbarHost;
  if (!band) {
    root.style.removeProperty("--foss-world-top");
    root.style.removeProperty("--foss-split-hud-top");
    delete root.dataset.hudInBand;
    return;
  }
  const collapsed = band.dataset.collapsed === "true" || band.classList.contains("foss-earth-workspace-slot-launcher");
  const bottom = band.getBoundingClientRect().bottom;
  const worldTop = edge === "bottom" && collapsed ? bottom + toolbarBarHeight(root) : bottom;
  if (edge === "bottom" && !collapsed) band.dataset.toolbarHost = "true";
  root.style.setProperty("--foss-split-hud-top", "env(safe-area-inset-top, 0px)");
  root.style.setProperty("--foss-world-top", `${worldTop}px`);
  root.dataset.hudInBand = edge;
}
