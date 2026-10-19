import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { checkChoice, createChoiceGroup, type Choice } from "./choiceGroup.js";
import { createHelpTooltip } from "./helpTooltip.js";
import { createActionIcon, type ActionIcon } from "./iconButton.js";

/**
 * React hosts draw the shared controls through these: each mounts the same
 * factory the DOM panels use, so a React panel never keeps its own copy of a
 * track, an icon action or a ?.
 */

let trackCount = 0;

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
}

/** `Heading [A / B / C] ?`: the shared segmented track, controlled by `value`. */
export function ChoiceTrack({ heading, choices, value, onChange, help, helpLabel, hideHeading, disabled }: ChoiceTrackProps) {
  const host = useRef<HTMLSpanElement>(null);
  const group = useRef<HTMLElement | null>(null);
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
      element.remove();
      group.current = null;
    };
    // `shape` stands for heading, choices, hideHeading and the help's presence.
  }, [shape, name, helpContent]);
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
  });
  return <span ref={host} className="foss-earth-react-host">{hasHelp && helpContent ? createPortal(help, helpContent) : null}</span>;
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
