import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_SECONDARY_ASPECT_RATIO,
  DEFAULT_MIN_SECONDARY_WIDTH,
  resolveWindowViewportPolicy,
} from "./viewportPolicy";

describe("resolveWindowViewportPolicy", () => {
  it("returns compact mode for narrow phone-like viewports", () => {
    const policy = resolveWindowViewportPolicy({
      width: 430,
      height: 932,
      minSecondaryWidth: DEFAULT_MIN_SECONDARY_WIDTH,
      minSecondaryAspectRatio: DEFAULT_MIN_SECONDARY_ASPECT_RATIO,
    });

    expect(policy.secondaryAvailable).toBe(false);
    expect(policy.interactionMode).toBe("compact");
  });

  it("returns dual mode when width and aspect ratio requirements are met", () => {
    const policy = resolveWindowViewportPolicy({
      width: 1600,
      height: 900,
      minSecondaryWidth: DEFAULT_MIN_SECONDARY_WIDTH,
      minSecondaryAspectRatio: DEFAULT_MIN_SECONDARY_ASPECT_RATIO,
    });

    expect(policy.secondaryAvailable).toBe(true);
    expect(policy.interactionMode).toBe("dual");
  });
});
