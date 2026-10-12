import { describe, expect, it } from "vitest";
import { panelHeightLimit } from "./panelHeight.js";

describe("panelHeightLimit", () => {
  it("keeps a tall fullscreen panel inside the shorter window left behind", () => {
    expect(panelHeightLimit(2000, 12, 80, 128)).toBe(1908);
    expect(panelHeightLimit(500, 12, 80, 128)).toBe(408);
  });

  it("also honors a fraction of the viewport, such as half a phone", () => {
    expect(panelHeightLimit(800, 12, 80, 128, 400)).toBe(400);
  });

  it("never goes under the panel's minimum", () => {
    expect(panelHeightLimit(100, 12, 80, 128)).toBe(128);
  });
});
