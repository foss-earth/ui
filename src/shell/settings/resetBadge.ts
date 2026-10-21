import type { SettingsRegistry } from "../../settings/registry.js";
import type { ParameterSpec, ParameterState, ParameterValue } from "../../settings/types.js";
import { formatValue, isNumberRange, sameValue } from "../../settings/values.js";
import { createActionIcon, setIconButtonLabel } from "../iconButton.js";

export interface ResetButtonOptions {
  /** Its accessible name and hover title, such as "Reset Wind speed to the default: 0 kt". */
  label(): string;
  /** Whether it shows: while the value its widget shows differs from the default. */
  shown(): boolean;
  /** Returns the value to its default. */
  reset(): void;
}

export interface ResetBadgeOptions {
  /** The parameters it follows and returns to their defaults, read on every update so a group's members can come and go. */
  ids(): readonly string[];
  /** Its accessible name and hover title, such as "Reset Frame rate cap to the default: 60 fps". */
  label(): string;
  /** Whether it shows; by default, while any of its parameters differs from its default. A widget showing part of a value, such as a range's lower end, shows it while that part differs. */
  shown?(): boolean;
  /** What a click does; by default, each of its parameters that differs returns to its default. */
  reset?(): void;
}

export interface ResetBadgeHandle {
  /** Append it to the widget it resets, which must be positioned: it sits on that widget's top-right corner. */
  element: HTMLButtonElement;
  update(): void;
  destroy(): void;
}

/** True when a parameter's value differs from its default and the person may change it. */
export function isParameterResettable(settings: SettingsRegistry, id: string): boolean {
  const spec = settings.spec(id);
  if (!spec || spec.readOnly) return false;
  const state = settings.inspect(id);
  return state.provenance !== "host" && !sameValue(state.value, state.defaultValue);
}

/** A value in the words its control shows: an Auto/Custom switch says Auto or Custom, not off or on. */
export function describeParameterValue(spec: ParameterSpec, value: ParameterValue, choices: ParameterState["choices"]): string {
  return spec.booleanControl === "auto-custom" ? (value === true ? "Custom" : "Auto") : formatValue(spec, value, choices);
}

/** "Reset Sound tier to the default: Auto", or for a range's end, "Reset the lower end of Depth to the default: 20 m". `name` replaces the parameter's label where the widget shows another. */
export function parameterResetLabel(settings: SettingsRegistry, id: string, options: { end?: "min" | "max"; name?: string } = {}): string {
  const spec = settings.spec(id);
  if (!spec) return "Reset to the default";
  const name = options.name ?? spec.label;
  const state = settings.inspect(id);
  if (options.end && isNumberRange(state.defaultValue)) return `Reset the ${options.end === "min" ? "lower" : "upper"} end of ${name} to the default: ${formatValue(spec, state.defaultValue[options.end])}`;
  if (spec.sensitive) return `Reset ${name} to the default`;
  return `Reset ${name} to the default: ${describeParameterValue(spec, state.defaultValue, state.choices)}`;
}

/** A tiny circular reset on a widget's top-right corner, for a value kept outside the settings registry: the host says when it shows and what it does, and calls update() when its value changes. */
export function createResetButton(document: Document, options: ResetButtonOptions): ResetBadgeHandle {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "foss-earth-parameter__reset";
  button.hidden = true;
  button.append(createActionIcon(document, "reset"));
  let label = "";
  const update = (): void => {
    const show = options.shown();
    // After the control has drawn the value, so the radio checked by then takes focus.
    if (!show && !button.hidden && document.activeElement === button) queueMicrotask(() => focusBefore(button));
    button.hidden = !show;
    if (!show) return;
    const next = options.label();
    if (next !== label) { label = next; setIconButtonLabel(button, label); }
  };
  // A press keeps focus where it was, so it neither pins a track open nor leaves a ring behind; the keyboard still reaches it.
  const onPress = (event: MouseEvent): void => { event.preventDefault(); };
  const onClick = (): void => {
    options.reset();
    update();
  };
  button.addEventListener("mousedown", onPress);
  button.addEventListener("click", onClick);
  update();
  return {
    element: button,
    update,
    destroy() {
      button.removeEventListener("mousedown", onPress);
      button.removeEventListener("click", onClick);
      button.remove();
    },
  };
}

/** A tiny circular reset on a widget's top-right corner, shown while its value differs from the default. It follows the registry itself, so a hand-built panel only appends it to the widget. */
export function createResetBadge(settings: SettingsRegistry, document: Document, options: ResetBadgeOptions): ResetBadgeHandle {
  const badge = createResetButton(document, {
    label: options.label,
    shown: options.shown ?? ((): boolean => options.ids().some(id => isParameterResettable(settings, id))),
    reset: options.reset ?? ((): void => { for (const id of options.ids()) if (isParameterResettable(settings, id)) settings.reset(id); }),
  });
  const stopWatching = settings.subscribe(changed => {
    if (changed.size === 0 || options.ids().some(id => changed.has(id))) badge.update();
  });
  return {
    element: badge.element,
    update: badge.update,
    destroy() {
      stopWatching();
      badge.destroy();
    },
  };
}

/**
 * Makes a widget a reset's anchor and returns the element to append the
 * reset to: the widget itself, or, for a label, field or select, which cannot
 * hold a button, a span put in its place around it.
 */
export function resetAnchor(document: Document, widget: HTMLElement): HTMLElement {
  let anchor = widget;
  if (widget.tagName === "LABEL" || widget.tagName === "INPUT" || widget.tagName === "SELECT" || widget.tagName === "TEXTAREA") {
    anchor = document.createElement("span");
    anchor.className = "foss-earth-parameter__widget";
    widget.replaceWith(anchor);
    anchor.append(widget);
  }
  anchor.classList.add("foss-earth-parameter__reset-anchor");
  return anchor;
}

/** For a hand-built widget that edits one parameter: a reset on its top-right corner, following the registry. `name` replaces the parameter's label in the reset's name where the widget shows another. */
export function attachParameterReset(settings: SettingsRegistry, document: Document, widget: HTMLElement, id: string, options: { name?: string } = {}): ResetBadgeHandle {
  const anchor = resetAnchor(document, widget);
  const badge = createResetBadge(settings, document, { ids: () => [id], label: () => parameterResetLabel(settings, id, options) });
  anchor.append(badge.element);
  return badge;
}

const FOCUSABLE = "input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/** Hiding the focused badge hands focus to its widget, the stop before it, as Shift+Tab would; in a radio group, to the checked radio. */
function focusBefore(button: HTMLButtonElement): void {
  const widget = button.parentElement;
  if (!widget) return;
  const before = [...widget.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter(element => element !== button && !element.closest("[hidden]") && Boolean(element.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING));
  const target = before.at(-1);
  const radio = (element: HTMLElement | undefined): element is HTMLInputElement => element?.tagName === "INPUT" && (element as HTMLInputElement).type === "radio";
  const checked = radio(target) ? before.find(element => radio(element) && element.name === target.name && element.checked) : undefined;
  (checked ?? target)?.focus({ preventScroll: true });
}
