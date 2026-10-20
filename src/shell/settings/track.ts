/**
 * One track for every continuous control: a value track (one thumb), a range
 * track (two thumbs, the outside dimmed), and the detail track (two ends, a
 * default and host markers). Thumbs are native range inputs stacked on one
 * track, so each keeps keyboard steps and an accessible value; only their
 * thumbs take the pointer. Positions are in the track's own space (a value, or
 * its log2), increasing to the right.
 *
 * A thumb with a face is a value handle: its value is written on it, in a
 * width that never changes, and it is the value's field. A press and release
 * without moving, Enter, or typing a digit while it has focus opens an editor
 * over it; a press that moves is a drag.
 */

import type { NumberFace } from "../../settings/values.js";

export type TrackRamp = "detail" | "neutral";

export interface TrackThumb {
  id: string;
  /** "end": a range's end. "value": a value track's thumb. "default": a saved default. "marker": a host's value. */
  role: "end" | "value" | "default" | "marker";
  position: number;
  ariaLabel: string;
  ariaValueText: string;
  /** A marker's colour; other roles take the ramp's colour at their position. */
  colour?: string;
  hollow?: boolean;
  /** Not draggable: drawn as a tick instead of a thumb. */
  fixed?: boolean;
  disabled?: boolean;
  /** Kept in place but not shown, such as a default marked only by the tick. */
  hidden?: boolean;
  /** Shown beside a marker. */
  label?: string;
  /** A value handle's text, padded to the track's face width. */
  face?: NumberFace;
}

export interface TrackFrame {
  min: number;
  max: number;
  step: number;
  thumbs: readonly TrackThumb[];
  /** The selected part of the scale; the rest is dimmed. */
  range?: { low: number; high: number } | null;
  /** A tick for the default. */
  tick?: number | null;
  /** Striped: allowed by the range but refused by a host's requirement. */
  stripe?: { low: number; high: number } | null;
  /** The value in use where it differs from the one set: an I-beam, as on the map's detail rail. */
  inUse?: { position: number; label: string } | null;
  /** Characters on each value handle; thumbs with a face are then handles this wide. */
  faceChars?: number;
  disabled?: boolean;
}

export interface TrackHandle {
  element: HTMLElement;
  render(frame: TrackFrame): void;
  /** True while the pointer holds a thumb: callers keep their values out of its way. */
  isDragging(): boolean;
  /** Opens a value handle's editor, starting from `text` or the handle's own value. */
  edit(id: string, text?: string): void;
  isEditing(): boolean;
  destroy(): void;
}

export interface TrackOptions {
  document: Document;
  ariaLabel: string;
  /** Extra classes for the track element. */
  className?: string;
  ramp: TrackRamp;
  /** A thumb moved; the caller constrains the position and renders again. */
  onInput(id: string, position: number): void;
  /** A drag ended. */
  onCommit?(id: string): void;
  /** A unit written under the value on each handle, as the toolbar's FPS chip does. */
  faceUnit?: string;
  /** A value typed on a handle; the caller sets it and renders again. */
  onEdit?(id: string, text: string): void;
}

/** How far a press may travel and still be a click on the handle, not a drag. */
const CLICK_SLOP_PX = 4;

/** The text an editor starts from: the sign only when negative, no padding. */
function editText(face: NumberFace): string {
  return `${face.sign === "−" ? "−" : ""}${face.digits}`;
}

function setFace(element: HTMLElement, face: NumberFace, unit: string): void {
  const [sign, pad, digits] = Array.from(element.querySelectorAll<HTMLElement>(".foss-earth-track__face-sign, .foss-earth-track__face-pad, .foss-earth-track__face-digits"));
  if (sign.textContent !== face.sign) sign.textContent = face.sign;
  if (pad.textContent !== face.pad) pad.textContent = face.pad;
  if (digits.textContent !== face.digits) digits.textContent = face.digits;
  const unitElement = element.querySelector<HTMLElement>(".foss-earth-track__face-unit");
  if (unitElement && unitElement.textContent !== unit) unitElement.textContent = unit;
}

// The HUD rail's colours, finer to coarser: the same position is the same colour everywhere.
const DETAIL_COLOURS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [0x46, 0xdb, 0x8f]],
  [0.55, [0xf6, 0xd3, 0x65]],
  [1, [0xff, 0x6b, 0x6b]],
];

