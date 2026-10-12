import type { SettingsRegistry } from "../../settings/registry.js";
import type { NumberRange, ParameterChoice, ParameterSpec, ParameterState, ParameterValue } from "../../settings/types.js";
import { formatNumber, formatQuantity, formatValue, isNumberRange, sameValue } from "../../settings/values.js";
import { createTrack, type TrackHandle } from "./track.js";
import { createTwoPositionSlider } from "./twoPositionSlider.js";
import { createHelpTooltip } from "../helpTooltip.js";

export interface ParameterControlHandle {
  /** The control, with help last and the source link in that explanation. */
  element: HTMLElement;
  /** Re-reads the registry. Cheap when nothing changed. */
  update(): void;
  destroy(): void;
}

let controlCount = 0;

/** Conditional controls stay out of both section layouts and Show all parameters. */
export function isParameterControlVisible(settings: SettingsRegistry, spec: ParameterSpec): boolean {
  const guard = spec.visibleWhen;
  return !guard || Boolean(settings.spec(guard.id) && sameValue(settings.get(guard.id), guard.value));
}

/** Paired fields belong to the existing control rather than another row. */
export function isStandaloneParameterControl(settings: SettingsRegistry, spec: ParameterSpec): boolean {
  return isParameterControlVisible(settings, spec) && (!spec.inlineWith || !settings.spec(spec.inlineWith));
}

/** A position on a parameter's track: the value, or its log2, negated for a reversed track. */
export function trackPosition(spec: ParameterSpec, value: number): number {
  const position = spec.scale === "log2" ? Math.log2(Math.max(value, Number.MIN_VALUE)) : value;
  return spec.track?.reversed ? -position : position;
}

/** The value at a track position, rounded to what the control can show. */
export function valueAtTrackPosition(spec: ParameterSpec, position: number, bounds: NumberRange | null): number {
  const raw = spec.track?.reversed ? -position : position;
  let value: number;
  if (spec.scale === "log2") {
    value = 2 ** raw;
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 3;
    value = Math.round(value * 10 ** digits) / 10 ** digits;
  } else {
    const step = spec.step ?? (spec.unit === "count" ? 1 : 0);
    value = step > 0 ? Math.round(raw / step) * step : raw;
    value = Math.round(value * 1e6) / 1e6;
  }
  if (spec.unit === "count") value = Math.round(value);
  if (bounds) value = Math.max(bounds.min, Math.min(bounds.max, value));
  return Object.is(value, -0) ? 0 : value;
}

export function trackStep(spec: ParameterSpec, bounds: NumberRange | null): number {
  if (spec.scale === "log2") return spec.step ?? 0.05;
  if (spec.step) return spec.step;
  if (spec.unit === "count") return 1;
  return bounds ? (bounds.max - bounds.min) / 200 : 0.01;
}

function trackBounds(spec: ParameterSpec, bounds: NumberRange): { min: number; max: number } {
  const a = trackPosition(spec, bounds.min);
  const b = trackPosition(spec, bounds.max);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Ends a sentence with a full stop unless it already has one. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Where a parameter's value came from, in a few words: "set by you", "from the URL for this visit". */
export function describeProvenance(state: ParameterState): string {
  switch (state.provenance) {
    case "default": return "default";
    case "host-default": return "the app's default";
    case "preset": return `from the preset ${state.preset ?? ""}`.trim();
    case "user": return "set by you";
    case "url": return "from the URL for this visit, not saved";
    case "host": return `set by the app: ${(state.layers.forced?.reason ?? "").replace(/[.]$/, "")}`.replace(/: $/, "");
  }
}

function noteFor(state: ParameterState, startValue: ParameterValue): string {
  const parts: string[] = [];
  if (state.note) parts.push(state.note);
  if (state.provenance === "url" || state.provenance === "host") {
    const words = describeProvenance(state);
    parts.push(sentence(words.charAt(0).toUpperCase() + words.slice(1)));
  }
  if (!state.spec.appliesLive && !sameValue(state.value, startValue)) parts.push("Applies when the app next starts.");
  if (state.spec.readOnly) parts.push(state.spec.readOnly);
  return parts.join(" ");
}

function createNote(document: Document): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "foss-earth-choices__note foss-earth-parameter__note";
  note.setAttribute("role", "status");
  note.hidden = true;
  return note;
}

