import { describe, expect, it } from "vitest";
import { resizePanelAcrossSides } from "./panelWidth.js";

describe("resizing through full width", () => {
  it.each(["left", "right"] as const)("widens from the %s, snaps, then narrows on the other side", side => {
    const direction = side === "left" ? 1 : -1;
    const opposite = side === "left" ? "right" : "left";
    const at = (distance: number) => resizePanelAcrossSides(side, 300, 400, direction * distance);
    expect(at(50)).toEqual({ side, width: 350 });
    expect(at(80)).toEqual({ side, width: 400 });
    expect(at(100)).toEqual({ side, width: 400 });
    expect(at(120)).toEqual({ side, width: 400 });
    expect(at(150)).toEqual({ side: opposite, width: 350 });
    expect(at(250)).toEqual({ side: opposite, width: 250 });
    // Turning around uses the same origin, including while crossing the snap zone.
    expect(at(100)).toEqual({ side, width: 400 });
    expect(at(50)).toEqual({ side, width: 350 });
    expect(at(0)).toEqual({ side, width: 300 });
  });

  it("leaves the minimum-width decision to the panel on either side", () => {
    expect(resizePanelAcrossSides("left", 300, 400, -150)).toEqual({ side: "left", width: 150 });
    expect(resizePanelAcrossSides("left", 300, 400, 350)).toEqual({ side: "right", width: 150 });
  });
});
