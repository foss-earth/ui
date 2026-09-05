import { describe, expect, it } from "vitest";
import {
  computeDockPanelLayout,
  DEFAULT_DOCK_PANEL_LAYOUT_OPTIONS,
} from "./panelLayout";

describe("computeDockPanelLayout", () => {
  it("returns independent panel widths when only one panel is visible", () => {
    const layout = computeDockPanelLayout({
      viewportWidth: 1280,
      primaryVisible: true,
      secondaryVisible: false,
      primaryWidthOverride: null,
      secondaryWidthOverride: null,
      options: DEFAULT_DOCK_PANEL_LAYOUT_OPTIONS,
    });

    expect(layout.primaryWidth).toBeGreaterThan(0);
    expect(layout.secondaryWidth).toBeGreaterThan(0);
    expect(layout.primaryMaxWidth).toBe(layout.secondaryMaxWidth);
  });

  it("fits both panels inside the pair budget when both are visible", () => {
    const layout = computeDockPanelLayout({
      viewportWidth: 1360,
      primaryVisible: true,
      secondaryVisible: true,
      primaryWidthOverride: 900,
      secondaryWidthOverride: 900,
      options: DEFAULT_DOCK_PANEL_LAYOUT_OPTIONS,
    });

    const availableWidth = 1360 - DEFAULT_DOCK_PANEL_LAYOUT_OPTIONS.edgeGapPx * 2;
    expect(layout.primaryWidth + layout.secondaryWidth).toBeLessThanOrEqual(availableWidth);
    expect(layout.primaryMaxWidth).toBeGreaterThanOrEqual(layout.primaryWidth);
    expect(layout.secondaryMaxWidth).toBeGreaterThanOrEqual(layout.secondaryWidth);
  });
});