function setNote(note: HTMLElement, text: string, reveal = false): void {
  note.hidden = text === "";
  if (note.textContent !== text) note.textContent = text;
  if (reveal && text) {
    const event = note.ownerDocument.createEvent("Event");
    event.initEvent("parameter-invalid", true, false);
    note.dispatchEvent(event);
  }
}

/** One compact accessory row; explanations stay closed until requested. */
function withParameterActions(document: Document, settings: SettingsRegistry, spec: ParameterSpec, control: ParameterControlHandle): ParameterControlHandle {
  const explanation = document.createElement("div");
  const tooltip = createHelpTooltip({ label: `Explain ${spec.label}`, content: explanation, onOpen: () => updateActions() });
  const help = tooltip.button;
  const description = document.createElement("p");
  description.className = "foss-earth-parameter-row__description";
  description.textContent = spec.description;
  const meta = document.createElement("p");
  meta.className = "foss-earth-parameter-row__meta";
  const code = document.createElement("code");
  code.className = "foss-earth-parameter-row__id";
  code.textContent = spec.id;
  explanation.append(description, meta);
  const note = control.element.querySelector<HTMLElement>(".foss-earth-parameter__note");
  if (note) explanation.append(note);
  explanation.append(code);
  const url = settings.sourceUrl(spec.id);
  const source = document.createElement(url ? "a" : "span");
  source.className = "foss-earth-parameter-row__source";
  source.textContent = spec.source;
  if (url) {
    const link = source as HTMLAnchorElement;
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = `The code that reads ${spec.id}. Opens in a new tab.`;
  }
  explanation.append(source);
  let header = control.element.querySelector<HTMLElement>(".foss-earth-parameter__header");
  const heading = control.element.querySelector<HTMLElement>(".foss-earth-choices__heading, .foss-earth-parameter__label");
  if (!header && heading) {
    header = document.createElement("div");
    header.className = "foss-earth-parameter__header";
    heading.before(header);
    header.append(heading);
  }
  if (heading) heading.after(help);
  else (header ?? control.element).append(help);
  control.element.append(explanation);
  const updateActions = (): void => {
    const state = settings.inspect(spec.id);
    const describe = (value: ParameterValue): string => spec.booleanControl === "auto-custom" ? (value === true ? "Custom" : "Auto") : formatValue(spec, value, state.choices);
    const value = spec.sensitive ? (state.value ? "set" : "not set") : describe(state.value);
    const defaultValue = spec.sensitive ? (state.defaultValue ? "set" : "none") : describe(state.defaultValue);
    meta.textContent = `Now ${value} (${describeProvenance(state)}). ${sentence(`Default ${defaultValue}: ${state.defaultDerivedFrom}`)}${spec.appliesLive ? "" : " Applies on the next start."}`;
  };
  note?.addEventListener("parameter-invalid", tooltip.open);
  updateActions();
  return {
    element: control.element,
    update() { control.update(); updateActions(); },
    destroy() {
      note?.removeEventListener("parameter-invalid", tooltip.open);
      tooltip.destroy();
      control.destroy();
    },
  };
}

function pill(document: Document, type: "radio" | "checkbox", name: string, value: string, label: string): { element: HTMLLabelElement; input: HTMLInputElement; text: HTMLSpanElement } {
  const element = document.createElement("label");
  element.className = "foss-earth-choice";
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  const text = document.createElement("span");
  text.textContent = label;
  element.append(input, text);
  return { element, input, text };
}

function createParameterMark(document: Document, mark: NonNullable<ParameterSpec["mark"]>): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "foss-earth-parameter__mark");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const add = (d: string, width = "1.8"): void => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", width);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  };
  if (mark === "polygon") {
    add("M12 3.5 20 9.1 17 20H7L4 9.1Z", "2");
  } else if (mark === "gear") {
    add("M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z");
    add("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z");
  } else {
    for (const d of [
      "M8 2.5 9.8 4.3",
      "M14.2 4.3 16 2.5",
      "M9 7.2V6a3 3 0 0 1 6 0v1.2",
      "M12 20.5c-3.3 0-6-2.6-6-5.8v-3.2A3.5 3.5 0 0 1 9.5 8h5A3.5 3.5 0 0 1 18 11.5v3.2c0 3.2-2.7 5.8-6 5.8Z",
      "M12 20.5V11",
      "M6.6 9.2C4.8 9 3.2 7.4 3.2 5.4",
      "M6 13.2H2.2",
      "M3.4 20.8c0-2 1.6-3.7 3.6-3.8",
      "M17.4 9.2c1.8-.2 3.4-1.8 3.4-3.8",
      "M18 13.2h3.8",
      "M17 17c2 .1 3.6 1.8 3.6 3.8",
    ]) add(d);
  }
  return svg;
}

