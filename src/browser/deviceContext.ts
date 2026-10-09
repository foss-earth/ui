import type { DeviceContext } from "../settings/types.js";

export interface BrowserDeviceContextPorts {
  /** Browser reports from the host's own view; null means not reported. */
  navigator: (Pick<Navigator, "hardwareConcurrency" | "maxTouchPoints"> & { readonly deviceMemory?: number }) | null;
  window: Pick<Window, "devicePixelRatio"> | null;
}

/** What the supplied browser says before a renderer starts; no hardware probe. */
export function readDeviceContext(ports: BrowserDeviceContextPorts): Partial<DeviceContext> {
  const { navigator, window } = ports;
  if (navigator === null) return {};
  const memory = navigator.deviceMemory;
  return {
    devicePixelRatio: window === null ? 1 : window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGiB: typeof memory === "number" && memory > 0 ? memory : null,
    touch: (navigator.maxTouchPoints ?? 0) > 0,
  };
}
