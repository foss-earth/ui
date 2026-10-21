import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SettingsRegistry } from "../settings/registry.js";
import { checkChoice, createChoiceGroup, type Choice } from "./choiceGroup.js";
import { createHelpTooltip } from "./helpTooltip.js";
import { createActionIcon, type ActionIcon } from "./iconButton.js";
import { createResetBadge, createResetButton, isParameterResettable, parameterResetLabel, type ResetBadgeHandle } from "./settings/resetBadge.js";

/**
 * React hosts draw the shared controls through these: each mounts the same
 * factory the DOM panels use, so a React panel never keeps its own copy of a
 * track, an icon action or a ?.
 */

let trackCount = 0;

/** The registry that hand-drawn parameters reset against: a React panel that draws its own controls for registry parameters provides it once, around them. */
export const ParameterSettings = createContext<SettingsRegistry | null>(null);

export interface ChoiceTrackChoice extends Choice {
  /** Why this choice cannot be picked now. It stays visible, disabled, with the reason as its title. */
  unavailable?: string | null;
}

export interface ChoiceTrackProps {
  /** The visible title and the radiogroup's accessible name. */
  heading: string;
  choices: readonly ChoiceTrackChoice[];
  value: string;
  onChange(id: string): void;
  /** Explanation behind a trailing ?, the last item in the group. */
  help?: ReactNode;
  /** The ? button's accessible name. Defaults to "Explain <heading>". */
  helpLabel?: string;
  /** Leave the visible title out when the section heading already names the choice. */
  hideHeading?: boolean;
  disabled?: boolean;
  /** The registry parameter it edits, in the registry ParameterSettings provides: a reset on its segments returns it to the default. */
  parameter?: string;
  /** For a value kept outside the registry, its default: a reset on its segments shows while the value differs. */
  defaultValue?: string;
}

/** `Heading [A / B / C] ?`: the shared segmented track, controlled by `value`. */
export function ChoiceTrack({ heading, choices, value, onChange, help, helpLabel, hideHeading, disabled, parameter, defaultValue }: ChoiceTrackProps) {
  const settings = useContext(ParameterSettings);
  const host = useRef<HTMLSpanElement>(null);
  const group = useRef<HTMLElement | null>(null);
  const reset = useRef<ResetBadgeHandle | null>(null);
  const latest = useRef({ choices, defaultValue, disabled });
  latest.current = { choices, defaultValue, disabled };
  const hasDefault = defaultValue !== undefined;
  const [name] = useState(() => `foss-earth-choice-track-${++trackCount}`);
  const [helpContent] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  const change = useRef(onChange);
  change.current = onChange;
  const current = useRef(value);
  current.current = value;
  const hasHelp = help !== undefined && help !== null && help !== false;
  // Rebuilt only when the options themselves change; the value and availability follow below.
  const shape = JSON.stringify([heading, hideHeading ?? false, hasHelp, helpLabel ?? "", choices.map(choice => [choice.id, choice.label, choice.shortLabel ?? ""])]);
  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const element = createChoiceGroup(name, heading, choices, parent.ownerDocument, { hideHeading });
    const tooltip = hasHelp && helpContent ? createHelpTooltip({ label: helpLabel ?? `Explain ${heading}`, content: helpContent }) : null;
    if (tooltip) element.append(tooltip.element);
    const badge = trackReset(element, heading, settings, parameter, hasDefault, latest, current, change);
    reset.current = badge;
    const onInput = (event: Event): void => {
      const input = event.target as HTMLInputElement | null;
      if (input?.name !== name || !input.checked) return;
      change.current(input.value);
      // A host that refuses the choice does not render again; the track shows its value still.
      checkChoice(element, name, current.current);
    };
    element.addEventListener("change", onInput);
    parent.replaceChildren(element);
    group.current = element;
    return () => {
      element.removeEventListener("change", onInput);
      tooltip?.destroy();
      badge?.destroy();
      reset.current = null;
      element.remove();
      group.current = null;
    };
    // `shape` stands for heading, choices, hideHeading and the help's presence.
  }, [shape, name, helpContent, settings, parameter, hasDefault]);
  useLayoutEffect(() => {
    const element = group.current;
    if (!element) return;
    checkChoice(element, name, value);
    for (const input of element.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)) {
      const reason = choices.find(choice => choice.id === input.value)?.unavailable ?? null;
      input.disabled = Boolean(disabled) || reason !== null;
      const label = input.closest("label");
      if (label) {
        if (reason) label.title = reason; else label.removeAttribute("title");
      }
    }
    reset.current?.update();
  });
  return <span ref={host} className="foss-earth-react-host">{hasHelp && helpContent ? createPortal(help, helpContent) : null}</span>;
}