function setParameterLabel(document: Document, element: HTMLElement, spec: ParameterSpec): void {
  const nodes: Node[] = [];
  if (spec.mark) nodes.push(createParameterMark(document, spec.mark));
  nodes.push(document.createTextNode(spec.label));
  element.replaceChildren(...nodes);
}

function createChoiceIcon(document: Document, icon: NonNullable<ParameterChoice["icon"]>): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "foss-earth-choice__icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (icon === "line" || icon === "circle") {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", icon === "line" ? "rect" : "circle");
    const attributes = icon === "line"
      ? { x: "11", y: "3", width: "2", height: "18", rx: "1", fill: "currentColor" }
      : { cx: "12", cy: "12", r: "7", fill: "none", stroke: "currentColor", "stroke-width": "2" };
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
    return svg;
  }
  if (icon === "bar-top" || icon === "bar-bottom") {
    const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    frame.setAttribute("x", "4");
    frame.setAttribute("y", "3.5");
    frame.setAttribute("width", "16");
    frame.setAttribute("height", "17");
    frame.setAttribute("rx", "2");
    frame.setAttribute("fill", "none");
    frame.setAttribute("stroke", "currentColor");
    frame.setAttribute("stroke-width", "1.8");
    const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bar.setAttribute("x", "7");
    bar.setAttribute("y", icon === "bar-top" ? "6" : "14.5");
    bar.setAttribute("width", "10");
    bar.setAttribute("height", "3");
    bar.setAttribute("rx", "0.6");
    bar.setAttribute("fill", "currentColor");
    svg.append(frame, bar);
    return svg;
  }
  const add = (d: string): void => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  };
  if (icon === "sun") {
    add("M12 17.2a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4Z");
    for (const d of ["M12 2.4v2.2", "M12 19.4v2.2", "M4.7 4.7l1.6 1.6", "M17.7 17.7l1.6 1.6", "M2.4 12h2.2", "M19.4 12h2.2", "M4.7 19.3l1.6-1.6", "M17.7 6.3l1.6-1.6"]) add(d);
  } else add("M21 14.5A8.5 8.5 0 1 1 9.5 3a6.5 6.5 0 0 0 11.5 11.5Z");
  return svg;
}

function choicePill(document: Document, name: string, choice: ParameterChoice): ReturnType<typeof pill> {
  const option = pill(document, "radio", name, choice.id, choice.icon ? "" : choice.shortLabel ?? choice.label);
  if (choice.icon) option.text.append(createChoiceIcon(document, choice.icon));
  if (choice.shortLabel !== undefined || choice.icon !== undefined) {
    option.input.setAttribute("aria-label", choice.label);
    option.element.title = choice.description ? `${choice.label}: ${choice.description}` : choice.label;
  } else if (choice.description) option.element.title = choice.description;
  return option;
}

function describeTitle(spec: ParameterSpec): string {
  return spec.description;
}

/** A switch: one pill with a checkbox, outlined while on. */
function createSwitch(document: Document, settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline";
  element.dataset.parameter = spec.id;
  const toggle = pill(document, "checkbox", `foss-earth-parameter-${++controlCount}`, "on", "");
  toggle.element.title = describeTitle(spec);
  toggle.input.setAttribute("aria-label", spec.label);
  toggle.input.id = `${toggle.input.name}-toggle`;
  const heading = document.createElement("label");
  heading.className = "foss-earth-parameter__label";
  heading.htmlFor = toggle.input.id;
  setParameterLabel(document, heading, spec);
  const header = document.createElement("div");
  header.className = "foss-earth-parameter__header";
  header.append(toggle.element, heading);
  const note = createNote(document);
  element.append(header, note);
  const start = settings.get(spec.id);
  const onChange = (): void => { settings.set(spec.id, toggle.input.checked); update(); };
  toggle.input.addEventListener("change", onChange);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    toggle.input.checked = state.value === true;
    toggle.input.disabled = Boolean(spec.readOnly) || state.provenance === "host";
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy: () => { toggle.input.removeEventListener("change", onChange); element.remove(); } };
}

