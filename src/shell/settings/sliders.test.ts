// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry, type SettingsStorage } from "../../settings/registry.js";
import type { ParameterSpec } from "../../settings/types.js";
import { createParameterSection as createInjectedParameterSection } from "./parameterSection.js";
import { testReadingRefresh } from "../../../tests/fixtures/readingRefresh.js";

const readingRefresh = testReadingRefresh();
afterEach(() => { readingRefresh.dispose(); document.body.replaceChildren(); vi.useRealTimers(); });

function memoryStorage(): SettingsStorage {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const base = { appliesLive: true, source: "src/test.ts", defaultReason: "Chosen for tests.", home: { tab: "renderer", section: "main", level: "main" } } as const;
const specs: ParameterSpec[] = [
  // Resolution's shape: shown all the time, its handle the field.
  { ...base, id: "t.resolution", label: "Resolution", description: "Pixels drawn per pixel.", unit: "ratio", kind: "number", bounds: () => ({ min: 0.25, max: 2 }), step: 0.25, scale: "log2", alwaysShowTrack: true, default: 1 },
  // Frame rate cap's shape: named Off, a measured rate in use.
  { ...base, id: "t.cap", label: "Frame rate cap", description: "The most frames.", unit: "fps", kind: "number", named: [{ id: "off", label: "Off" }], bounds: () => ({ min: 10, max: 240 }), step: 0.25, scale: "log2", alwaysShowTrack: true, default: 60 },
  // A Debug setting: on demand.
  { ...base, id: "t.goal", label: "Frame time goal", description: "A goal.", unit: "ms", kind: "number", bounds: () => ({ min: 4, max: 50 }), step: 0.5, default: 16.5 },
  { ...base, id: "t.depth", label: "Fixed depth range", description: "Near to far.", unit: "m", kind: "range", bounds: () => ({ min: 0.1, max: 10_737_418 }), scale: "log2", default: { min: 0.1, max: 10_737_418 } },
];

function setup() {
  const settings = createSettingsRegistry({ storage: memoryStorage() });
  settings.register(specs);
  const section = createInjectedParameterSection(settings, { tab: "renderer", section: "main", document, refresh: readingRefresh });
  document.body.append(section.element);
  const control = (id: string) => section.element.querySelector<HTMLElement>(`[data-parameter="${id}"]`)!;
  return { settings, section, control };
}

const pointer = (type: string, x = 0, pointerType = "mouse"): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: !type.endsWith("enter") && !type.endsWith("leave"), clientX: x, clientY: 10 });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
};
const faceText = (element: Element): string => element.textContent ?? "";
const popoverOf = (control: HTMLElement) => control.querySelector<HTMLElement>(".foss-earth-track-popover")!;
const isOpen = (control: HTMLElement): boolean => popoverOf(control).classList.contains("is-open");

