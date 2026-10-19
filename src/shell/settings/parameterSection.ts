import type { SettingsRegistry, SettingsStorage } from "../../settings/registry.js";
import { loadPanelSectionsOpen, savePanelSectionsOpen } from "../panelSectionsOpen.js";
import { createParameterControl, isParameterPending, isStandaloneParameterControl, parameterStartValue, type ParameterControlHandle } from "./controls.js";
import { sameValue } from "../../settings/values.js";
import { createParameterList, createSettingsTransfer, type ParameterListHandle, type SettingsTransferHandle } from "./parameterList.js";
import { createPresetStatus } from "./presetsSection.js";
import { createHelpTooltip } from "../helpTooltip.js";

export interface ParameterSectionOptions {
  /** Host-owned DOM realm; every control uses this document. */
  document: Document;
  tab: string;
  section: string;
  /** The section's own controls, drawn first. */
  main?: HTMLElement;
  /** Main-level parameters `main` already edits; the rest get a control each. */
  covers?: readonly string[];
  /** Drawn after the section's controls, before Show all parameters. */
  footer?: HTMLElement;
  /** Leave out the Show all parameters toggle, for a section with nothing but main controls. */
  showAll?: boolean;
  /** Storage for presentation choices, separate from the host settings record. */
  panelStorage?: SettingsStorage | null;
  /** Required shared host refresh authority; the section starts no clock. */
  refresh: { subscribe(listener: () => void): () => void };
  /** Apply & reload for values that apply on the next start. Defaults to reloading the page. */
  reload?: () => void;
}

export interface ParameterSectionHandle {
  element: HTMLElement;
  destroy(): void;
}

let sectionCount = 0;

/** Browser presentation defaults belong to the supplied document's origin. */
function presentationStorage(document: Document, storage: SettingsStorage | null | undefined): SettingsStorage | null {
  if (storage !== undefined) return storage;
  try { return document.defaultView?.localStorage ?? null; } catch { return null; }
}

/**
 * One section of a tab: whether its values match a preset, its own controls,
 * a control for each main-level parameter homed here that they don't cover
 * (hosts' included), and, when the section has parameters homed at level
 * "all", the Show all parameters toggle. That list is only those extra
 * parameters, with value, default, provenance, help and source, plus export,
 * import and reset for the section. Saving a preset belongs to the tab.
 */