/** Auto uses the defaults; Custom reveals the retained per-item priorities. */
function createAutoCustomSlider(document: Document, settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline";
  element.dataset.parameter = spec.id;
  const { header, readout } = createHeader(document, spec);
  const slider = createTwoPositionSlider({ document,
    label: spec.label,
    options: [{ label: "Auto" }, { label: "Custom" }],
    onInput: index => { settings.set(spec.id, index === 1); update(); },
  });
  readout.append(slider.element);
  const note = createNote(document);
  element.append(header, note);
  const start = settings.get(spec.id);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    slider.update(state.value === true ? 1 : 0, Boolean(spec.readOnly) || state.provenance === "host");
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy() { slider.destroy(); element.remove(); } };
}

/** The two ends of a switch. An Auto choice stays valid and is not drawn on the track. */
function switchEnds(choices: readonly ParameterChoice[]): { ends: readonly [ParameterChoice, ParameterChoice]; automatic: ParameterChoice | null } | null {
  const automatic = choices.find(choice => choice.id === "auto") ?? null;
  const ends = choices.filter(choice => choice.id !== "auto");
  const first = ends[0];
  const second = ends[1];
  if (!first || !second || ends.length !== 2) return null;
  return { ends: [first, second], automatic };
}

function createChoiceSlider(document: Document, settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const parsed = switchEnds(settings.inspect(spec.id).choices);
  if (!parsed) return createChoicePills(document, settings, spec);
  const { ends, automatic } = parsed;
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline";
  element.dataset.parameter = spec.id;
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", spec.label);
  const { header, readout } = createHeader(document, spec);
  const slider = createTwoPositionSlider({ document,
    label: spec.label,
    options: [
      { label: ends[0].label, icon: ends[0].shortLabel },
      { label: ends[1].label, icon: ends[1].shortLabel },
    ],
    onInput: index => { settings.set(spec.id, ends[index].id); update(); },
  });
  if (ends.some(choice => (choice.shortLabel ?? choice.label).length > 4)) slider.element.style.width = "156px";
  readout.append(slider.element);
  const note = createNote(document);
  element.append(header, note);
  const start = settings.get(spec.id);
  // Auto follows the presentation the shell is actually using.
  const shownEnd = (): 0 | 1 => element.ownerDocument.documentElement.dataset.worldPresentation === ends[1].id ? 1 : 0;
  const update = (): void => {
    const state = settings.inspect(spec.id);
    const following = automatic !== null && state.value === automatic.id;
    const index = state.value === ends[1].id ? 1 : state.value === ends[0].id ? 0 : shownEnd();
    slider.update(index, Boolean(spec.readOnly) || state.provenance === "host");
    if (following) slider.input.setAttribute("aria-valuetext", automatic.label);
    setNote(note, noteFor(state, start));
  };
  const presentation = new MutationObserver(update);
  presentation.observe(element.ownerDocument.documentElement, { attributes: true, attributeFilter: ["data-world-presentation"] });
  update();
  return { element, update, destroy() { presentation.disconnect(); slider.destroy(); element.remove(); } };
}

/** A heading and pills, one per choice. */
function createChoicePills(document: Document, settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const name = `foss-earth-parameter-${++controlCount}`;
  const element = document.createElement("div");
  element.className = "foss-earth-choices foss-earth-parameter foss-earth-parameter--group";
  element.dataset.parameter = spec.id;
  element.setAttribute("role", "radiogroup");
  element.setAttribute("aria-label", spec.label);
  const heading = document.createElement("div");
  heading.className = "foss-earth-choices__heading";
  setParameterLabel(document, heading, spec);
  heading.title = describeTitle(spec);
  const header = document.createElement("div");
  header.className = "foss-earth-parameter__header";
  header.append(heading);
  const pills = document.createElement("span");
  pills.className = "foss-earth-parameter__pills";
  const note = createNote(document);
  element.classList.add("foss-earth-parameter--compact-choice");
  header.prepend(pills);
  element.append(header, note);
  const start = settings.get(spec.id);
  let shownChoices: ParameterState["choices"] | null = null;
  const onChange = (event: Event): void => {
    const input = event.target as HTMLInputElement | null;
    if (input?.nodeName !== "INPUT" || input.name !== name) return;
    settings.set(spec.id, input.value);
    update();
  };
  element.addEventListener("change", onChange);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    if (state.choices !== shownChoices) {
      shownChoices = state.choices;
      pills.replaceChildren(...state.choices.map(choice => choicePill(document, name, choice).element));
    }
    for (const input of pills.querySelectorAll<HTMLInputElement>("input")) {
      input.checked = input.value === state.value;
      input.disabled = Boolean(spec.readOnly) || state.provenance === "host";
    }
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy: () => { element.removeEventListener("change", onChange); element.remove(); } };
}

