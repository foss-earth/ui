import type { resolveDockLayout } from "../../shell/dockLayout.js";

/** Context policy is supplied by the host that owns the tabs and their content. */
export interface OverlayContextPolicy<TabId extends string> {
  active: boolean;
  ready: boolean;
  baseOnlyTabs: ReadonlySet<TabId>;
  contextOnlyTabs: ReadonlySet<TabId>;
  entryTabId: TabId;
  /** Fit the entry tab to this body height while retaining the window's ordinary height. */
  measureEntry?(body: HTMLElement): number | null;
}
export interface WindowOverlayHandle<TabId extends string> {
  openOrSelectTab(tabId: TabId): void;
  toggleTab(tabId: TabId): void;
  closeTab(tabId: TabId): void;
}
export interface WindowOverlayGeometry {
  observeWidth(element: HTMLElement, listener: (width: number) => void): () => void;
  /** Tracks the phone's window/launcher so the log stays below it. */
  observeHeight?(element: HTMLElement, listener: (height: number) => void): () => void;
  menuBottom(): number | null | undefined;
}
export interface WindowOverlayLogSize {
  getWidth(): number | null;
  subscribe(listener: (change: { width: number | null; resized: boolean }) => void): () => void;
}
export interface WindowOverlayLayoutPort {
  publish(layout: ReturnType<typeof resolveDockLayout>): void;
  clear(): void;
}
