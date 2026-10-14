import type { WindowTabDefinition, WindowWorkspaceState } from "../windowing/core/types.js";

/**
 * Whether an image is participating: the selected tab on an expanded side
 * declares a surface. Context-hidden tabs are already out of the workspace.
 * Compact presentation uses this so a narrow width stacks the logical strips
 * instead of folding them into one window.
 */
export function surfaceParticipates<TabId extends string>(
  state: WindowWorkspaceState<TabId>,
  definitions: readonly WindowTabDefinition<TabId>[],
): boolean {
  const surface = new Set(definitions.filter(tab => tab.available !== false && tab.surface !== undefined).map(tab => tab.id));
  for (const slotId of ["primary", "secondary"] as const) {
    const slot = state[slotId];
    if (!slot.collapsed && slot.activeTab !== null && surface.has(slot.activeTab)) return true;
  }
  return false;
}