/** Shrink a number box to the digits it is showing. */
function fitNumberField(field: HTMLInputElement): void {
  const chars = Math.max(1, field.value.length);
  field.size = chars;
  field.style.setProperty("--field-chars", String(chars));
}

/** The number a field shows: a fraction as a percentage. */
function fieldNumber(spec: ParameterSpec, value: number): string {
  return formatNumber(spec.unit === "fraction" ? value * 100 : value).replace(/,/g, "");
}

function fromField(spec: ParameterSpec, text: string): number | null {
  const value = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(value)) return null;
  return spec.unit === "fraction" ? value / 100 : value;
}

/** Field, label and help stay one phrase; the track follows and wraps when its length does not fit. */
function placeSlider(header: HTMLElement, readout: HTMLElement, reading: HTMLElement, label: HTMLElement, track: HTMLElement): void {
  const line = header.ownerDocument.createElement("span");
  line.className = "foss-earth-parameter__slider-line";
  line.append(readout, reading, label);
  header.append(line, track);
}

function createHeader(document: Document, spec: ParameterSpec): { header: HTMLElement; readout: HTMLElement; reading: HTMLElement } {
  const header = document.createElement("div");
  header.className = "foss-earth-parameter__header";
  const label = document.createElement("span");
  label.className = "foss-earth-parameter__label";
  setParameterLabel(document, label, spec);
  label.title = describeTitle(spec);
  const readout = document.createElement("span");
  readout.className = "foss-earth-parameter__readout";
  // What the budget bounds right now, beside it, in the same unit.
  const reading = document.createElement("span");
  reading.className = "foss-earth-parameter__reading";
  reading.hidden = true;
  header.append(readout, reading, label);
  return { header, readout, reading };
}

function showReading(settings: SettingsRegistry, id: string, element: HTMLElement): void {
  const text = settings.getReading(id);
  element.hidden = text === null;
  if (text !== null && element.textContent !== text) element.textContent = text;
}

/** A compact numeric field for discrete settings that do not need a track. */
function createNumberField(document: Document, settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--inline foss-earth-parameter--number-field";
  element.dataset.parameter = spec.id;
  const { header, readout, reading } = createHeader(document, spec);
  const field = document.createElement("input");
  field.type = "number";
  field.className = "foss-earth-parameter__field";
  field.setAttribute("aria-label", `${spec.label}${spec.unit === "fraction" ? " in percent" : ""}`);
  const step = spec.step ?? (spec.unit === "count" ? 1 : "any");
  field.step = typeof step === "number" && spec.unit === "fraction" ? String(step * 100) : String(step);
  const unit = document.createElement("span");
  unit.className = "foss-earth-parameter__unit";
  unit.textContent = spec.unit === "fraction" ? "%" : formatQuantity(spec.unit, 1).replace(/^1\s?/, "");
  readout.append(field, unit);
  const note = createNote(document);
  element.append(header, note);
  const start = settings.get(spec.id);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    const value = typeof state.value === "number" ? state.value : 0;
    field.disabled = Boolean(spec.readOnly) || state.provenance === "host";
    field.min = state.bounds ? fieldNumber(spec, state.bounds.min) : "";
    field.max = state.bounds ? fieldNumber(spec, state.bounds.max) : "";
    const digits = Math.max(3, field.min.length, field.max.length, fieldNumber(spec, value).length);
    field.style.width = `calc(${digits}ch + 24px)`;
    if (document.activeElement !== field) field.value = fieldNumber(spec, value);
    showReading(settings, spec.id, reading);
    setNote(note, noteFor(state, start));
  };
  const onChange = (): void => {
    const value = fromField(spec, field.value);
    if (value === null) { update(); return; }
    const result = settings.set(spec.id, value);
    if (!result.ok) setNote(note, result.reason, true);
    else update();
  };
  field.addEventListener("change", onChange);
  update();
  return { element, update, destroy() { field.removeEventListener("change", onChange); element.remove(); } };
}

