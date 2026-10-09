// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEWPORT_INSET_BOTTOM_PROPERTY, trackViewportInsets as observeViewportInsets } from "./viewportInsets.js";
const trackViewportInsets = (target: HTMLElement) => observeViewportInsets(target, window);

interface FakeViewport {
  height: number;
  offsetTop: number;
  scale: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  emit: (type: string) => void;
}

function stubVisualViewport(initial: { height: number; offsetTop?: number; scale?: number }): FakeViewport {
  const listeners = new Map<string, Set<() => void>>();
  const viewport: FakeViewport = {
    height: initial.height,
    offsetTop: initial.offsetTop ?? 0,
    scale: initial.scale ?? 1,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  vi.stubGlobal("visualViewport", viewport);
  return viewport;
}

function createTarget(layoutHeight: number): HTMLElement {
  const target = document.createElement("div");
  vi.spyOn(target, "clientHeight", "get").mockReturnValue(layoutHeight);
  return target;
}

function insetOf(target: HTMLElement): string {
  return target.style.getPropertyValue(VIEWPORT_INSET_BOTTOM_PROPERTY);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trackViewportInsets", () => {
  it("publishes the chrome overlaying the page bottom", () => {
    stubVisualViewport({ height: 720 });
    const target = createTarget(800);

    const handle = trackViewportInsets(target);

    expect(insetOf(target)).toBe("80px");
    handle.dispose();
  });

  it("reports no inset when the visual viewport fills the layout viewport", () => {
    stubVisualViewport({ height: 800 });
    const target = createTarget(800);

    const handle = trackViewportInsets(target);

    expect(insetOf(target)).toBe("0px");
    handle.dispose();
  });

  it("updates when the toolbar collapses", () => {
    const viewport = stubVisualViewport({ height: 720 });
    const target = createTarget(800);
    const handle = trackViewportInsets(target);

    viewport.height = 800;
    viewport.emit("resize");

    expect(insetOf(target)).toBe("0px");
    handle.dispose();
  });

  it("caps the inset so a soft keyboard cannot launch the HUD up the screen", () => {
    stubVisualViewport({ height: 400 });
    const target = createTarget(800);

    const handle = trackViewportInsets(target);

    expect(insetOf(target)).toBe("200px");
    handle.dispose();
  });

  it("ignores the shrunken viewport while pinch zoomed", () => {
    stubVisualViewport({ height: 400, scale: 2 });
    const target = createTarget(800);

    const handle = trackViewportInsets(target);

    expect(insetOf(target)).toBe("0px");
    handle.dispose();
  });

  it("stops listening and clears the property on dispose", () => {
    const viewport = stubVisualViewport({ height: 720 });
    const target = createTarget(800);

    const handle = trackViewportInsets(target);
    handle.dispose();

    expect(insetOf(target)).toBe("");

    viewport.height = 600;
    viewport.emit("resize");
    expect(insetOf(target)).toBe("");
  });

  it("falls back to no inset when visualViewport is unavailable", () => {
    vi.stubGlobal("visualViewport", undefined);
    const target = createTarget(800);

    const handle = trackViewportInsets(target);

    expect(insetOf(target)).toBe("0px");
    handle.dispose();
  });
});
