import type { WindowTabDefinition } from "./types";

export function availableWindowTabs<TabId extends string>(
  definitions: readonly WindowTabDefinition<TabId>[],
): TabId[] {
  return definitions
    .filter((definition) => definition.available !== false)
    .map((definition) => definition.id);
}

export function buildTabConflictMap<TabId extends string>(
  definitions: readonly WindowTabDefinition<TabId>[],
): Map<TabId, Set<TabId>> {
  const byConflictGroup = new Map<string, TabId[]>();

  for (const definition of definitions) {
    if (!definition.conflictGroup) continue;
    const existing = byConflictGroup.get(definition.conflictGroup);
    if (existing) {
      existing.push(definition.id);
    } else {
      byConflictGroup.set(definition.conflictGroup, [definition.id]);
    }
  }

  const conflictMap = new Map<TabId, Set<TabId>>();

  for (const definition of definitions) {
    const conflicts = new Set<TabId>();
    if (definition.conflictGroup) {
      const members = byConflictGroup.get(definition.conflictGroup) ?? [];
      for (const member of members) {
        if (member !== definition.id) {
          conflicts.add(member);
        }
      }
    }
    conflictMap.set(definition.id, conflicts);
  }

  return conflictMap;
}

export function conflictingTabsFor<TabId extends string>(
  tabId: TabId,
  definitions: readonly WindowTabDefinition<TabId>[],
): Set<TabId> {
  return buildTabConflictMap(definitions).get(tabId) ?? new Set<TabId>();
}