/** A value track: one thumb, the default ticked, named values as pills beside it. */
function createValueTrack(document: Document, settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const name = `foss-earth-parameter-${++controlCount}`;
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--slider";
  element.dataset.parameter = spec.id;
  const { header, readout, reading } = createHeader(document, spec);
  const field = document.createElement("input");
  field.type = "number";
  field.className = "foss-earth-parameter__field";
  field.setAttribute("aria-label", `${spec.label}${spec.unit === "fraction" ? " in percent" : ""}`);
  const unit = document.createElement("span");
  unit.className = "foss-earth-parameter__unit";
  readout.append(field, unit);
  const start = settings.get(spec.id);
  const track: TrackHandle = createTrack({ document,
    ariaLabel: spec.label,
    ramp: spec.track?.ramp ?? "neutral",
    onInput: (_id, position) => {
      const state = settings.inspect(spec.id);
      const value = valueAtTrackPosition(spec, position, state.bounds);
      settings.set(spec.id, value);
      update();
    },
    onCommit: () => update(),
  });
  const named = document.createElement("div");
  named.className = "foss-earth-parameter__named";
  const namedPills = (spec.named ?? []).map(option => choicePill(document, name, option));
  const numberPill = spec.named?.length ? pill(document, "radio", name, "", "Value") : null;
  named.hidden = namedPills.length === 0;
  named.append(...namedPills.map(option => option.element), ...(numberPill ? [numberPill.element] : []));
  const note = createNote(document);
  placeSlider(header, readout, reading, header.querySelector(".foss-earth-parameter__label")!, track.element);
  element.append(header, named, note);

  const onNamed = (event: Event): void => {
    const input = event.target as HTMLInputElement | null;
    if (input?.nodeName !== "INPUT" || input.name !== name) return;
    if (input.value) settings.set(spec.id, input.value);
    else {
      // "Value": start from the number the named value stands for, or the default.
      const state = settings.inspect(spec.id);
      const fallback = typeof state.defaultValue === "number" ? state.defaultValue : state.bounds?.min ?? 0;
      settings.set(spec.id, fallback);
    }
    update();
  };
  named.addEventListener("change", onNamed);
  const onField = (): void => {
    const value = fromField(spec, field.value);
    if (value === null) { update(); return; }
    const result = settings.set(spec.id, value);
    if (!result.ok) setNote(note, result.reason, true);
    else update();
  };
  const onFieldInput = (): void => { fitNumberField(field); };
  field.addEventListener("change", onField);
  field.addEventListener("input", onFieldInput);

  const update = (): void => {
    const state = settings.inspect(spec.id);
    const bounds = state.bounds ?? { min: 0, max: 1 };
    const span = trackBounds(spec, bounds);
    const value = state.value;
    const isNamed = typeof value === "string";
    for (const option of namedPills) option.input.checked = option.input.value === value;
    if (numberPill) numberPill.input.checked = !isNamed;
    const locked = Boolean(spec.readOnly) || state.provenance === "host";
    for (const option of [...namedPills, ...(numberPill ? [numberPill] : [])]) option.input.disabled = locked;
    const number = typeof value === "number" ? value : null;
    const defaultNumber = typeof state.defaultValue === "number" ? state.defaultValue : null;
    track.render({
      min: span.min,
      max: span.max,
      step: trackStep(spec, bounds),
      tick: defaultNumber === null ? null : trackPosition(spec, defaultNumber),
      thumbs: number === null ? [] : [{
        id: "value",
        role: "value",
        position: trackPosition(spec, number),
        ariaLabel: spec.label,
        ariaValueText: formatValue(spec, number),
      }],
      disabled: locked,
    });
    track.element.hidden = isNamed && namedPills.length > 0;
    field.hidden = number === null;
    field.disabled = locked;
    if (document.activeElement !== field && number !== null) field.value = fieldNumber(spec, number);
    if (number !== null && document.activeElement !== field) fitNumberField(field);
    unit.textContent = number === null ? formatValue(spec, value, state.choices) : spec.unit === "fraction" ? "%" : formatQuantity(spec.unit, 1).replace(/^1\s?/, "");
    showReading(settings, spec.id, reading);
    setNote(note, noteFor(state, start));
  };
  update();
  return {
    element,
    update,
    destroy() {
      named.removeEventListener("change", onNamed);
      field.removeEventListener("change", onField);
      field.removeEventListener("input", onFieldInput);
      track.destroy();
      element.remove();
    },
  };
}

