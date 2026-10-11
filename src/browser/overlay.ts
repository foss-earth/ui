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
      root.style.setProperty("--foss-log-left", `${layout.logLeft}px`);
      root.style.setProperty("--foss-log-top", `${layout.logTop}px`);
      root.style.setProperty("--foss-log-center", `${layout.logCenter}px`);
      root.style.setProperty("--foss-log-width", `${layout.logWidth}px`);
    },
    clear() {
      delete root.dataset.dockLayout;
      for (const name of ["--foss-log-left", "--foss-log-top", "--foss-log-center", "--foss-log-width"]) root.style.removeProperty(name);
    },
  };
}
