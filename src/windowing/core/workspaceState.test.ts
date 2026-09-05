import { describe, expect, it } from "vitest";
import {
  allWorkspaceOpenTabs,
  closeTabInWorkspace,
  createWindowWorkspaceState,
  openTabInWorkspace,
  setWorkspaceSlotCollapsed,
} from "./workspaceState";
import type { WindowTabDefinition } from "./types";

type TabId = "layers" | "buckets" | "stats" | "reach";

const TAB_DEFINITIONS: readonly WindowTabDefinition<TabId>[] = [
  { id: "layers", label: "Layers", conflictGroup: "point-control" },
  { id: "buckets", label: "Buckets", conflictGroup: "point-control" },
  { id: "stats", label: "Stats" },
  { id: "reach", label: "Reach" },
];

describe("window workspace state", () => {
  it("opens a tab in one slot and keeps it unique across both slots", () => {
    const state = createWindowWorkspaceState<TabId>({
      primary: { tabs: ["layers"], activeTab: "layers" },
      secondary: { tabs: ["stats"], activeTab: "stats" },
    });

    const next = openTabInWorkspace(state, "secondary", "layers", TAB_DEFINITIONS);

    expect(next.primary.tabs).toEqual([]);
    expect(next.primary.activeTab).toBeNull();
    expect(next.secondary.tabs).toEqual(["stats", "layers"]);
    expect(next.secondary.activeTab).toBe("layers");
  });

  it("enforces conflict groups when opening a tab", () => {
    const state = createWindowWorkspaceState<TabId>({
      primary: { tabs: ["layers", "stats"], activeTab: "layers" },
      secondary: { tabs: ["reach"], activeTab: "reach" },
    });

    const next = openTabInWorkspace(state, "secondary", "buckets", TAB_DEFINITIONS);

    expect(next.primary.tabs).toEqual(["stats"]);
    expect(next.secondary.tabs).toEqual(["reach", "buckets"]);
    expect(next.secondary.activeTab).toBe("buckets");
    expect(allWorkspaceOpenTabs(next)).toEqual(["stats", "reach", "buckets"]);
  });

  it("closes active tabs by selecting the last remaining tab", () => {
    const state = createWindowWorkspaceState<TabId>({
      primary: { tabs: ["layers", "stats"], activeTab: "stats" },
      secondary: { tabs: [], activeTab: null },
    });

    const next = closeTabInWorkspace(state, "primary", "stats");

    expect(next.primary.tabs).toEqual(["layers"]);
    expect(next.primary.activeTab).toBe("layers");
  });

  it("preserves tab order while toggling collapsed state", () => {
    const state = createWindowWorkspaceState<TabId>({
      primary: { tabs: ["layers", "stats"], activeTab: "stats", collapsed: false },
      secondary: { tabs: ["reach"], activeTab: "reach", collapsed: true },
    });

    const next = setWorkspaceSlotCollapsed(state, "primary", true);

    expect(next.primary.collapsed).toBe(true);
    expect(next.primary.tabs).toEqual(["layers", "stats"]);
    expect(next.primary.activeTab).toBe("stats");
  });
});
