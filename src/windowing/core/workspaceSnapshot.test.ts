import { describe, expect, it } from "vitest";
import { createWindowWorkspaceState } from "./workspaceState.js";
import { createWorkspaceSnapshotStore, shownTabOfSide, workspaceSnapshotFields } from "./workspaceSnapshot.js";

type TabId = "settings" | "image" | "log";

const state = () => createWindowWorkspaceState<TabId>({
  primary: { tabs: ["settings", "image"], activeTab: "image" },
  secondary: { tabs: ["log"], activeTab: "log", collapsed: true },
});

describe("workspace snapshot", () => {
  it("describes both sides, the tabs a context hides from each, and the shown tab", () => {
    const fields = workspaceSnapshotFields(state(), {
      contextHidden: [{ tabId: "settings", slotId: "secondary", index: 0, active: false }],
      focusedSide: "secondary",
      compact: true,
      contextActive: true,
    });

    expect(fields).toEqual({
      primary: { tabs: ["settings", "image"], activeTab: "image", collapsed: false, contextHidden: [] },
      secondary: { tabs: ["log"], activeTab: "log", collapsed: true, contextHidden: ["settings"] },
      focusedSide: "secondary",
      compact: true,
      contextActive: true,
    });
    expect(shownTabOfSide(fields, "primary")).toBe("image");
    expect(shownTabOfSide(fields, "secondary")).toBeNull();
  });

  it("publishes a frozen snapshot with a new revision only when something changed", () => {
    const store = createWorkspaceSnapshotStore(workspaceSnapshotFields(state()));
    const seen: number[] = [];
    const stop = store.subscribe(() => seen.push(store.getSnapshot().revision));
    const first = store.getSnapshot();

    expect(first.revision).toBe(0);
    expect(Object.isFrozen(first)).toBe(true);
    store.commit(workspaceSnapshotFields(state()));
    expect(store.getSnapshot()).toBe(first);
    store.commit(workspaceSnapshotFields(state(), { focusedSide: "primary" }));
    store.commit(workspaceSnapshotFields(state(), { focusedSide: "primary", compact: true }));
    expect(seen).toEqual([1, 2]);

    stop();
    store.commit(workspaceSnapshotFields(state()));
    expect(seen).toEqual([1, 2]);
    expect(store.getSnapshot().revision).toBe(3);
  });
});
