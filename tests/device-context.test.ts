import { afterEach, describe, expect, it, vi } from "vitest";
import { readDeviceContext } from "../src/browser/deviceContext.js";

afterEach(() => vi.unstubAllGlobals());

describe("host-owned browser device context", () => {
  it("uses the supplied view's reports despite unrelated ambient device data", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 64, maxTouchPoints: 0, deviceMemory: 64 });
    vi.stubGlobal("window", { devicePixelRatio: 4 });
    expect(readDeviceContext({ navigator: { hardwareConcurrency: 6, maxTouchPoints: 2, deviceMemory: 8 }, window: { devicePixelRatio: 1.5 } }))
      .toEqual({ devicePixelRatio: 1.5, hardwareConcurrency: 6, deviceMemoryGiB: 8, touch: true });
  });
  it("retains the no-navigator result without probing ambient browser or renderer state", () => {
    vi.stubGlobal("navigator", undefined); vi.stubGlobal("window", undefined);
    expect(readDeviceContext({ navigator: null, window: null })).toEqual({});
    expect(readDeviceContext({ navigator: { hardwareConcurrency: 0, maxTouchPoints: 0 }, window: null }))
      .toEqual({ devicePixelRatio: 1, hardwareConcurrency: null, deviceMemoryGiB: null, touch: false });
  });
  it("returns live supplied reports and keeps original zero/unknown fallbacks", () => {
    const navigator = { hardwareConcurrency: 4, maxTouchPoints: 0, deviceMemory: 0 }, window = { devicePixelRatio: 0 };
    expect(readDeviceContext({ navigator, window })).toEqual({ devicePixelRatio: 1, hardwareConcurrency: 4, deviceMemoryGiB: null, touch: false });
    navigator.hardwareConcurrency = 8; navigator.maxTouchPoints = 1; navigator.deviceMemory = 16; window.devicePixelRatio = 2;
    expect(readDeviceContext({ navigator, window })).toEqual({ devicePixelRatio: 2, hardwareConcurrency: 8, deviceMemoryGiB: 16, touch: true });
  });
});
