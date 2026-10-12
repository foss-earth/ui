import { useState, type ReactNode } from "react";
import { AdoptedElement } from "./AdoptedElement.js";
import { loadPanelSectionsOpen, savePanelSectionsOpen } from "./panelSectionsOpen.js";
import type { SettingsStorage } from "../settings/registry.js";

/**
 * One collapsible group in a tab such as Settings or Controls. A host built on
 * imperative DOM hands over the `element` it already wired; a React host
 * supplies `render`. Section ids are shared across tabs, so keep them unique.
 */
export interface PanelSection {
  id: string;
  title: string;
  /** Open until the user closes it. Sections start closed otherwise. */
  defaultOpen?: boolean;
  element?: HTMLElement;
  render?: () => ReactNode;
}

export interface SectionsPanelProps {
  sections: readonly PanelSection[];
  /** The host's section-state storage. Omitted preserves browser persistence. */
  storage?: SettingsStorage | null;
  /** Drawn above the sections, with no heading of its own. */
  leading?: HTMLElement;
  /** Drawn once under the sections, such as the tab's Save as preset. */
  footer?: ReactNode;
}

export function SectionsPanel({ sections, storage, leading, footer }: SectionsPanelProps) {
  const [chosen, setChosen] = useState(() => loadPanelSectionsOpen(storage));
  const isOpen = (section: PanelSection): boolean => chosen[section.id] ?? section.defaultOpen ?? false;
  const toggle = (section: PanelSection, open: boolean): void => {
    setChosen((current) => {
      if ((current[section.id] ?? section.defaultOpen ?? false) === open) return current;
      const next = { ...current, [section.id]: open };
      savePanelSectionsOpen(next, storage);
      return next;
    });
  };
  return (
    <div className="foss-earth-panel-sections">
      {leading ? <AdoptedElement element={leading} className="foss-earth-panel-preface" /> : null}
      {sections.map((section) => (
        <details
          key={section.id}
          className="foss-earth-panel-section"
          data-section={section.id}
          open={isOpen(section)}
          onToggle={(event) => toggle(section, event.currentTarget.open)}
        >
          <summary className="foss-earth-panel-section__title">{section.title}</summary>
          {section.element
            ? <AdoptedElement element={section.element} className="foss-earth-panel-section__body" />
            : <div className="foss-earth-panel-section__body">{section.render?.()}</div>}
        </details>
      ))}
      {footer}
    </div>
  );
}