describe("sliders", () => {
  it("puts ? last, after the track, whether the track is shown or on demand", () => {
    const { settings, control } = setup();
    for (const id of ["t.resolution", "t.cap", "t.goal", "t.depth"]) {
      const header = control(id).querySelector(".foss-earth-parameter__header")!;
      const track = control(id).querySelector(".foss-earth-track")!;
      const help = header.querySelector(".foss-earth-parameter__help-button")!;
      // Nothing in the phrase comes after ?.
      const items = [...header.querySelectorAll("*")].filter(element => !element.parentElement!.closest(".foss-earth-parameter__help-button") && !element.closest(".foss-earth-track"));
      expect(items.at(-1)).toBe(help);
      expect(track.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The range inputs stay in the control, never hidden from keyboards or screen readers.
      for (const range of control(id).querySelectorAll<HTMLInputElement>('input[type="range"]')) {
        expect(range.closest("[hidden], [aria-hidden='true']")).toBeNull();
      }
    }
    // A shown track takes the value's place, its unit on its line: "Resolution [——1.00——] × ?".
    const resolution = control("t.resolution").querySelector(".foss-earth-parameter__header")!;
    expect([...resolution.children].map(child => child.classList[0])).toEqual(["foss-earth-parameter__label", "foss-earth-parameter__track-value", "foss-earth-parameter__tail"]);
    const value = resolution.querySelector(".foss-earth-parameter__track-value")!;
    expect([...value.children].map(child => child.classList[0])).toEqual(["foss-earth-track", "foss-earth-parameter__unit"]);
    expect(value.lastElementChild!.textContent).toBe("×");
    // Off takes the cap's whole track line away, leaving no empty gap.
    const cap = control("t.cap").querySelector<HTMLElement>(".foss-earth-parameter__track-value")!;
    expect(cap.hidden).toBe(false);
    settings.set("t.cap", "off");
    expect(cap.hidden).toBe(true);
    expect(control("t.resolution").querySelector(".foss-earth-parameter__field")).toBeNull();
    // A range writes its unit in its label: "Fixed depth range (m) [00.10] to [10.7M] ?".
    expect(control("t.depth").querySelector(".foss-earth-parameter__label")!.textContent).toBe("Fixed depth range(m)");
    expect([...control("t.depth").querySelectorAll(".foss-earth-parameter__face")].map(faceText)).toEqual(["00.10", "10.7M"]);
  });

  it("shows an on-demand track while hovered, pins it when selected, and closes it on a press elsewhere or Escape", () => {
    vi.useFakeTimers();
    const { control } = setup();
    const goal = control("t.goal");
    expect(isOpen(goal)).toBe(false);
    goal.dispatchEvent(pointer("pointerenter"));
    expect(isOpen(goal)).toBe(true);
    goal.dispatchEvent(pointer("pointerleave"));
    vi.advanceTimersByTime(100);
    // Moving from the value to the popover keeps it open.
    goal.dispatchEvent(pointer("pointerenter"));
    vi.advanceTimersByTime(500);
    expect(isOpen(goal)).toBe(true);
    goal.dispatchEvent(pointer("pointerleave"));
    vi.advanceTimersByTime(500);
    expect(isOpen(goal)).toBe(false);

    // A click pins it: leaving no longer closes it.
    goal.dispatchEvent(pointer("pointerenter"));
    goal.querySelector(".foss-earth-parameter__field")!.dispatchEvent(pointer("pointerdown"));
    goal.dispatchEvent(pointer("pointerleave"));
    vi.advanceTimersByTime(500);
    expect(isOpen(goal)).toBe(true);
    expect(popoverOf(goal).classList.contains("is-pinned")).toBe(true);
    // A press on the popover's own track is inside it.
    goal.querySelector('input[type="range"]')!.dispatchEvent(pointer("pointerdown"));
    expect(isOpen(goal)).toBe(true);
    document.body.dispatchEvent(pointer("pointerdown"));
    expect(isOpen(goal)).toBe(false);

    // Keyboard focus selects it too, and Escape closes it.
    goal.querySelector<HTMLInputElement>(".foss-earth-parameter__field")!.focus();
    expect(isOpen(goal)).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isOpen(goal)).toBe(false);

    // A touch has no hover; its tap pins the track.
    goal.dispatchEvent(pointer("pointerenter", 0, "touch"));
    expect(isOpen(goal)).toBe(false);
    goal.dispatchEvent(pointer("pointerdown", 0, "touch"));
    expect(isOpen(goal)).toBe(true);
  });

  it("shows one track at a time, and hover does not replace a pinned one", () => {
    const { control } = setup();
    const goal = control("t.goal");
    const depth = control("t.depth");
    goal.dispatchEvent(pointer("pointerenter"));
    depth.dispatchEvent(pointer("pointerenter"));
    expect([isOpen(goal), isOpen(depth)]).toEqual([false, true]);
    depth.dispatchEvent(pointer("pointerdown"));
    goal.dispatchEvent(pointer("pointerenter"));
    expect([isOpen(goal), isOpen(depth)]).toEqual([false, true]);
  });

  it("leaves the phrase as it was while its track opens: only a value change changes it", () => {
    const { settings, control } = setup();
    const goal = control("t.goal");
    const header = goal.querySelector(".foss-earth-parameter__header")!;
    const before = header.outerHTML;
    goal.dispatchEvent(pointer("pointerenter"));
    expect(isOpen(goal)).toBe(true);
    // The popover is the only part that changes, and it stays in the control.
    const strip = (html: string): string => html.replace(/<div class="foss-earth-track-popover[^]*?<\/div><\/div>/, "");
    expect(strip(header.outerHTML)).toBe(strip(before));
    expect(goal.contains(popoverOf(goal))).toBe(true);
    settings.set("t.goal", 20);
    expect(goal.querySelector(".foss-earth-parameter__face")!.textContent).toBe("20.0");
  });

  it("opens the handle's field on a press that does not move, and drags on one that does", () => {
    const { settings, control } = setup();
    const resolution = control("t.resolution");
    const thumb = resolution.querySelector<HTMLInputElement>('input[type="range"]')!;
    const editor = (): HTMLInputElement | null => resolution.querySelector<HTMLInputElement>(".foss-earth-track__editor");
    // A drag: the press moves, the value follows, and no field opens.
    thumb.dispatchEvent(pointer("pointerdown", 100));
    thumb.dispatchEvent(pointer("pointermove", 130));
    thumb.value = "0.5";
    thumb.dispatchEvent(new Event("input"));
    thumb.dispatchEvent(pointer("pointerup", 130));
    expect(settings.get("t.resolution")).toBe(1.41);
    expect(editor()?.hidden ?? true).toBe(true);
    // A click: the value becomes an editable field over the handle, its text selected.
    thumb.dispatchEvent(pointer("pointerdown", 100));
    thumb.dispatchEvent(pointer("pointerup", 102));
    expect(editor()!.hidden).toBe(false);
    expect(document.activeElement).toBe(editor());
    expect(editor()!.value).toBe("1.41");
    expect([editor()!.selectionStart, editor()!.selectionEnd]).toEqual([0, 4]);
    expect(resolution.querySelector(".foss-earth-track__face")!.classList.contains("is-editing")).toBe(true);
    editor()!.value = "0.5";
    editor()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(settings.get("t.resolution")).toBe(0.5);
    expect(editor()!.hidden).toBe(true);
    expect(document.activeElement).toBe(thumb);
    // Keyboard: Enter on the handle opens it, a digit starts typing, Escape keeps the value.
    thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(editor()!.hidden).toBe(false);
    editor()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor()!.hidden).toBe(true);
    thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    expect(editor()!.value).toBe("2");
    editor()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(settings.get("t.resolution")).toBe(2);
    // A refused value leaves the setting and explains why.
    thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "9", bubbles: true }));
    editor()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(settings.get("t.resolution")).toBe(2);
    const help = resolution.querySelector(".foss-earth-parameter__help-button")!;
    expect(document.getElementById(help.getAttribute("aria-controls")!)!.querySelector(".foss-earth-parameter__note")!.textContent).toMatch(/2/);
  });

  it("keeps the handle's and the field's character count across the whole range", () => {
    const { settings, control } = setup();
    const resolution = control("t.resolution");
    const thumb = resolution.querySelector<HTMLInputElement>('input[type="range"]')!;
    const track = resolution.querySelector<HTMLElement>(".foss-earth-track")!;
    const seen = new Set<string>();
    const widths = new Set<string>();
    for (let position = Number(thumb.min); position <= Number(thumb.max) + 1e-9; position += Number(thumb.step)) {
      thumb.value = String(position);
      thumb.dispatchEvent(new Event("input"));
      const face = resolution.querySelector(".foss-earth-track__face")!;
      seen.add(faceText(face));
      expect(faceText(face)).toHaveLength(4);
      widths.add(track.style.getPropertyValue("--face-chars"));
    }
    expect([...seen]).toEqual(["0.25", "0.30", "0.35", "0.42", "0.50", "0.59", "0.71", "0.84", "1.00", "1.19", "1.41", "1.68", "2.00"]);
    expect([...widths]).toEqual(["4"]);
    // The on-demand field: the same count, its zeros drawn faint.
    const goal = control("t.goal");
    const field = goal.querySelector<HTMLInputElement>(".foss-earth-parameter__field")!;
    for (const [value, shown] of [[4, "04.0"], [16.5, "16.5"], [50, "50.0"]] as const) {
      settings.set("t.goal", value);
      expect([faceText(goal.querySelector(".foss-earth-parameter__face")!), field.size]).toEqual([shown, 4]);
    }
    expect(goal.querySelector(".foss-earth-parameter__face-pad")!.textContent).toBe("");
    settings.set("t.goal", 4);
    expect(goal.querySelector(".foss-earth-parameter__face-pad")!.textContent).toBe("0");
  });

  it("reaches the high end and the default of a log2 track whose steps miss them", () => {
    const { settings, control } = setup();
    const thumb = control("t.cap").querySelector<HTMLInputElement>('input[type="range"]')!;
    const values: unknown[] = [];
    for (let position = Number(thumb.min); position <= Number(thumb.max) + 1e-9; position += Number(thumb.step)) {
      thumb.value = String(position);
      thumb.dispatchEvent(new Event("input"));
      values.push(settings.get("t.cap"));
    }
    // Quarter octaves from 10 pass 57 and 67 and stop at 226: the step by 60 gives 60, and the last gives 240.
    expect(values).toEqual([10, 12, 14, 17, 20, 24, 28, 34, 40, 48, 60, 67, 80, 95, 113, 135, 160, 190, 240]);
  });

  it("steps a typed field with the arrow keys, as its track would", () => {
    const { settings, control } = setup();
    const field = control("t.goal").querySelector<HTMLInputElement>(".foss-earth-parameter__field")!;
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(settings.get("t.goal")).toBe(17);
    expect(field.value).toBe("17.0");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    expect(settings.get("t.goal")).toBe(12);
  });

  it("marks the value in use with an I-beam where it differs from the one set", () => {
    vi.useFakeTimers();
    const { settings, control } = setup();
    let measured: number | null = 48;
    settings.setReadingSource("t.cap", () => ({ text: null, inUse: measured }));
    settings.set("t.cap", 59);
    const cap = control("t.cap");
    const beam = cap.querySelector<HTMLElement>(".foss-earth-track__in-use")!;
    expect(beam.hidden).toBe(false);
    expect(beam.title).toBe("In use: 48 fps");
    expect(cap.querySelector('input[type="range"]')!.getAttribute("aria-valuetext")).toBe("59 fps, 48 fps in use");
    measured = 59;
    vi.advanceTimersByTime(1000);
    expect(beam.hidden).toBe(true);
    measured = null;
    vi.advanceTimersByTime(1000);
    expect(beam.hidden).toBe(true);
  });
});