/** A range track: one track, a thumb for each end; a thumb stops at the other rather than passing it. */
function createRangeTrack(document: Document, settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--slider";
  element.dataset.parameter = spec.id;
  const { header, readout, reading } = createHeader(document, spec);
  const note = createNote(document);
  const start = settings.get(spec.id);
  // Left and right thumbs; on a reversed track the left one is the range's max.
  const left = spec.track?.reversed ? "max" : "min";
  const track = createTrack({ document,
    ariaLabel: spec.label,
    ramp: spec.track?.ramp ?? "neutral",
    onInput: (id, position) => {
      const state = settings.inspect(spec.id);
      const current = state.value as NumberRange;
      const leftPosition = trackPosition(spec, current[left]);
      const rightPosition = trackPosition(spec, current[left === "min" ? "max" : "min"]);
      const clamped = id === "left" ? Math.min(position, rightPosition) : Math.max(position, leftPosition);
      const value = valueAtTrackPosition(spec, clamped, state.bounds);
      const next = { ...current };
      const end = id === "left" ? left : left === "min" ? "max" : "min";
      next[end] = value;
      if (next.min > next.max) next[end] = end === "min" ? next.max : next.min;
      settings.set(spec.id, next);
      update();
    },
    onCommit: () => update(),
  });
  placeSlider(header, readout, reading, header.querySelector(".foss-earth-parameter__label")!, track.element);
  element.append(header, note);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    const value = isNumberRange(state.value) ? state.value : { min: 0, max: 0 };
    const bounds = state.bounds ?? value;
    const span = trackBounds(spec, bounds);
    const leftValue = value[left];
    const rightValue = value[left === "min" ? "max" : "min"];
    const locked = Boolean(spec.readOnly) || state.provenance === "host";
    track.render({
      min: span.min,
      max: span.max,
      step: trackStep(spec, bounds),
      range: { low: trackPosition(spec, leftValue), high: trackPosition(spec, rightValue) },
      thumbs: [
        { id: "left", role: "end", position: trackPosition(spec, leftValue), ariaLabel: `${spec.label}: ${left === "min" ? "lower" : "upper"} end`, ariaValueText: formatValue(spec, leftValue) },
        { id: "right", role: "end", position: trackPosition(spec, rightValue), ariaLabel: `${spec.label}: ${left === "min" ? "upper" : "lower"} end`, ariaValueText: formatValue(spec, rightValue) },
      ],
      disabled: locked,
    });
    readout.textContent = formatValue(spec, value);
    showReading(settings, spec.id, reading);
    setNote(note, noteFor(state, start));
  };
  update();
  return { element, update, destroy: () => { track.destroy(); element.remove(); } };
}

/** A text field. A secret is never shown: typing replaces it, Clear forgets it. */
function createTextField(document: Document, settings: SettingsRegistry, spec: ParameterSpec): ParameterControlHandle {
  const element = document.createElement("div");
  element.className = "foss-earth-parameter foss-earth-parameter--line foss-earth-parameter--text";
  element.dataset.parameter = spec.id;
  const { header, readout } = createHeader(document, spec);
  const input = document.createElement("input");
  input.type = spec.sensitive ? "password" : "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.className = "foss-earth-parameter__text";
  input.setAttribute("aria-label", spec.label);
  const actions = document.createElement("div");
  actions.className = "foss-earth-parameter__named";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "foss-earth-choice foss-earth-parameter__action";
  save.textContent = "Save";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "foss-earth-choice foss-earth-parameter__action";
  clear.textContent = "Clear";
  actions.append(save, clear);
  const note = createNote(document);
  element.append(header, input, actions, note);
  const start = settings.get(spec.id);
  const onSave = (): void => {
    const result = settings.set(spec.id, input.value.trim());
    if (!result.ok) { setNote(note, result.reason, true); return; }
    if (spec.sensitive) input.value = "";
    update();
  };
  const onClear = (): void => { settings.reset(spec.id); input.value = ""; update(); };
  const onKey = (event: KeyboardEvent): void => { if (event.key === "Enter") onSave(); };
  save.addEventListener("click", onSave);
  clear.addEventListener("click", onClear);
  input.addEventListener("keydown", onKey);
  const update = (): void => {
    const state = settings.inspect(spec.id);
    const value = typeof state.value === "string" ? state.value : "";
    readout.textContent = spec.sensitive ? (value ? "Set" : "Not set") : "";
    input.placeholder = spec.sensitive ? (value ? "Enter a new key to replace it" : "Paste the key") : "";
    if (!spec.sensitive && document.activeElement !== input) input.value = value;
    const locked = Boolean(spec.readOnly) || state.provenance === "host";
    input.disabled = locked;
    save.disabled = locked;
    clear.disabled = locked || state.layers.saved === undefined && state.layers.url === undefined;
    setNote(note, noteFor(state, start));
  };
  update();
  return {
    element,
    update,
    destroy() {
      save.removeEventListener("click", onSave);
      clear.removeEventListener("click", onClear);
      input.removeEventListener("keydown", onKey);
      element.remove();
    },
  };
}

