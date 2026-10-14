// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { observeSurfaceGeometry, surfaceGeometryFields } from "./surfaceGeometry.js";

const canvasMeasure = (width: number, height: number, ratio = 2) => ({ rect: { left: 0, top: 0, right: width, bottom: height }, width: width * ratio, height: height * ratio });

describe("surface geometry", () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

  it("places a body on the canvas in CSS and framebuffer pixels", () => {
    const fields = surfaceGeometryFields({ left: 12.25, top: 40, right: 412.25, bottom: 340 }, canvasMeasure(800, 600, 1.5));

    expect(fields.cssRect).toEqual({ x: 12.25, y: 40, width: 400, height: 300 });
    // Edges round on their own: 18.375 → 18, 618.375 → 618; 60 → 60, 510 → 510.
    expect(fields.framebufferRect).toEqual({ x: 18, y: 60, width: 600, height: 450 });
    expect(fields).toMatchObject({ pixelsPerCssX: 1.5, pixelsPerCssY: 1.5, visible: true });
  });

  it("shares an edge between neighbors with no gap or overlap", () => {
    const canvas = canvasMeasure(1000, 500, 1.25);
    const left = surfaceGeometryFields({ left: 10.3, top: 0, right: 333.3, bottom: 100 }, canvas).framebufferRect;
    const right = surfaceGeometryFields({ left: 333.3, top: 0, right: 700.1, bottom: 100 }, canvas).framebufferRect;
    expect(left.x + left.width).toBe(right.x);
  });

  it("clips to the canvas, measures from its corner, and reports what is not shown", () => {
    const canvas = { rect: { left: 100, top: 50, right: 500, bottom: 350 }, width: 800, height: 600 };
    expect(surfaceGeometryFields({ left: 50, top: 300, right: 200, bottom: 400 }, canvas)).toMatchObject({
      cssRect: { x: 0, y: 250, width: 100, height: 50 },
      framebufferRect: { x: 0, y: 500, width: 200, height: 100 },
      visible: true,
    });
    expect(surfaceGeometryFields({ left: 600, top: 0, right: 700, bottom: 100 }, canvas).visible).toBe(false);
    expect(surfaceGeometryFields({ left: 150, top: 60, right: 200, bottom: 100 }, canvas, false).visible).toBe(false);
    expect(surfaceGeometryFields(null, canvas)).toMatchObject({ visible: false, pixelsPerCssX: 2, pixelsPerCssY: 2 });
  });

  it("reports unequal horizontal and vertical pixel ratios as measured", () => {
    const fields = surfaceGeometryFields({ left: 0, top: 0, right: 100, bottom: 100 }, { rect: { left: 0, top: 0, right: 400, bottom: 300 }, width: 800, height: 450 });
    expect(fields).toMatchObject({ pixelsPerCssX: 2, pixelsPerCssY: 1.5 });
  });

  it("commits a new revision only when the placement changes", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600; canvas.height = 1200;
    const body = document.createElement("div");
    document.body.append(canvas, body);
    let bodyRect = new DOMRect(20, 30, 300, 200);
    vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 800, 600));
    vi.spyOn(body, "getBoundingClientRect").mockImplementation(() => bodyRect);
    vi.spyOn(body, "getClientRects").mockImplementation(() => [bodyRect] as unknown as DOMRectList);

    const port = observeSurfaceGeometry(body, canvas);
    const seen: number[] = [];
    port.subscribe(() => seen.push(port.read().revision));
    const first = port.read();
    expect(first).toMatchObject({ revision: 0, visible: true, framebufferRect: { x: 40, y: 60, width: 600, height: 400 } });
    expect(Object.isFrozen(first)).toBe(true);
    expect(port.refresh()).toBe(first);

    // A move without a resize is found by the next frame's refresh.
    bodyRect = new DOMRect(60, 30, 300, 200);
    expect(port.refresh()).toMatchObject({ revision: 1, cssRect: { x: 60 } });
    // Page resizes commit at once.
    bodyRect = new DOMRect(60, 30, 320, 200);
    window.dispatchEvent(new Event("resize"));
    expect(port.read()).toMatchObject({ revision: 2, cssRect: { width: 320 } });
    expect(seen).toEqual([1, 2]);

    port.dispose();
    expect(port.read()).toMatchObject({ visible: false, revision: 3 });
    window.dispatchEvent(new Event("resize"));
    expect(port.read().revision).toBe(3);
  });

  it("is not visible while the body has no boxes", () => {
    const canvas = document.createElement("canvas");
    const body = document.createElement("div");
    document.body.append(canvas, body);
    vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 300, 150));
    vi.spyOn(body, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 100, 100));
    expect(observeSurfaceGeometry(body, canvas).read().visible).toBe(false);
  });
});