export function detailColour(fraction: number): string {
  const t = Math.min(1, Math.max(0, fraction));
  let index = 1;
  while (index < DETAIL_COLOURS.length - 1 && t > DETAIL_COLOURS[index][0]) index += 1;
  const [t0, c0] = DETAIL_COLOURS[index - 1];
  const [t1, c1] = DETAIL_COLOURS[index];
  const u = (t - t0) / (t1 - t0);
  return `rgb(${c0.map((value, channel) => Math.round(value + (c1[channel] - value) * u)).join(", ")})`;
}

// Where a thumb's centre sits, as a CSS length along the track.
const along = (fraction: number): string => `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${fraction})`;

export function createTrack(options: TrackOptions): TrackHandle {
  const document = options.document;
  const element = document.createElement("div");
  element.className = `foss-earth-track foss-earth-track--${options.ramp}${options.className ? ` ${options.className}` : ""}`;
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", options.ariaLabel);
  const colours = document.createElement("span");
  colours.className = "foss-earth-track__colours";
  colours.setAttribute("aria-hidden", "true");
  const shadeLow = document.createElement("span");
  shadeLow.className = "foss-earth-track__shade foss-earth-track__shade--low";
  shadeLow.setAttribute("aria-hidden", "true");
  const shadeHigh = document.createElement("span");
  shadeHigh.className = "foss-earth-track__shade foss-earth-track__shade--high";
  shadeHigh.setAttribute("aria-hidden", "true");
  const stripe = document.createElement("span");
  stripe.className = "foss-earth-track__stripe";
  stripe.setAttribute("aria-hidden", "true");
  const tick = document.createElement("span");
  tick.className = "foss-earth-track__tick";
  tick.setAttribute("aria-hidden", "true");
  const inUse = document.createElement("span");
  inUse.className = "foss-earth-track__in-use";
  inUse.hidden = true;
  element.append(colours, shadeLow, shadeHigh, stripe, tick, inUse);
  const faceUnit = options.faceUnit ?? "";

  const inputs = new Map<string, HTMLInputElement>();
  const faces = new Map<string, HTMLElement>();
  const shownFaces = new Map<string, NumberFace>();
  const markerTicks = new Map<string, HTMLElement>();
  let dragging: HTMLInputElement | null = null;
  let lastMoved: string | null = null;
  // A press on a handle: where it started and whether it has moved the value.
  let press: { input: HTMLInputElement; x: number; y: number; moved: boolean } | null = null;
  let editor: HTMLInputElement | null = null;
  let editing: { id: string; start: string } | null = null;

  const onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const id = input.dataset.thumb;
    if (!id) return;
    lastMoved = id;
    if (press?.input === input) press.moved = true;
    options.onInput(id, Number(input.value));
  };
  const pointAt = (event: Event): { x: number; y: number } => {
    const pointer = event as MouseEvent;
    return { x: Number(pointer.clientX) || 0, y: Number(pointer.clientY) || 0 };
  };
  const onPointerDown = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    dragging = input;
    press = faces.has(input.dataset.thumb ?? "") && !input.disabled ? { input, ...pointAt(event), moved: false } : null;
  };
  const onPointerMove = (event: Event): void => {
    if (!press || press.moved) return;
    const at = pointAt(event);
    if (Math.hypot(at.x - press.x, at.y - press.y) > CLICK_SLOP_PX) press.moved = true;
  };
  const onPointerUp = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (dragging === input) dragging = null;
    const id = input.dataset.thumb;
    if (id) options.onCommit?.(id);
    if (event.type !== "pointerup" || press?.input !== input) return;
    const at = pointAt(event);
    const still = !press.moved && Math.hypot(at.x - press.x, at.y - press.y) <= CLICK_SLOP_PX;
    press = null;
    // Selecting the handle: the value becomes editable in place, the rest of the track unchanged.
    if (still && id) edit(id);
  };
  const onPointerCancel = (event: Event): void => {
    if (press?.input === event.target) press = null;
    onPointerUp(event);
  };
  const onThumbKey = (event: KeyboardEvent): void => {
    const input = event.target as HTMLInputElement;
    const id = input.dataset.thumb;
    if (!id || !faces.has(id) || input.disabled || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter") { event.preventDefault(); edit(id); return; }
    // Typing a number starts typing it on the handle.
    if (/^[0-9.,−-]$/.test(event.key)) { event.preventDefault(); edit(id, event.key); }
  };

  function closeEditor(commit: boolean, refocus: boolean): void {
    if (!editor || !editing) return;
    const { id, start } = editing;
    const text = editor.value.trim();
    editing = null;
    editor.hidden = true;
    faces.get(id)?.classList.remove("is-editing");
    if (refocus) inputs.get(id)?.focus();
    if (commit && text !== "" && text !== start) options.onEdit?.(id, text);
  }
  const onEditorKey = (event: KeyboardEvent): void => {
    if (event.key === "Enter") { event.preventDefault(); closeEditor(true, true); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeEditor(false, true); }
  };
  const onEditorBlur = (): void => { closeEditor(true, false); };

  function edit(id: string, text?: string): void {
    const face = shownFaces.get(id);
    const input = inputs.get(id);
    if (!face || !input || input.disabled || !options.onEdit) return;
    if (!editor) {
      editor = document.createElement("input");
      editor.type = "text";
      editor.inputMode = "decimal";
      editor.autocomplete = "off";
      editor.spellcheck = false;
      editor.className = "foss-earth-track__editor";
      editor.addEventListener("keydown", onEditorKey);
      editor.addEventListener("blur", onEditorBlur);
      element.append(editor);
    }
    if (editing) closeEditor(true, false);
    const start = editText(face);
    editing = { id, start };
    editor.value = text ?? start;
    editor.setAttribute("aria-label", `${input.getAttribute("aria-label") ?? options.ariaLabel}: type a value`);
    editor.style.left = faces.get(id)!.style.left;
    editor.style.zIndex = "20";
    editor.hidden = false;
    faces.get(id)!.classList.add("is-editing");
    editor.focus();
    if (text === undefined) editor.select();
    else editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  function faceFor(id: string): HTMLElement {
    let face = faces.get(id);
    if (!face) {
      face = document.createElement("span");
      face.className = "foss-earth-track__face";
      face.setAttribute("aria-hidden", "true");
      const sign = document.createElement("span");
      sign.className = "foss-earth-track__face-sign";
      const pad = document.createElement("span");
      pad.className = "foss-earth-track__face-pad";
      const digits = document.createElement("span");
      digits.className = "foss-earth-track__face-digits";
      const number = document.createElement("span");
      number.className = "foss-earth-track__face-number";
      number.append(sign, pad, digits);
      face.append(number);
      if (faceUnit) {
        const unit = document.createElement("span");
        unit.className = "foss-earth-track__face-unit";
        face.append(unit);
      }
      element.append(face);
      faces.set(id, face);
    }
    return face;
  }

  function thumbInput(thumb: TrackThumb): HTMLInputElement {
    let input = inputs.get(thumb.id);
    if (!input) {
      input = document.createElement("input");
      input.type = "range";
      input.dataset.thumb = thumb.id;
      input.addEventListener("input", onInput);
      input.addEventListener("pointerdown", onPointerDown);
      input.addEventListener("pointermove", onPointerMove);
      input.addEventListener("pointerup", onPointerUp);
      input.addEventListener("pointercancel", onPointerCancel);
      input.addEventListener("change", onPointerUp);
      input.addEventListener("keydown", onThumbKey);
      element.append(input);
      inputs.set(thumb.id, input);
    }
    return input;
  }

  function markerTick(thumb: TrackThumb): HTMLElement {
    let mark = markerTicks.get(thumb.id);
    if (!mark) {
      mark = document.createElement("span");
      mark.className = "foss-earth-track__marker-tick";
      const text = document.createElement("span");
      text.className = "foss-earth-track__marker-label";
      mark.append(text);
      element.append(mark);
      markerTicks.set(thumb.id, mark);
    }
    return mark;
  }

  return {
    element,
    isDragging: () => dragging !== null,
    render(frame) {
      const span = frame.max - frame.min;
      const fraction = (position: number): number => (span > 0 ? Math.min(1, Math.max(0, (position - frame.min) / span)) : 0.5);
      const colourAt = (position: number): string => options.ramp === "detail" ? detailColour(fraction(position)) : "var(--globe-accent, #60a5fa)";
      element.classList.toggle("is-disabled", Boolean(frame.disabled));
      const faceChars = frame.faceChars ?? 0;
      element.classList.toggle("foss-earth-track--handles", faceChars > 0);
      element.classList.toggle("foss-earth-track--unit-on-handle", faceChars > 0 && faceUnit !== "");
      if (faceChars > 0 && element.style.getPropertyValue("--face-chars") !== String(faceChars)) element.style.setProperty("--face-chars", String(faceChars));

      shadeLow.hidden = !frame.range;
      shadeHigh.hidden = !frame.range;
      if (frame.range) {
        shadeLow.style.right = `calc(100% - ${along(fraction(frame.range.low))})`;
        shadeHigh.style.left = along(fraction(frame.range.high));
      }
      stripe.hidden = !frame.stripe || frame.stripe.high - frame.stripe.low <= 0;
      if (frame.stripe) {
        stripe.style.left = along(fraction(frame.stripe.low));
        stripe.style.right = `calc(100% - ${along(fraction(frame.stripe.high))})`;
      }
      tick.hidden = frame.tick === null || frame.tick === undefined;
      if (frame.tick !== null && frame.tick !== undefined) tick.style.left = along(fraction(frame.tick));
      inUse.hidden = !frame.inUse;
      if (frame.inUse) {
        inUse.style.left = along(fraction(frame.inUse.position));
        if (inUse.title !== frame.inUse.label) inUse.title = frame.inUse.label;
      }

      const seen = new Set<string>();
      const ends = frame.thumbs.filter(thumb => thumb.role === "end");
      const endsTogether = ends.length === 2 && Math.abs(ends[0].position - ends[1].position) < 1e-9;
      for (const thumb of frame.thumbs) {
        seen.add(thumb.id);
        const colour = thumb.colour ?? colourAt(thumb.position);
        if (thumb.role === "marker") {
          const mark = markerTick(thumb);
          mark.style.left = along(fraction(thumb.position));
          mark.style.setProperty("--marker-colour", colour);
          mark.classList.toggle("is-hollow", Boolean(thumb.hollow));
          mark.title = `${thumb.label ?? thumb.ariaLabel}: ${thumb.ariaValueText}`;
          (mark.firstChild as HTMLElement).textContent = thumb.label ?? "";
        }
        if (thumb.fixed) {
          inputs.get(thumb.id)?.remove();
          inputs.delete(thumb.id);
          continue;
        }
        const input = thumbInput(thumb);
        input.className = `foss-earth-track__thumb foss-earth-track__thumb--${thumb.role}${thumb.hollow ? " is-hollow" : ""}`;
        input.min = String(frame.min);
        input.max = String(frame.max);
        input.step = String(frame.step);
        if (dragging !== input) input.value = String(thumb.position);
        input.disabled = Boolean(frame.disabled || thumb.disabled);
        input.hidden = Boolean(thumb.hidden);
        input.setAttribute("aria-label", thumb.ariaLabel);
        input.setAttribute("aria-valuetext", thumb.ariaValueText);
        input.style.setProperty("--thumb-colour", colour);
        let z = thumb.role === "default" ? 5 : thumb.role === "marker" ? 4 : 2;
        // Stacked ends: keep on top the one that can still move.
        if (thumb.role === "end" && ends.length === 2) {
          const top = endsTogether ? (fraction(thumb.position) > 0.5 ? ends[0].id : ends[1].id) : lastMoved;
          z = thumb.id === top ? 3 : 2;
        }
        input.style.zIndex = String(z);
        const handle = faceChars > 0 && thumb.face !== undefined && (thumb.role === "value" || thumb.role === "end");
        input.classList.toggle("foss-earth-track__thumb--handle", handle);
        if (handle) {
          const face = faceFor(thumb.id);
          shownFaces.set(thumb.id, thumb.face!);
          setFace(face, thumb.face!, faceUnit);
          face.style.left = along(fraction(thumb.position));
          // A face rides above its own thumb and below a handle stacked over it.
          face.style.zIndex = String(10 + z);
          face.hidden = Boolean(thumb.hidden);
          if (editing?.id === thumb.id && editor) editor.style.left = face.style.left;
        } else {
          faces.get(thumb.id)?.remove();
          faces.delete(thumb.id);
          shownFaces.delete(thumb.id);
        }
      }
      for (const [id, input] of inputs) {
        if (!seen.has(id)) { input.remove(); inputs.delete(id); }
      }
      for (const [id, face] of faces) {
        if (!inputs.has(id)) { face.remove(); faces.delete(id); shownFaces.delete(id); }
      }
      if (editing && (!faces.has(editing.id) || inputs.get(editing.id)?.disabled)) closeEditor(false, false);
      for (const [id, mark] of markerTicks) {
        if (!seen.has(id)) { mark.remove(); markerTicks.delete(id); }
      }
    },
    edit,
    isEditing: () => editing !== null,
    destroy() {
      for (const input of inputs.values()) {
        input.removeEventListener("input", onInput);
        input.removeEventListener("pointerdown", onPointerDown);
        input.removeEventListener("pointermove", onPointerMove);
        input.removeEventListener("pointerup", onPointerUp);
        input.removeEventListener("pointercancel", onPointerCancel);
        input.removeEventListener("change", onPointerUp);
        input.removeEventListener("keydown", onThumbKey);
      }
      if (editor) {
        editor.removeEventListener("keydown", onEditorKey);
        editor.removeEventListener("blur", onEditorBlur);
      }
      element.remove();
    },
  };
}
