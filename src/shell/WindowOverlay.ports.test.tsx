// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WindowOverlay, type WindowOverlayHandle } from "./WindowOverlay.js";

it("releases geometry, log, focus and layout through the supplied host ports", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const geometryStop = vi.fn(); const logStop = vi.fn(); const clear = vi.fn(); const publish = vi.fn();
  const visibility = vi.fn(); const onOpen = vi.fn(); const onClose = vi.fn();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const api: { current: WindowOverlayHandle<"host"> | null } = { current: null };
  try {
    await act(async () => root.render(<WindowOverlay<"host">
      tabDefinitions={[{ id: "host", label: "Host" }]} renderTabContent={() => <p>Host supplied content</p>}
      context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "host" }}
      restorableTabs={new Set(["host"])} storage={null} overlayApiRef={api} onTabVisibility={visibility} focus={{ onOpen, onClose }}
      geometry={{ observeWidth(_element, listener) { listener(1200); return geometryStop; }, menuBottom: () => null }}
      logSize={{ getWidth: () => null, subscribe: () => logStop }} layoutPort={{ publish, clear }}
    />));
    await act(async () => api.current!.openOrSelectTab("host"));
    expect(host.textContent).toContain("Host supplied content"); expect(visibility).toHaveBeenCalledWith("host", true); expect(onOpen).toHaveBeenCalledWith("host");
    await act(async () => api.current!.toggleTab("host")); expect(onClose).toHaveBeenCalledWith("host");
    await act(async () => api.current!.openOrSelectTab("host"));
    expect(publish).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  expect(api.current).toBeNull(); expect(geometryStop).toHaveBeenCalledOnce(); expect(logStop).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
  expect(visibility).toHaveBeenLastCalledWith("host", false);
});
