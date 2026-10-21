import type { SettingsRegistry } from "../../settings/registry.js";
import { sameValue } from "../../settings/values.js";
import { createActionIcon, setIconButtonLabel } from "../iconButton.js";

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

/** A tiny circular reset on a widget's top-right corner, shown while its value differs from the default. It follows the registry itself, so a hand-built panel only appends it to the widget. */
export function createResetBadge(settings: SettingsRegistry, document: Document, options: ResetBadgeOptions): ResetBadgeHandle {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "foss-earth-parameter__reset";
  button.hidden = true;
  button.append(createActionIcon(document, "reset"));
  let label = "";
  const shown = options.shown ?? ((): boolean => options.ids().some(id => isParameterResettable(settings, id)));
  const update = (): void => {
    const show = shown();
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
    if (options.reset) options.reset();
    else for (const id of options.ids()) if (isParameterResettable(settings, id)) settings.reset(id);
    update();
  };
  button.addEventListener("mousedown", onPress);
  button.addEventListener("click", onClick);
  const stopWatching = settings.subscribe(changed => {
    if (changed.size === 0 || options.ids().some(id => changed.has(id))) update();
  });
  update();
  return {
    element: button,
    update,
    destroy() {
      stopWatching();
      button.removeEventListener("mousedown", onPress);
      button.removeEventListener("click", onClick);
      button.remove();
    },
  };
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
