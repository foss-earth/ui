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
      // Flush puts the windows and the toolbar on the screen's edges.
      if (layout.edges === "flush") root.dataset.worldEdges = "flush";
      else delete root.dataset.worldEdges;
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
      delete root.dataset.worldEdges;
      delete root.dataset.logVisible;
      for (const name of ["--foss-log-left", "--foss-log-top", "--foss-log-center", "--foss-log-width", "--foss-world-top"]) root.style.removeProperty(name);
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

/** The world starts below the lowest window or launcher; the HUD stays at the screen's bottom. */
export function publishSplitBand(root: HTMLElement, band: HTMLElement | null): void {
  if (!band) {
    root.style.removeProperty("--foss-world-top");
    return;
  }
  const bottom = band.getBoundingClientRect().bottom;
  root.style.setProperty("--foss-world-top", `${bottom}px`);
}
