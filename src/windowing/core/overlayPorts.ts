import type { resolveDockLayout } from "../../shell/dockLayout.js";
import type { WindowSlotId } from "./types.js";
import type { WorkspaceSnapshotSource } from "./workspaceSnapshot.js";

/** Context policy is supplied by the host that owns the tabs and their content. */
export interface OverlayContextPolicy<TabId extends string> {
  active: boolean;
  ready: boolean;
  baseOnlyTabs: ReadonlySet<TabId>;
  contextOnlyTabs: ReadonlySet<TabId>;
  entryTabId: TabId;
  /** Keep tabs the person already opened, including base-only tabs, selected through this context. */
  preserveOpenTabs?: boolean;
  /** Fit the entry tab to this body height while retaining the window's ordinary height. */
  measureEntry?(body: HTMLElement): number | null;
}
export interface WindowOverlayHandle<TabId extends string> {
  openOrSelectTab(tabId: TabId): void;
  /**
   * Opens a tab that is not open yet on `slotId`'s side and selects it there;
   * an open tab is selected where it is. A tab registered in the same update
   * opens once its definition arrives.
   */
  openTabInSlot(tabId: TabId, slotId: WindowSlotId): void;
  toggleTab(tabId: TabId): void;
  closeTab(tabId: TabId): void;
  /** The committed logical workspace, for hosts whose content depends on both sides. */
  readonly workspace: WorkspaceSnapshotSource<TabId>;
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
