import type { WindowSlotId, WindowWorkspaceState } from "./types.js";
import type { HiddenTab } from "./contextTabs.js";

/** One logical side as a wide screen shows it. */
export interface WindowSideSnapshot<TabId extends string> {
  /** The side's own tabs. Folding both into one window on a narrow screen does not move them. */
  readonly tabs: readonly TabId[];
  readonly activeTab: TabId | null;
  /** Minimized by the person. */
  readonly collapsed: boolean;
  /** Tabs the current context took from this side; they come back when it ends. */
  readonly contextHidden: readonly TabId[];
}

/** The committed logical workspace: what each side holds and shows, apart from how a screen width presents it. */
export interface WindowWorkspaceSnapshot<TabId extends string> {
  /** Increases with every committed change. */
  readonly revision: number;
  readonly primary: WindowSideSnapshot<TabId>;
  readonly secondary: WindowSideSnapshot<TabId>;
  /** The side the person last chose a tab in, opened one into or used; null before any. */
  readonly focusedSide: WindowSlotId | null;
  /** Only one window fits, so it shows both sides' tabs until the width returns. */
  readonly compact: boolean;
  /** A context such as a sphere is active. */
  readonly contextActive: boolean;
}

export type WindowWorkspaceSnapshotFields<TabId extends string> = Omit<WindowWorkspaceSnapshot<TabId>, "revision">;

export interface WorkspaceSnapshotSource<TabId extends string> {
  getSnapshot(): WindowWorkspaceSnapshot<TabId>;
  /** Called after each committed change. */
  subscribe(listener: () => void): () => void;
}

export interface WorkspaceSnapshotStore<TabId extends string> extends WorkspaceSnapshotSource<TabId> {
  /** Publishes `fields` with a new revision, unless nothing changed. */
  commit(fields: WindowWorkspaceSnapshotFields<TabId>): void;
}

const SLOT_IDS: readonly WindowSlotId[] = ["primary", "secondary"];

/** The snapshot fields for a workspace and the tabs its context hides. */
export function workspaceSnapshotFields<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  options: {
    contextHidden?: readonly HiddenTab<TabId>[];
    focusedSide?: WindowSlotId | null;
    compact?: boolean;
    contextActive?: boolean;
  } = {},
): WindowWorkspaceSnapshotFields<TabId> {
  const side = (slotId: WindowSlotId): WindowSideSnapshot<TabId> => ({
    tabs: [...state[slotId].tabs],
    activeTab: state[slotId].activeTab,
    collapsed: state[slotId].collapsed,
    contextHidden: (options.contextHidden ?? []).filter(entry => entry.slotId === slotId).map(entry => entry.tabId),
  });
  return {
    primary: side("primary"),
    secondary: side("secondary"),
    focusedSide: options.focusedSide ?? null,
    compact: options.compact ?? false,
    contextActive: options.contextActive ?? false,
  };
}

/** The tab a side shows: its selected tab, unless the person minimized the side. */
export function shownTabOfSide<TabId extends string>(
  snapshot: Pick<WindowWorkspaceSnapshot<TabId>, WindowSlotId>,
  slotId: WindowSlotId,
): TabId | null {
  const side = snapshot[slotId];
  return side.collapsed ? null : side.activeTab;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

export function sameWorkspaceSnapshotFields<TabId extends string>(
  a: WindowWorkspaceSnapshotFields<TabId>,
  b: WindowWorkspaceSnapshotFields<TabId>,
): boolean {
  return a.focusedSide === b.focusedSide
    && a.compact === b.compact
    && a.contextActive === b.contextActive
    && SLOT_IDS.every(slotId => (
      a[slotId].activeTab === b[slotId].activeTab
      && a[slotId].collapsed === b[slotId].collapsed
      && sameList(a[slotId].tabs, b[slotId].tabs)
      && sameList(a[slotId].contextHidden, b[slotId].contextHidden)
    ));
}

export function createWorkspaceSnapshotStore<TabId extends string>(
  initial: WindowWorkspaceSnapshotFields<TabId>,
): WorkspaceSnapshotStore<TabId> {
  let snapshot: WindowWorkspaceSnapshot<TabId> = Object.freeze({ ...initial, revision: 0 });
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    commit(fields) {
      if (sameWorkspaceSnapshotFields(snapshot, fields)) return;
      snapshot = Object.freeze({ ...fields, revision: snapshot.revision + 1 });
      for (const listener of [...listeners]) listener();
    },
  };
}