/** A track's reset, on its segments: from the registry for a parameter, or from its default for a value kept elsewhere. */
function trackReset(
  element: HTMLElement,
  heading: string,
  settings: SettingsRegistry | null,
  parameter: string | undefined,
  hasDefault: boolean,
  latest: { current: { choices: readonly ChoiceTrackChoice[]; defaultValue?: string; disabled?: boolean } },
  current: { current: string },
  change: { current: (id: string) => void },
): ResetBadgeHandle | null {
  const segments = element.querySelector<HTMLElement>(".foss-earth-parameter__pills");
  if (!segments) return null;
  const document = element.ownerDocument;
  let badge: ResetBadgeHandle | null = null;
  if (parameter !== undefined && settings?.spec(parameter)) {
    badge = createResetBadge(settings, document, {
      ids: () => [parameter],
      label: () => parameterResetLabel(settings, parameter, { name: heading }),
      shown: () => !latest.current.disabled && isParameterResettable(settings, parameter),
    });
  } else if (parameter === undefined && hasDefault) {
    badge = createResetButton(document, {
      label: () => {
        const fallback = latest.current.defaultValue ?? "";
        return `Reset ${heading} to the default: ${latest.current.choices.find(choice => choice.id === fallback)?.label ?? fallback}`;
      },
      shown: () => !latest.current.disabled && latest.current.defaultValue !== undefined && current.current !== latest.current.defaultValue,
      reset: () => { if (latest.current.defaultValue !== undefined) change.current(latest.current.defaultValue); },
    });
  }
  if (!badge) return null;
  segments.classList.add("foss-earth-parameter__reset-anchor");
  segments.append(badge.element);
  return badge;
}

export type ResettableProps = {
  children: ReactNode;
  /** Classes for the span around the widget, to size it as the widget was sized. */
  className?: string;
} & (
  | {
    /** The registry parameter the widget edits, in the registry ParameterSettings provides. */
    parameter: string;
    /** The widget's own name for it, where its label is not the parameter's. */
    name?: string;
  }
  | {
    /** For a value kept outside the registry: whether it differs from its default. */
    changed: boolean;
    /** The reset's accessible name and title, such as "Reset Wind speed to the default: 0 kt". */
    label: string;
    onReset(): void;
  }
);

/**
 * A hand-drawn widget with a tiny circular reset on its top-right corner,
 * shown while its value differs from the default: `<Resettable parameter="…">
 * <input type="range" …/></Resettable>`. The span around the widget is the
 * reset's anchor.
 */
export function Resettable(props: ResettableProps) {
  const settings = useContext(ParameterSettings);
  const host = useRef<HTMLSpanElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const badge = useRef<ResetBadgeHandle | null>(null);
  const parameter = "parameter" in props ? props.parameter : null;
  useLayoutEffect(() => {
    const anchor = host.current;
    if (!anchor) return;
    const document = anchor.ownerDocument;
    let handle: ResetBadgeHandle | null = null;
    if (parameter !== null) {
      if (settings?.spec(parameter)) {
        handle = createResetBadge(settings, document, {
          ids: () => [parameter],
          label: () => {
            const now = latest.current;
            return parameterResetLabel(settings, parameter, "name" in now && now.name ? { name: now.name } : {});
          },
        });
      }
    } else {
      handle = createResetButton(document, {
        label: () => { const now = latest.current; return "label" in now ? now.label : ""; },
        shown: () => { const now = latest.current; return "changed" in now && now.changed; },
        reset: () => { const now = latest.current; if ("onReset" in now) now.onReset(); },
      });
    }
    if (!handle) return;
    anchor.append(handle.element);
    badge.current = handle;
    return () => { handle.destroy(); badge.current = null; };
  }, [settings, parameter]);
  // A value kept outside the registry is read again after every render.
  useLayoutEffect(() => { badge.current?.update(); });
  return <span ref={host} className={`foss-earth-parameter__widget foss-earth-parameter__reset-anchor${props.className ? ` ${props.className}` : ""}`}>{props.children}</span>;
}

export interface IconButtonProps {
  icon: ActionIcon;
  /** The complete accessible name, also the hover title. */
  label: string;
  onClick(): void;
  disabled?: boolean;
  className?: string;
}

/** A familiar action as its icon, with the full name for assistive technology and hover. */
export function IconButton({ icon, label, onClick, disabled, className }: IconButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = button.current;
    if (!element) return;
    const mark = createActionIcon(element.ownerDocument, icon);
    element.append(mark);
    return () => mark.remove();
  }, [icon]);
  return <button ref={button} type="button" data-icon={icon} aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className={`foss-earth-choice foss-earth-parameter__action foss-earth-parameter__icon-action${className ? ` ${className}` : ""}`} />;
}

/** A trailing ? whose explanation is React content. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const host = useRef<HTMLSpanElement>(null);
  const [content] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent || !content) return;
    const tooltip = createHelpTooltip({ label, content });
    parent.append(tooltip.element);
    return () => tooltip.destroy();
  }, [label, content]);
  return <span ref={host} className="foss-earth-react-host">{content ? createPortal(children, content) : null}</span>;
}
