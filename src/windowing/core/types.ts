export type WindowSlotId = "primary" | "secondary";

export interface WindowTabDefinition<TabId extends string> {
  id: TabId;
  label: string;
  conflictGroup?: string;
  available?: boolean;
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
