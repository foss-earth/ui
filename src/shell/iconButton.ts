const SVG_NS = "http://www.w3.org/2000/svg";

/** Familiar action marks, drawn in the text colour on a 24 px grid. */
const ICON_PATHS = {
  copy: ["M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M4 20h16"],
  upload: ["M12 15V3", "m7 8 5-5 5 5", "M4 20h16"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13", "M10 11v6", "M14 11v6"],
  reset: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"],
  refresh: ["M21 12a9 9 0 1 1-3-6.7", "M21 4v5h-5"],
  undo: ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"],
  redo: ["m15 14 5-5-5-5", "M20 9H10a6 6 0 0 0 0 12h3"],
  pencil: ["M4 20h4L19 9l-4-4L4 16v4Z", "m13.5 6.5 4 4"],
  external: ["M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5", "M14 4h6v6", "M20 4 10 14"],
  play: ["M7 4.5v15l12-7.5-12-7.5Z"],
  pause: ["M8 5v14", "M16 5v14"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  check: ["m5 12 5 5 9-10"],
  crosshair: ["M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4", "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"],
  target: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M12 12h.01"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  gear: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ],
  "collapse-all": ["m7 20 5-5 5 5", "m7 4 5 5 5-5"],
  "expand-all": ["m7 15 5 5 5-5", "m7 9 5-5 5 5"],
} as const satisfies Record<string, readonly string[]>;

export type ActionIcon = keyof typeof ICON_PATHS;

export const ACTION_ICONS = Object.keys(ICON_PATHS) as ActionIcon[];

/** One familiar action mark, hidden from assistive technology: its button carries the name. */
export function createActionIcon(document: Document, icon: ActionIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "foss-earth-action-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ICON_PATHS[icon]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export interface IconButtonOptions {
  icon: ActionIcon;
  /** The complete accessible name, also the hover title. */
  label: string;
  /** "a" makes a link, for a download or another page; the caller sets its href. */
  tag?: "button" | "a";
}

/**
 * A compact icon action with its full accessible name and hover title, for
 * familiar actions (copy, download, reset, delete, …). Actions whose icon would
 * be ambiguous keep visible words instead.
 */
export function createIconButton(document: Document, options: IconButtonOptions & { tag: "a" }): HTMLAnchorElement;
export function createIconButton(document: Document, options: IconButtonOptions): HTMLButtonElement;
export function createIconButton(document: Document, options: IconButtonOptions): HTMLButtonElement | HTMLAnchorElement {
  const element = document.createElement(options.tag ?? "button");
  if (options.tag !== "a") (element as HTMLButtonElement).type = "button";
  element.className = "foss-earth-choice foss-earth-parameter__action foss-earth-parameter__icon-action";
  element.dataset.icon = options.icon;
  setIconButtonLabel(element, options.label);
  element.append(createActionIcon(document, options.icon));
  return element;
}

/** Renames an icon action, as when it changes to a confirmation. */
export function setIconButtonLabel(element: HTMLElement, label: string): void {
  element.setAttribute("aria-label", label);
  element.title = label;
}