/**
 * The control a parameter's spec calls for: a switch, choice pills, a value
 * track, a range track or a text field. Read-only parameters show their value
 * and the reason they cannot change.
 */
export function createParameterControl(settings: SettingsRegistry, id: string, document: Document): ParameterControlHandle {
  const spec = settings.spec(id);
  if (!spec) throw new Error(`No parameter "${id}" is registered.`);
  let control: ParameterControlHandle;
  switch (spec.kind) {
    case "boolean": control = spec.booleanControl === "auto-custom" ? createAutoCustomSlider(document, settings, spec) : createSwitch(document, settings, spec); break;
    case "choice": control = spec.choiceControl === "two-position" ? createChoiceSlider(document, settings, spec) : createChoicePills(document, settings, spec); break;
    case "number": control = spec.numberControl === "field" && !spec.named?.length ? createNumberField(document, settings, spec) : createValueTrack(document, settings, spec); break;
    case "range": control = createRangeTrack(document, settings, spec); break;
    case "text": control = createTextField(document, settings, spec); break;
  }
  const decorated = withParameterActions(document, settings, spec, control);
  const inline = new Map<string, { control: ParameterControlHandle; detail: HTMLElement; meta: HTMLElement }>();
  const pairedSpecs = (): ParameterSpec[] => settings.list({ tab: spec.home.tab, section: spec.home.section }).filter(candidate => candidate.inlineWith === id);
  const update = (): void => {
    decorated.update();
    const shown = pairedSpecs().filter(candidate => isParameterControlVisible(settings, candidate));
    for (const [childId, child] of inline) {
      if (!shown.some(candidate => candidate.id === childId)) {
        child.control.destroy();
        child.detail.remove();
        inline.delete(childId);
      }
    }
    const header = decorated.element.querySelector<HTMLElement>(".foss-earth-parameter__header")!;
    const help = decorated.element.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
    const explanation = document.getElementById(help.getAttribute("aria-controls")!) ?? decorated.element.querySelector<HTMLElement>(".foss-earth-parameter__help");
    for (const candidate of [...shown].reverse()) {
      let child = inline.get(candidate.id);
      if (!child) {
        const fieldControl = createNumberField(document, settings, candidate);
        const field = fieldControl.element.querySelector<HTMLInputElement>('input[type="number"]')!;
        const note = fieldControl.element.querySelector<HTMLElement>(".foss-earth-parameter__note")!;
        fieldControl.element.className = "foss-earth-parameter__inline-field";
        fieldControl.element.replaceChildren(field);
        const detail = document.createElement("div");
        const description = document.createElement("p");
        description.textContent = candidate.description;
        const meta = document.createElement("p");
        meta.className = "foss-earth-parameter-row__meta";
        detail.append(description, meta, note);
        explanation?.append(detail);
        // Invalid priority edits use this row's existing explanation button.
        note.addEventListener("parameter-invalid", () => {
          const help = decorated.element.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
          if (help.getAttribute("aria-expanded") !== "true") help.click();
        });
        child = { control: fieldControl, detail, meta };
        inline.set(candidate.id, child);
      }
      child.control.update();
      const state = settings.inspect(candidate.id);
      child.meta.textContent = `${candidate.label}: ${formatValue(candidate, state.value)} (${describeProvenance(state)}). Default ${formatValue(candidate, state.defaultValue)}: ${state.defaultDerivedFrom}`;
      header.prepend(child.control.element);
    }
  };
  update();
  const stopWatching = settings.subscribe(changed => {
    if (pairedSpecs().some(candidate => changed.has(candidate.id) || (candidate.visibleWhen && changed.has(candidate.visibleWhen.id)))) update();
  });
  return {
    element: decorated.element,
    update,
    destroy() {
      stopWatching();
      for (const child of inline.values()) { child.control.destroy(); child.detail.remove(); }
      inline.clear();
      decorated.destroy();
    },
  };
}
