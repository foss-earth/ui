import type { SettingsStorage } from "../settings/registry.js";
import { createSectionsElement, type SectionsElementEntry } from "./settings/parameterSection.js";

/** The host supplies every Settings section and owns the section handles. */
export function createSettingsView(sections: readonly SectionsElementEntry[], storage: SettingsStorage | null, document: Document) {
  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) throw new Error(`Duplicate Settings section "${section.id}".`);
    seen.add(section.id);
  }
  return createSectionsElement(sections, { document, storage });
}