export function createParameterSection(settings: SettingsRegistry, options: ParameterSectionOptions): ParameterSectionHandle {
  if (!options.refresh || typeof options.refresh.subscribe !== "function") throw new TypeError("A shared host reading refresh subscription is required.");
  const { tab, section, document } = options;
  if (!document || typeof document.createElement !== "function") throw new TypeError("A host Document is required.");
  const panelStorage = presentationStorage(document, options.panelStorage);
  const covered = new Set(options.covers ?? []);
  const element = document.createElement("div");
  element.className = "foss-earth-parameter-section";
  element.dataset.settingsSection = `${tab}/${section}`;
  // "Matches Sharpest", or "Custom", where a preset has values in this section.
  const presetStatus = createPresetStatus(settings, { tab, section }, document);
  element.append(presetStatus.element);
  if (options.main) element.append(options.main);
  const auto = document.createElement("div");
  auto.className = "foss-earth-choices foss-earth-parameter-section__main";
  element.append(auto);
  // Values that apply on the next start: say so at once, with an explicit apply.
  const pending = document.createElement("div");
  pending.className = "foss-earth-choices foss-earth-parameter-section__pending";
  pending.hidden = true;
  const pendingText = document.createElement("p");
  pendingText.className = "foss-earth-parameter-section__pending-text";
  pendingText.setAttribute("role", "status");
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "foss-earth-choice foss-earth-parameter__action";
  applyButton.textContent = "Apply & reload";
  applyButton.setAttribute("aria-label", "Apply pending changes and reload");
  const discardButton = document.createElement("button");
  discardButton.type = "button";
  discardButton.className = "foss-earth-choice foss-earth-parameter__action";
  discardButton.textContent = "Discard";
  discardButton.setAttribute("aria-label", "Discard pending changes");
  pending.append(pendingText, applyButton, discardButton);
  element.append(pending);
  if (options.footer) element.append(options.footer);
  const controls = new Map<string, ParameterControlHandle>();
  const pendingIds = (): string[] => settings.list({ tab, section }).filter(spec => isParameterPending(settings, spec.id)).map(spec => spec.id);
  const syncPending = (): void => {
    const ids = pendingIds();
    pending.hidden = ids.length === 0;
    const text = ids.length === 0 ? "" : "Changes pending";
    if (pendingText.textContent !== text) pendingText.textContent = text;
  };
  const onApply = (): void => { if (options.reload) options.reload(); else document.defaultView?.location.reload(); };
  const onDiscard = (): void => {
    for (const id of pendingIds()) {
      const start = parameterStartValue(settings, id);
      if (sameValue(start, settings.inspect(id).defaultValue)) settings.reset(id);
      else settings.set(id, start);
    }
  };
  applyButton.addEventListener("click", onApply);
  discardButton.addEventListener("click", onDiscard);

  const allKey = `all:${tab}/${section}`;
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "foss-earth-parameter-section__toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.name = `foss-earth-show-all-${++sectionCount}`;
  const toggleText = document.createElement("span");
  toggleText.textContent = "Show all parameters";
  // The label text first, then the native checkbox drawn as a switch.
  const toggleSwitch = document.createElement("span");
  toggleSwitch.className = "foss-earth-choice foss-earth-switch";
  const toggleKnob = document.createElement("span");
  toggleKnob.className = "foss-earth-switch__knob";
  toggleKnob.setAttribute("aria-hidden", "true");
  toggleSwitch.append(toggle, toggleKnob);
  toggleLabel.append(toggleText, toggleSwitch);
  const toggleRow = document.createElement("div");
  toggleRow.className = "foss-earth-choices foss-earth-parameter-section__footer";
  element.append(toggleRow);
  let list: ParameterListHandle | null = null;
  let transfer: SettingsTransferHandle | null = null;
  let visibilityDependencies = new Set<string>();

  const showAll = (open: boolean): void => {
    if (!toggleLabel.isConnected) open = false;
    toggle.checked = open;
    if (open && !list) {
      list = createParameterList(settings, { tab, section, level: "all" }, document);
      transfer = createSettingsTransfer(settings, { tab, section }, `${tab}-${section}`, document);
      element.append(list.element, transfer.element);
    } else if (!open && list) {
      list.destroy();
      transfer?.destroy();
      list = null;
      transfer = null;
    }
  };

  const syncMain = (): void => {
    const specs = settings.list({ tab, section, level: "main" });
    visibilityDependencies = new Set(specs.flatMap(spec => spec.visibleWhen ? [spec.visibleWhen.id] : []));
    const ids = specs.filter(spec => !covered.has(spec.id) && isStandaloneParameterControl(settings, spec)).map(spec => spec.id);
    for (const [id, control] of controls) {
      if (!ids.includes(id)) { control.destroy(); controls.delete(id); }
    }
    let previous: HTMLElement | null = null;
    for (const id of ids) {
      let control = controls.get(id);
      if (!control) {
        control = createParameterControl(settings, id, document);
        controls.set(id, control);
      }
      if (control.element.previousElementSibling !== previous || control.element.parentElement !== auto) {
        if (previous) previous.after(control.element); else auto.prepend(control.element);
      }
      previous = control.element;
    }
    auto.hidden = controls.size === 0;
    const showExtras = options.showAll !== false && settings.list({ tab, section, level: "all" }).length > 0;
    if (showExtras) {
      if (!toggleLabel.isConnected) toggleRow.append(toggleLabel);
    } else if (toggleLabel.isConnected) {
      toggleLabel.remove();
      showAll(false);
    }
    toggleRow.hidden = !showExtras;
    presetStatus.update();
    syncPending();
  };
  const onToggle = (): void => {
    savePanelSectionsOpen({ ...loadPanelSectionsOpen(panelStorage), [allKey]: toggle.checked }, panelStorage);
    showAll(toggle.checked);
  };
  toggle.addEventListener("change", onToggle);

  syncMain();
  showAll(loadPanelSectionsOpen(panelStorage)[allKey] ?? false);
  // Readings change without the registry knowing: read them on the host
  // refresh authority, and only while the section can be seen.
  // A reading whose source went away is cleared on the next tick.
  let shownReadings = new Set<string>();
  let disposed = false;
  const refreshReadings = (): void => {
    if (disposed || !element.isConnected || element.closest("details")?.open === false) return;
    const ids = new Set<string>();
    for (const id of controls.keys()) if (settings.hasReading(id)) ids.add(id);
    if (list) for (const spec of settings.list({ tab, section })) if (settings.hasReading(spec.id)) ids.add(spec.id);
    const refresh = new Set([...ids, ...shownReadings]);
    shownReadings = ids;
    for (const id of refresh) controls.get(id)?.update();
    if (refresh.size > 0) list?.update(refresh);
  };
  // Borrow the same refresh authority as every other host section.
  const stopReadings = options.refresh.subscribe(refreshReadings);
  const unsubscribe = settings.subscribe(changed => {
    if (disposed) return;
    let rebuildMain = [...changed].some(id => visibilityDependencies.has(id));
    // No ids: the saved presets changed.
    let touched = changed.size === 0;
    for (const id of changed) {
      const spec = settings.spec(id);
      if (!spec || spec.home.tab !== tab || spec.home.section !== section) continue;
      touched = true;
      const control = controls.get(id);
      if (control) control.update();
      else rebuildMain = true;
    }
    if (rebuildMain) syncMain();
    else if (touched) { presetStatus.update(); syncPending(); }
    list?.update(changed);
  });

  return {
    element,
    destroy() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      stopReadings();
      toggle.removeEventListener("change", onToggle);
      applyButton.removeEventListener("click", onApply);
      discardButton.removeEventListener("click", onDiscard);
      for (const control of controls.values()) control.destroy();
      controls.clear();
      list?.destroy();
      transfer?.destroy();
      element.remove();
    },
  };
}

