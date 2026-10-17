import { describe, expect, it } from "vitest";
import { resolveDockLayout, type DockLayoutInput } from "./dockLayout.js";

const insetPreferences = { primaryWidth: 320, secondaryWidth: 320, logWidth: null, edges: "inset" as const };

describe("shared window and log layout", () => {
  it("defaults to flush overlay and changes presentation and edges only when explicitly requested", () => {
    const requests = { primaryWidth: null, secondaryWidth: null, logWidth: null };
    for (const edges of [undefined, "inset", "flush"] as const) {
      for (const availableWidth of [280, 390, 515, 516, 700, 848, 1280, 2400, 390, 1280]) {
        for (const presentation of [undefined, "auto", "overlay", "split"] as const) {
          for (const open of [{ left: true, right: true }, { left: true, right: false }, { left: false, right: true }]) {
            const input = { ...requests, edges, availableWidth, presentation, open };
            const layout = resolveDockLayout(input);
            expect(layout.edges, JSON.stringify(input)).toBe(edges ?? "flush");
            expect(layout.presentation, JSON.stringify(input)).toBe(presentation === "split" ? "split" : "overlay");
            if (edges !== "inset") expect(layout.logVisible, JSON.stringify(input)).toBe(false);
          }
        }
      }
    }
    expect(resolveDockLayout({ ...requests, availableWidth: 390, presentation: "overlay" })).toMatchObject({
      edges: "flush", secondaryWidth: 390, maxWindowWidth: 390,
    });
    expect(resolveDockLayout({ ...requests, availableWidth: 1280 })).toMatchObject({
      edges: "flush", mode: "columns", primaryWidth: 320, secondaryWidth: 320, maxWindowWidth: 1108,
    });
  });

  it("shows the centered log only once both windows and a minimum log fit", () => {
    const narrow = resolveDockLayout({ ...insetPreferences, availableWidth: 847 });
    const wide = resolveDockLayout({ ...insetPreferences, availableWidth: 848 });

    expect(narrow).toMatchObject({ mode: "columns", presentation: "overlay", logVisible: false, primaryWidth: 320, secondaryWidth: 320 });
    expect(wide).toEqual({
      mode: "dual",
      presentation: "overlay",
      edges: "inset",
      logVisible: true,
      side: "right",
      windowWidthFixed: false,
      primaryWidth: 320,
      secondaryWidth: 320,
      maxWindowWidth: 848 - 36 - 160,
      logLeft: 344,
      logTop: 12,
      logWidth: 160,
      logCenter: 424,
    });
  });

  it.each([[420, 320], [320, 420]])("keeps the log at viewport center with unequal windows (%s, %s)", (primaryWidth, secondaryWidth) => {
    const input = { ...insetPreferences, primaryWidth, secondaryWidth };
    expect(resolveDockLayout({ ...input, availableWidth: 1047 }).logVisible).toBe(false);
    const layout = resolveDockLayout({ ...input, availableWidth: 1048 });

    expect(layout.mode).toBe("dual");
    expect(layout.logLeft).toBe(444);
    expect(layout.logWidth).toBe(160);
    expect(layout.logCenter).toBe(524);
    expect(resolveDockLayout({ ...input, availableWidth: 1280 }).logCenter).toBe(640);
  });

  it("gives a manual log resize priority by shrinking windows, then hides the log instead of dropping a window", () => {
    const input = { ...insetPreferences, availableWidth: 1280 };
    const original = resolveDockLayout(input);
    const enlarged = resolveDockLayout({ ...input, logWidth: 640, priority: "log" });

    expect(enlarged).toMatchObject({
      mode: "dual",
      logVisible: true,
      primaryWidth: 296,
      secondaryWidth: 296,
      logLeft: 320,
      logWidth: 640,
      logCenter: 640,
    });
    expect(resolveDockLayout(input)).toEqual(original);
    const pastBothWindows = resolveDockLayout({ ...input, logWidth: 913, priority: "log", previousMode: "dual" });
    expect(pastBothWindows).toMatchObject({
      mode: "columns", logVisible: false, primaryWidth: 320, secondaryWidth: 320,
    });
  });

  it("gives a later window resize priority by squeezing the log, then keeps both windows when the log no longer fits", () => {
    const input = { ...insetPreferences, availableWidth: 1280, logWidth: 640, priority: "windows" as const, previousMode: "dual" as const };
    const widened = resolveDockLayout({ ...input, primaryWidth: 420 });
    const retreated = resolveDockLayout({ ...input, primaryWidth: 296, secondaryWidth: 296 });

    expect(widened).toMatchObject({ mode: "dual", primaryWidth: 420, secondaryWidth: 320, logWidth: 392, logCenter: 640 });
    expect(retreated).toMatchObject({ mode: "dual", primaryWidth: 296, secondaryWidth: 296, logWidth: 640, logCenter: 640 });
    expect(resolveDockLayout({ ...input, primaryWidth: 537, previousMode: "dual" })).toMatchObject({
      mode: "columns", logVisible: false, primaryWidth: 537, secondaryWidth: 320,
    });
  });

  it("keeps a widened log a tab until its requested width fits between the windows again", () => {
    const hidden = resolveDockLayout({ ...insetPreferences, availableWidth: 1280, logWidth: 913, priority: "log", previousMode: "dual" });
    const stillHidden = resolveDockLayout({
      ...insetPreferences, availableWidth: 1600, logWidth: 913, priority: "windows", previousMode: hidden.mode,
    });
    const restored = resolveDockLayout({
      ...insetPreferences, availableWidth: 1601, logWidth: 913, priority: "windows", previousMode: stillHidden.mode,
    });

    expect(hidden.mode).toBe("columns");
    expect(stillHidden.mode).toBe("columns");
    expect(restored).toMatchObject({ mode: "dual", logVisible: true, logWidth: 913, logCenter: 800.5 });
  });

  it.each([280, 320, 360, 390, 430, 515])("gives a phone one full-width window and no floating log at %s", (availableWidth) => {
    for (const priority of ["log", "windows"] as const) {
      for (const logWidth of [null, 160, 2000]) {
        const input: DockLayoutInput = { ...insetPreferences, availableWidth, logWidth, priority, presentation: "split" };
        const layout = resolveDockLayout(input);
        expect(layout).toMatchObject({
          mode: "stacked",
          presentation: "split",
          logVisible: false,
          windowWidthFixed: true,
          secondaryWidth: availableWidth,
          maxWindowWidth: availableWidth,
          logWidth: 0,
        });
        expect(input).toEqual({ ...insetPreferences, availableWidth, logWidth, priority, presentation: "split" });
      }
    }
  });

  it("returns to both windows, still without a log, at the first width that used to keep the log beside one window", () => {
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 515 }).mode).toBe("stacked");
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 516, previousMode: "stacked" })).toMatchObject({
      mode: "columns", presentation: "overlay", logVisible: false, primaryWidth: 240, secondaryWidth: 240,
    });
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 768, previousMode: "stacked" })).toMatchObject({
      mode: "columns", logVisible: false, primaryWidth: 320, secondaryWidth: 320,
    });
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 848, previousMode: "columns" }).mode).toBe("dual");
  });

  it("keeps both windows when one is widened, and stops that window where the other still has its minimum", () => {
    const at = (primaryWidth: number, previousMode?: "dual" | "columns" | "stacked") => resolveDockLayout({
      ...insetPreferences, availableWidth: 1280, primaryWidth, priority: "windows", previousMode, widened: "left",
    });

    expect(at(536)).toMatchObject({ mode: "dual", primaryWidth: 536, secondaryWidth: 320, logWidth: 160, logCenter: 640 });
    expect(at(537, "dual")).toMatchObject({ mode: "columns", side: "left", logVisible: false, primaryWidth: 537, secondaryWidth: 320 });
    expect(at(1084, "columns")).toMatchObject({ mode: "columns", primaryWidth: 1084, secondaryWidth: 160 });
    expect(at(2000, "columns")).toMatchObject({ mode: "columns", primaryWidth: 1084, secondaryWidth: 160, maxWindowWidth: 1084 });
    expect(at(536, "columns").mode).toBe("dual");
  });

  it("keeps a phone's full-width window on the side that stayed", () => {
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 390, widened: "left", presentation: "split" })).toMatchObject({
      mode: "stacked", side: "left", presentation: "split", windowWidthFixed: true, primaryWidth: 390, secondaryWidth: 320, logVisible: false,
    });
  });

  it("gives the one open split window the full width on a screen that could hold two", () => {
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 1200, presentation: "split", open: { left: false, right: true } })).toMatchObject({
      mode: "columns", presentation: "split", side: "right", windowWidthFixed: true, secondaryWidth: 1200, logVisible: false,
    });
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 1200, presentation: "split", open: { left: true, right: false } })).toMatchObject({
      mode: "columns", presentation: "split", side: "left", windowWidthFixed: true, primaryWidth: 1200, logVisible: false,
    });
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 1200, presentation: "split", open: { left: true, right: true } })).toMatchObject({
      mode: "dual", presentation: "split", windowWidthFixed: false, logVisible: true,
    });
  });

  it("lets a choice select overlay on a phone and split on a wide screen", () => {
    expect(resolveDockLayout({ ...insetPreferences, primaryWidth: null, secondaryWidth: null, availableWidth: 390, presentation: "overlay" })).toMatchObject({
      mode: "stacked", presentation: "overlay", secondaryWidth: 378,
    });
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 1200, presentation: "split" })).toMatchObject({
      mode: "dual", presentation: "split", logVisible: true,
    });
  });

  // A Galaxy Note 20 Ultra in portrait is 412 CSS px wide.
  it("starts a phone's overlay window full width, lets it be narrowed, and keeps a split window full width", () => {
    const phone = { availableWidth: 412, logWidth: null, primaryWidth: null, secondaryWidth: null, edges: "inset" as const };
    expect(resolveDockLayout({ ...phone, presentation: "overlay" })).toMatchObject({
      mode: "stacked", presentation: "overlay", side: "right", windowWidthFixed: false, secondaryWidth: 400, maxWindowWidth: 400,
    });
    expect(resolveDockLayout({ ...phone, presentation: "overlay", secondaryWidth: 260 })).toMatchObject({ windowWidthFixed: false, secondaryWidth: 260 });
    expect(resolveDockLayout({ ...phone, presentation: "overlay", secondaryWidth: 2000 }).secondaryWidth).toBe(400);
    expect(resolveDockLayout({ ...phone, presentation: "overlay", secondaryWidth: 100 }).secondaryWidth).toBe(160);
    expect(resolveDockLayout({ ...phone, presentation: "overlay", widened: "left", primaryWidth: 300 })).toMatchObject({ side: "left", primaryWidth: 300 });
    for (const presentation of [undefined, "auto", "overlay"] as const) {
      expect(resolveDockLayout({ ...phone, presentation, secondaryWidth: 260 }), presentation).toMatchObject({
        presentation: "overlay", windowWidthFixed: false, secondaryWidth: 260,
      });
    }
    expect(resolveDockLayout({ ...phone, presentation: "split", secondaryWidth: 260 })).toMatchObject({
      presentation: "split", windowWidthFixed: true, secondaryWidth: 412,
    });
  });

  // The grip's arrows come from windowWidthFixed alone, so a width the layout throws away must never be offered.
  it("uses a shown window's requested width exactly when its width is not fixed", () => {
    const widths = [280, 360, 412, 515, 516, 640, 847, 848, 1280, 1920];
    const requests = [null, 160, 240, 320, 420, 900];
    const opens = [{ left: true, right: true }, { left: true, right: false }, { left: false, right: true }];
    let resizable = 0, fixed = 0;
    for (const availableWidth of widths) {
      for (const presentation of [undefined, "auto", "overlay", "split"] as const) {
        for (const open of opens) {
          for (const widened of ["left", "right"] as const) {
            for (const [primaryWidth, secondaryWidth] of requests.flatMap(a => requests.map(b => [a, b] as const))) {
              for (const logWidth of [null, 600]) {
                const input: DockLayoutInput = { availableWidth, primaryWidth, secondaryWidth, logWidth, priority: logWidth === null ? "windows" : "log", presentation, open, widened };
                const layout = resolveDockLayout(input);
                const shownSides = layout.mode === "stacked" || layout.windowWidthFixed
                  ? [layout.side]
                  : (["left", "right"] as const).filter(side => open[side]);
                for (const side of shownSides) {
                  const key = side === "left" ? "primaryWidth" : "secondaryWidth";
                  const context = `${side} of ${JSON.stringify(input)}`;
                  const narrower = layout[key] - 24;
                  if (layout.windowWidthFixed) {
                    fixed++;
                    for (const request of [null, 160, narrower, 2000]) {
                      expect(resolveDockLayout({ ...input, [key]: request })[key], context).toBe(layout[key]);
                    }
                  } else if (narrower >= 160) {
                    // A grip drag asks for the width on screen less the drag; that must narrow the window.
                    resizable++;
                    expect(resolveDockLayout({ ...input, [key]: narrower, priority: "windows" })[key], context).toBeLessThan(layout[key]);
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(fixed).toBeGreaterThan(0);
    expect(resizable).toBeGreaterThan(0);
  });

  const mirrored = (side: "left" | "right") => (side === "left" ? "right" : "left");

  it("grows the window being dragged wider, on either side, by shrinking the other", () => {
    let checked = 0;
    for (const availableWidth of [516, 600, 700, 847, 848, 900, 1047, 1280, 1600]) {
      for (const primaryWidth of [160, 240, 320, 420, 570, 900]) {
        for (const secondaryWidth of [160, 240, 320, 420, 570, 900]) {
          for (const logWidth of [null, 600]) {
            for (const widened of [undefined, "left", "right"] as const) {
              for (const presentation of [undefined, "overlay", "split"] as const) {
                const input: DockLayoutInput = { availableWidth, primaryWidth, secondaryWidth, logWidth, widened, presentation, priority: logWidth === null ? "windows" : "log" };
                const layout = resolveDockLayout(input);
                if (layout.windowWidthFixed) continue;
                for (const side of ["left", "right"] as const) {
                  const key = side === "left" ? "primaryWidth" : "secondaryWidth";
                  const otherKey = side === "left" ? "secondaryWidth" : "primaryWidth";
                  if (layout[key] + 24 > layout.maxWindowWidth) continue;
                  // What a drag of the grip 24 px outward asks for: the width on screen plus the drag.
                  // Taking over from a log resize, WindowOverlay first pins the other window where it shows.
                  const other = input.priority === "log" ? { [otherKey]: layout[otherKey] } : {};
                  const next = resolveDockLayout({ ...input, ...other, [key]: layout[key] + 24, widened: side, priority: "windows", previousMode: layout.mode });
                  const context = `${side} of ${JSON.stringify(input)}`;
                  expect(next[key], context).toBeCloseTo(layout[key] + 24, 6);
                  expect(next[otherKey], context).toBeLessThanOrEqual(layout[otherKey] + 1e-6);
                  checked++;
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("lays out a mirrored workspace as the mirror image", () => {
    const widths = [280, 412, 516, 640, 848, 900, 1280];
    const requests = [null, 160, 320, 570, 900];
    for (const availableWidth of widths) {
      for (const primaryWidth of requests) {
        for (const secondaryWidth of requests) {
          for (const widened of ["left", "right"] as const) {
            for (const presentation of [undefined, "overlay", "split"] as const) {
              for (const open of [{ left: true, right: true }, { left: true, right: false }]) {
                for (const logWidth of [null, 600]) {
                  const priority = logWidth === null ? "windows" as const : "log" as const;
                  const layout = resolveDockLayout({ availableWidth, primaryWidth, secondaryWidth, widened, presentation, open, logWidth, priority });
                  const mirror = resolveDockLayout({
                    availableWidth, primaryWidth: secondaryWidth, secondaryWidth: primaryWidth, widened: mirrored(widened), presentation,
                    open: { left: open.right, right: open.left }, logWidth, priority,
                  });
                  const context = JSON.stringify({ availableWidth, primaryWidth, secondaryWidth, widened, presentation, open, logWidth });
                  expect(mirror, context).toEqual({ ...layout, side: mirrored(layout.side), primaryWidth: layout.secondaryWidth, secondaryWidth: layout.primaryWidth });
                }
              }
            }
          }
        }
      }
    }
  });

  it("never overlaps the windows, and floats the log only between them", () => {
    const widths = [280, 320, 390, 430, 515, 516, 640, 700, 847, 848, 1047, 1048, 1280, 1600, 1601, 1920];
    const dockWidths = [[160, 160], [160, 420], [320, 320], [420, 320], [320, 420], [420, 420], [900, 320], [320, 1300]];
    const logWidths = [null, 160, 380, 912, 913, 2000];

    for (const availableWidth of widths) {
      for (const [primaryWidth, secondaryWidth] of dockWidths) {
        for (const logWidth of logWidths) {
          for (const priority of ["log", "windows"] as const) {
            for (const previousMode of [undefined, "stacked", "columns", "dual"] as const) {
              for (const side of ["left", "right"] as const) {
                const input: DockLayoutInput = {
                  availableWidth, primaryWidth, secondaryWidth, logWidth, priority, previousMode, widened: side,
                  edges: "inset", presentation: availableWidth < 516 ? "split" : "overlay",
                };
                const layout = resolveDockLayout(input);
                const context = JSON.stringify(input);
                const shown = layout.mode === "stacked"
                  ? [side === "left" ? layout.primaryWidth : layout.secondaryWidth]
                  : [layout.primaryWidth, layout.secondaryWidth];

                expect(layout.side, context).toBe(side);
                expect(layout.presentation, context).toBe(layout.mode === "stacked" ? "split" : "overlay");
                expect(layout.logVisible, context).toBe(layout.mode === "dual");
                if (layout.mode === "stacked") {
                  expect(shown[0], context).toBe(availableWidth);
                  expect(layout.windowWidthFixed, context).toBe(true);
                  expect(layout.logWidth, context).toBe(0);
                } else {
                  expect(layout.windowWidthFixed, context).toBe(false);
                  expect(layout.primaryWidth, context).toBeGreaterThanOrEqual(160);
                  expect(layout.secondaryWidth, context).toBeGreaterThanOrEqual(160);
                  expect(layout.primaryWidth + layout.secondaryWidth + 36, context).toBeLessThanOrEqual(availableWidth + 1e-6);
                  expect(layout.primaryWidth, context).toBeLessThanOrEqual(layout.maxWindowWidth + 1e-6);
                  expect(layout.secondaryWidth, context).toBeLessThanOrEqual(layout.maxWindowWidth + 1e-6);
                }
                if (layout.mode === "dual") {
                  const logRight = layout.logLeft + layout.logWidth;
                  expect(layout.logTop, context).toBe(12);
                  expect(layout.logWidth, context).toBeGreaterThanOrEqual(160);
                  expect(layout.logLeft, context).toBeGreaterThanOrEqual(12 + layout.primaryWidth + 12 - 1e-6);
                  expect(logRight + 12, context).toBeLessThanOrEqual(availableWidth - 12 - layout.secondaryWidth + 1e-6);
                  expect(layout.logCenter, context).toBe(availableWidth / 2);
                }
                const repeated = resolveDockLayout({ ...input, previousMode: layout.mode });
                expect(repeated, context).toEqual(layout);
              }
            }
          }
        }
      }
    }
  });

  it("keeps the log out of the screen while it is held as a tab, at any width", () => {
    for (const availableWidth of [848, 1280, 2400]) {
      const held = resolveDockLayout({ ...insetPreferences, availableWidth, floatingLog: false });
      expect(held).toMatchObject({ mode: "columns", presentation: "overlay", logVisible: false, primaryWidth: 320, secondaryWidth: 320 });
      expect(resolveDockLayout({ ...insetPreferences, availableWidth }).mode).toBe("dual");
    }
    const prioritized = { ...insetPreferences, logWidth: 900, availableWidth: 1280, priority: "log" as const };
    expect(resolveDockLayout({ ...prioritized, floatingLog: false }).logVisible).toBe(false);
  });

  it("puts flush windows on the edges and keeps the log a tab", () => {
    for (const availableWidth of [848, 1280, 2400]) {
      const flush = resolveDockLayout({ ...insetPreferences, availableWidth, edges: "flush" });
      expect(flush).toMatchObject({ mode: "columns", presentation: "overlay", edges: "flush", logVisible: false, primaryWidth: 320, secondaryWidth: 320 });
      // Only the gap between the windows is kept free.
      expect(flush.maxWindowWidth).toBe(availableWidth - 12 - 160);
    }
    // Two wide windows share all but the gap between them.
    const shared = resolveDockLayout({ primaryWidth: 900, secondaryWidth: 900, logWidth: null, availableWidth: 1000, edges: "flush" });
    expect(shared.primaryWidth + shared.secondaryWidth).toBe(1000 - 12);
    const prioritized = { ...insetPreferences, logWidth: 400, availableWidth: 1280, priority: "log" as const, edges: "flush" as const };
    expect(resolveDockLayout(prioritized).logVisible).toBe(false);
    // A phone's overlay window starts as wide as the screen.
    expect(resolveDockLayout({ primaryWidth: null, secondaryWidth: null, logWidth: null, availableWidth: 390, presentation: "overlay", edges: "flush" }))
      .toMatchObject({ mode: "stacked", edges: "flush", secondaryWidth: 390, maxWindowWidth: 390 });
    expect(resolveDockLayout({ primaryWidth: null, secondaryWidth: null, logWidth: null, availableWidth: 390, presentation: "overlay", edges: "inset" }))
      .toMatchObject({ mode: "stacked", edges: "inset", secondaryWidth: 378 });
    // Split preserves the edge preference too.
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 390, presentation: "split", edges: "flush" })).toMatchObject({ presentation: "split", edges: "flush" });
    expect(resolveDockLayout({ ...insetPreferences, availableWidth: 1280, presentation: "split", edges: "flush" })).toMatchObject({ presentation: "split", edges: "flush" });
  });
});
