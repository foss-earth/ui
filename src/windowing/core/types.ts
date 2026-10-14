export type WindowSlotId = "primary" | "secondary";

/**
 * A tab whose body the host draws itself, such as a photograph: no padding,
 * no scrolling and nothing added under it. When both sides select a surface
 * tab of the same `joinGroup`, the two share one body spanning both windows.
 */
export interface WindowTabSurface {
  joinGroup?: string;
}

export interface WindowTabDefinition<TabId extends string> {
  id: TabId;
  label: string;
  conflictGroup?: string;
  available?: boolean;
  surface?: WindowTabSurface;
}

export interface WindowSlotState<TabId extends string> {
  tabs: TabId[];
  activeTab: TabId | null;
  collapsed: boolean;
  width: number | null;
  height: number | null;
}

export interface WindowWorkspaceState<TabId extends string> {
  primary: WindowSlotState<TabId>;
  secondary: WindowSlotState<TabId>;
}