export interface SectionsElementEntry {
  id: string;
  title: string;
  element: HTMLElement;
  defaultOpen?: boolean;
  /** What the whole section is for, behind a ? that ends its title, also while it is collapsed. */
  help?: string | HTMLElement;
  /** The ? button's accessible name. Defaults to "Explain <title>". */
  helpLabel?: string;
}

export interface SectionsElementHandle {
  element: HTMLElement;
  /** Adds a section at the end, such as a host's. */
  append(entry: SectionsElementEntry): void;
  has(id: string): boolean;
  destroy(): void;
}

/**
 * Collapsible sections as plain DOM, for tabs whose content is an element:
 * the same look and remembered open state as SectionsPanel.
 */
export function createSectionsElement(entries: readonly SectionsElementEntry[], options: { document: Document; storage?: SettingsStorage | null }): SectionsElementHandle {
  const document = options.document;
  const storage = presentationStorage(document, options.storage);
  const element = document.createElement("div");
  element.className = "foss-earth-panel-sections foss-earth-panel-sections--inline";
  const ids = new Set<string>();
  const stops: (() => void)[] = [];
  let disposed = false;
  const append = (entry: SectionsElementEntry): void => {
    if (disposed) throw new Error("Sections element is disposed.");
    if (ids.has(entry.id)) throw new Error(`Duplicate Settings section "${entry.id}".`);
    ids.add(entry.id);
    const details = document.createElement("details");
    details.className = "foss-earth-panel-section";
    details.dataset.section = entry.id;
    details.open = loadPanelSectionsOpen(storage)[entry.id] ?? entry.defaultOpen ?? false;
    const summary = document.createElement("summary");
    summary.className = "foss-earth-panel-section__title";
    summary.textContent = entry.title;
    let frame: HTMLElement | null = null;
    if (entry.help !== undefined) {
      const content = document.createElement("div");
      if (typeof entry.help === "string") {
        const text = document.createElement("p");
        text.textContent = entry.help;
        content.append(text);
      } else content.append(entry.help);
      const help = createHelpTooltip({ label: entry.helpLabel ?? `Explain ${entry.title}`, content });
      help.element.classList.add("foss-earth-panel-section__help");
      // The ? sits just after the title but outside the summary, which is a
      // button: a button inside it would join its name, and open the section.
      // An invisible copy of the title sizes the grid column the ? follows.
      const measure = document.createElement("span");
      measure.className = "foss-earth-panel-section__measure";
      measure.setAttribute("aria-hidden", "true");
      measure.textContent = entry.title;
      frame = document.createElement("div");
      frame.className = "foss-earth-panel-section__frame";
      frame.append(measure, help.element);
      stops.push(() => help.destroy());
    }
    const body = document.createElement("div");
    body.className = "foss-earth-panel-section__body";
    body.append(entry.element);
    details.append(summary, body);
    const onToggle = (): void => {
      if (disposed) return;
      const saved = loadPanelSectionsOpen(storage);
      if ((saved[entry.id] ?? entry.defaultOpen ?? false) === details.open) return;
      savePanelSectionsOpen({ ...saved, [entry.id]: details.open }, storage);
    };
    details.addEventListener("toggle", onToggle);
    stops.push(() => details.removeEventListener("toggle", onToggle));
    if (frame) {
      frame.prepend(details);
      element.append(frame);
    } else element.append(details);
  };
  for (const entry of entries) append(entry);
  return {
    element,
    append,
    has: (id) => ids.has(id),
    destroy() { if (disposed) return; disposed = true; for (const stop of stops.splice(0)) stop(); element.remove(); },
  };
}

export interface HostSectionsHandle {
  destroy(): void;
}

/**
 * Adds a section for every section of `tab` that parameters are homed in but
 * the tab does not draw itself, so a host's parameters appear in FOSS Earth's
 * tabs: 0sfs's renderer/instruments becomes the Renderer tab's Instruments.
 */
export function appendHostSections(settings: SettingsRegistry, tab: string, sections: SectionsElementHandle, own: readonly string[], options: { document: Document; panelStorage?: SettingsStorage | null; refresh: ParameterSectionOptions["refresh"] }): HostSectionsHandle {
  const handles: ParameterSectionHandle[] = [];
  const sync = (): void => {
    for (const section of settings.sections(tab)) {
      const id = `${tab}.${section}`;
      if (own.includes(section) || sections.has(id)) continue;
      const handle = createParameterSection(settings, { document: options.document, tab, section, panelStorage: options.panelStorage, refresh: options.refresh });
      handles.push(handle);
      sections.append({ id, title: settings.getSectionTitle(tab, section), element: handle.element, defaultOpen: false });
    }
  };
  sync();
  const unsubscribe = settings.subscribe(changed => {
    if ([...changed].some(id => settings.spec(id)?.home.tab === tab)) sync();
  });
  return {
    destroy() {
      unsubscribe();
      for (const handle of handles) handle.destroy();
    },
  };
}
