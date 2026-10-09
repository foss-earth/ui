/** Injected tree/snapshot/actions; UI imports no rendering implementation. */
export interface MeshInspectorPanelNode {
  id: number;
  name: string;
  children: readonly MeshInspectorPanelNode[];
  mesh: boolean;
  selected: boolean;
  mixed: boolean;
}
export interface MeshInspectorPanelSnapshot {
  roots: readonly MeshInspectorPanelNode[];
  enabled: boolean;
  error: string | null;
}
export interface MeshInspectorPanelPort {
  getSnapshot(): MeshInspectorPanelSnapshot;
  subscribe(listener: () => void): () => void;
  setSelected(id: number, selected: boolean): void;
  selectAll(selected: boolean): void;
}
