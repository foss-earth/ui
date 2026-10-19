import { createExternalLinkIcon } from "./externalLinkIcon.js";
import { createHelpTooltip } from "./helpTooltip.js";

export interface Choice {
  id: string;
  label: string;
  /** Compact visible text; label remains the accessible name. */
  shortLabel?: string;
  /** A page crediting this choice, opened by the external-link icon at the end of its pill while it is checked. */
  creditUrl?: string;
}

export interface ChoiceGroupOptions {
  /** Explanation behind a trailing ?, the last item in the group: text, or an element with links. */
  help?: string | HTMLElement;
  /** The ? button's accessible name. Defaults to "Explain <heading>". */
  helpLabel?: string;
  /** Terse visible state after the segments and before ?, such as "WebGL2 running". */
  status?: HTMLElement;
  /** Leave the visible title out when the section heading already names the choice; it stays the accessible name. */
  hideHeading?: boolean;
}

/**
 * A compact segmented choice: one rounded track, text segments, native radio semantics. Every radio
 * takes `name`, so two groups with the same name make one choice. The title comes first, then the
 * segments, any status, and help last.
 */
export function createChoiceGroup(name: string, heading: string, choices: readonly Choice[], document: Document, options: ChoiceGroupOptions = {}): HTMLElement {
  const group = document.createElement("div");
  group.className = "foss-earth-choices foss-earth-choice-group foss-earth-parameter--compact-choice";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", heading);
  if (!options.hideHeading) {
    const title = document.createElement("div");
    title.className = "foss-earth-choices__heading";
    title.textContent = heading;
    group.append(title);
  }
  const segments = document.createElement("span");
  segments.className = "foss-earth-parameter__pills";
  group.append(segments);
  for (const choice of choices) {
    const label = document.createElement("label");
    label.className = "foss-earth-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = choice.id;
    const text = document.createElement("span");
    text.textContent = choice.shortLabel ?? choice.label;
    if (choice.shortLabel) input.setAttribute("aria-label", choice.label);
    label.append(input, text);
    // A link inside a label opens without checking the radio.
    if (choice.creditUrl) {
      const credit = document.createElement("a");
      credit.className = "foss-earth-choice__credit";
      credit.href = choice.creditUrl;
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      credit.title = `${choice.label}. Opens its attribution page.`;
      credit.setAttribute("aria-label", `${choice.label} attribution, opens in a new tab`);
      credit.hidden = true;
      credit.append(createExternalLinkIcon(document));
      label.append(credit);
    }
    segments.append(label);
  }
  if (options.status) {
    options.status.classList.add("foss-earth-choice-group__status");
    group.append(options.status);
  }
  if (options.help !== undefined) {
    const content = document.createElement("div");
    if (typeof options.help === "string") {
      const text = document.createElement("p");
      text.textContent = options.help;
      content.append(text);
    } else content.append(options.help);
    group.append(createHelpTooltip({ label: options.helpLabel ?? `Explain ${heading}`, content }).element);
  }
  return group;
}

export function createChoiceNote(text: string, document: Document): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "foss-earth-choices__note";
  note.textContent = text;
  return note;
}

/**
 * Checks the radio for `id`, or clears the choice when `id` matches none. Only
 * the checked pill shows its credit link.
 */
export function checkChoice(root: ParentNode, name: string, id: string | null): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)) {
    input.checked = input.value === id;
    const credit = input.parentElement?.querySelector<HTMLElement>(".foss-earth-choice__credit");
    if (credit) credit.hidden = !input.checked;
  }
}
