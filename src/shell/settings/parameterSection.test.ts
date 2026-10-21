// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry, type SettingsStorage } from "../../settings/registry.js";
import type { ParameterSpec } from "../../settings/types.js";
import { appendHostSections as appendInjectedHostSections, createParameterSection as createInjectedParameterSection, createSectionsElement, type ParameterSectionOptions, type SectionsElementHandle } from "./parameterSection.js";
import { createSavedSettingsSection } from "./savedSettings.js";
import { isParameterPending, markParametersApplied, parameterStartValue } from "./controls.js";

import { testReadingRefresh } from "../../../tests/fixtures/readingRefresh.js";
const readingRefresh = testReadingRefresh();
const appendHostSections = (settings: Parameters<typeof appendInjectedHostSections>[0], tab: string, sections: SectionsElementHandle, own: readonly string[]) => appendInjectedHostSections(settings, tab, sections, own, { document, refresh: readingRefresh });
const createParameterSection = (settings: Parameters<typeof createInjectedParameterSection>[0], options: Omit<ParameterSectionOptions, "refresh" | "document">) => createInjectedParameterSection(settings, { ...options, document, refresh: readingRefresh });
afterEach(() => { readingRefresh.dispose(); document.body.replaceChildren(); });

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const base = { appliesLive: true, source: "src/test.ts", defaultReason: "Chosen for tests." } as const;

const specs: ParameterSpec[] = [
  { ...base, id: "t.flag", label: "Flag", description: "A switch.", unit: "none", kind: "boolean", default: false, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.mode", label: "Mode", description: "A choice.", unit: "none", kind: "choice", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], default: "a", home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.budget", label: "Budget", description: "A number.", unit: "MiB", kind: "number", bounds: () => ({ min: 32, max: 1024 }), scale: "log2", default: 128, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.cap", label: "Cap", description: "A number or off.", unit: "fps", kind: "number", named: [{ id: "off", label: "Off" }], bounds: () => ({ min: 10, max: 240 }), step: 1, default: "off", home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.range", label: "Range", description: "A range.", unit: "count", kind: "range", bounds: () => ({ min: 0, max: 100 }), default: { min: 10, max: 60 }, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.key", label: "Key", description: "A secret.", unit: "none", kind: "text", default: "", sensitive: true, home: { tab: "map", section: "loading", level: "main" } },
  { ...base, id: "t.hidden", label: "Hidden", description: "Only under Show all.", unit: "ms", kind: "number", bounds: () => ({ min: 0, max: 10 }), default: 2, home: { tab: "map", section: "loading", level: "all" } },
];

function setup(searchParams?: URLSearchParams) {
  const storage = memoryStorage();
  const settings = createSettingsRegistry({ storage, searchParams, sourceBase: "https://example.test/blob/main/" });
  settings.register(specs);
  const section = createParameterSection(settings, { tab: "map", section: "loading" });
  document.body.append(section.element);
  const control = (id: string) => section.element.querySelector<HTMLElement>(`[data-parameter="${id}"]`)!;
  return { settings, section, control, storage };
}

function input(element: HTMLElement, selector: string): HTMLInputElement {
  return element.querySelector<HTMLInputElement>(selector)!;
}

function drag(thumb: HTMLInputElement, value: number): void {
  thumb.value = String(value);
  thumb.dispatchEvent(new Event("input"));
}

describe("parameter section", () => {
  it("draws a control for each main-level parameter, and none for the rest", () => {
    const { section, control } = setup();
    expect([...section.element.querySelectorAll(".foss-earth-parameter-section__main > [data-parameter]")].map(element => (element as HTMLElement).dataset.parameter))
      .toEqual(["t.flag", "t.mode", "t.budget", "t.cap", "t.range", "t.key"]);
    expect(control("t.hidden")).toBeNull();
  });

  it("puts the label, then the switch, before help, and the source in that explanation", () => {
    const { settings, control } = setup();
    const flag = control("t.flag");
    const header = flag.querySelector(".foss-earth-parameter__header")!;
    expect([...header.children].map(item => item.tagName)).toEqual(["LABEL", "SPAN", "SPAN", "BUTTON"]);
    expect(header.firstElementChild!.classList.contains("foss-earth-parameter__label")).toBe(true);
    // The switch sits in a span that can hold its reset.
    expect([...header.children[1]!.children].map(item => item.className)).toEqual(["foss-earth-choice foss-earth-switch", "foss-earth-parameter__reset"]);
    // The native checkbox stays focusable inside the switch, never hidden.
    const toggle = header.querySelector<HTMLInputElement>(".foss-earth-switch input[type=checkbox]")!;
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Flag");
    expect(header.lastElementChild!.classList.contains("foss-earth-parameter__help-button")).toBe(true);
    const help = header.querySelector<HTMLButtonElement>('[aria-label="Explain Flag"]')!;
    expect(flag.querySelector('[aria-label="Reset Flag"]')).toBeNull();
    expect(header.querySelector("a")).toBeNull();
    const source = flag.querySelector<HTMLAnchorElement>(".foss-earth-parameter-row__source")!;
    expect(source.textContent).toBe("↗");
    expect(source.getAttribute("aria-label")).toContain("src/test.ts");
    expect(source.parentElement?.className).toBe("foss-earth-parameter-row__id");
    expect(source.parentElement?.lastElementChild).toBe(source);
    expect(source.href).toBe("https://example.test/blob/main/src/test.ts");
    expect(source.title).toContain("The code that reads t.flag");
    expect(help.textContent).toBe("?");
    input(flag, "input").click();
    expect(settings.get("t.flag")).toBe(true);
    flag.querySelector<HTMLLabelElement>(".foss-earth-parameter__label")!.click();
    expect(settings.get("t.flag")).toBe(false);
  });

  it("shows compact choice icons and symbols in one control row with full accessible and help labels", () => {
    const { settings, section, control } = setup();
    settings.register([{
      ...base,
      id: "t.visibility", label: "Visibility", description: "Show, fit automatically, or hide.", unit: "none", kind: "choice", default: "auto",
      choices: [{ id: "on", label: "On", icon: "line" }, { id: "auto", label: "Auto", shortLabel: "A" }, { id: "off", label: "Off", icon: "circle" }],
      home: { tab: "map", section: "loading", level: "main" },
    }]);
    const visibility = control("t.visibility");
    const header = visibility.querySelector(".foss-earth-parameter__header")!;
    expect(visibility.classList.contains("foss-earth-parameter--compact-choice")).toBe(true);
    // Label first by default: "Visibility [On / A / Off] ?".
    expect([...header.children].map(child => child.className)).toEqual([
      "foss-earth-choices__heading",
      "foss-earth-parameter__pills foss-earth-parameter__reset-anchor",
      "foss-earth-parameter__status",
      "foss-earth-choice foss-earth-parameter__action foss-earth-parameter__icon-action foss-earth-parameter__help-button",
    ]);
    expect(visibility.querySelector(".foss-earth-parameter__header a")).toBeNull();
    expect(visibility.querySelector(".foss-earth-parameter-row__source")!.textContent).toBe("↗");
    const labels = [...visibility.querySelectorAll<HTMLLabelElement>(".foss-earth-parameter__pills label")];
    expect(labels.map(label => label.textContent)).toEqual(["", "A", ""]);
    expect(labels.map(label => Boolean(label.querySelector('svg[aria-hidden="true"]')))).toEqual([true, false, true]);
    expect(labels.map(label => label.title)).toEqual(["On", "Auto", "Off"]);
    expect(labels.map(label => label.querySelector("input")!.getAttribute("aria-label"))).toEqual(["On", "Auto", "Off"]);
    expect(input(visibility, 'input[value="auto"]').checked).toBe(true);
    input(visibility, 'input[value="on"]').click();
    expect(settings.get("t.visibility")).toBe("on");
    visibility.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!.click();
    const explanation = document.getElementById(visibility.querySelector(".foss-earth-parameter__help-button")!.getAttribute("aria-controls")!)!;
    expect(explanation.textContent).toContain("Now On (set by you). Default Auto:");
    settings.reset("t.visibility");
    expect(settings.get("t.visibility")).toBe("auto");
    expect(input(visibility, 'input[value="auto"]').checked).toBe(true);
    // Every choice uses the same track: the label, options in the track, then help.
    const mode = control("t.mode");
    expect(mode.classList.contains("foss-earth-parameter--compact-choice")).toBe(true);
    expect(mode.querySelector(".foss-earth-parameter__pills")!.parentElement).toBe(mode.querySelector(".foss-earth-parameter__header"));
    expect([...mode.querySelectorAll(".foss-earth-parameter__pills label")].map(label => label.textContent)).toEqual(["A", "B"]);
    section.destroy();
  });

  it("shows explanation and defaults only on help, closing on re-click, Escape or outside", () => {
    const { settings, section, control } = setup();
    const flag = control("t.flag");
    const help = flag.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
    const explanation = flag.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(explanation.hidden).toBe(true);
    expect(help.getAttribute("aria-expanded")).toBe("false");
    settings.force("t.flag", true, "a test needs it");
    help.click();
    expect(explanation.hidden).toBe(false);
    expect(explanation.textContent).toContain("A switch.");
    expect(explanation.textContent).toContain("Now on (set by the app: a test needs it)");
    expect(explanation.textContent).toContain("Default off: Chosen for tests.");
    expect(explanation.textContent).toContain("t.flag");
    expect(help.getAttribute("aria-describedby")).toBe(explanation.id);
    help.click();
    expect(explanation.hidden).toBe(true);
    help.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(explanation.hidden).toBe(true);
    expect(help.hasAttribute("aria-describedby")).toBe(false);
    help.click();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(explanation.hidden).toBe(true);
    help.click();
    control("t.mode").querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!.click();
    expect(explanation.hidden).toBe(true);
    help.click();
    section.destroy();
    expect(explanation.hidden).toBe(true);
  });

  it("portals fallback help beyond clipped panels, restores it on close, and removes it on destroy", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "showPopover");
    Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: undefined });
    try {
      const { settings, section, control } = setup();
      const flag = control("t.flag");
      const help = flag.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
      const explanation = flag.querySelector<HTMLElement>('[role="tooltip"]')!;
      const ancestorKey = vi.fn();
      section.element.addEventListener("keydown", ancestorKey);
      help.click();
      expect(explanation.parentElement).toBe(document.body);
      settings.set("t.flag", true);
      expect(explanation.textContent).toContain("Now on (set by you)");
      help.click();
      expect(explanation.parentElement).toBe(flag);
      help.click();
      help.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(ancestorKey).not.toHaveBeenCalled();
      expect(explanation.hidden).toBe(true);
      expect(explanation.parentElement).toBe(flag);
      help.click();
      section.destroy();
      expect(explanation.hidden).toBe(true);
      expect(explanation.parentElement).toBeNull();
      expect(document.body.contains(explanation)).toBe(false);
      expect(document.getElementById(explanation.id)).toBeNull();
      expect(help.getAttribute("aria-expanded")).toBe("false");
      expect(help.hasAttribute("aria-describedby")).toBe(false);
      help.click();
      expect(explanation.isConnected).toBe(false);
      expect(explanation.hidden).toBe(true);
      const unusedEscape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(unusedEscape);
      expect(unusedEscape.defaultPrevented).toBe(false);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "showPopover", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
    }
  });

  it("writes each kind of control to the registry", () => {
    const { settings, control } = setup();
    input(control("t.flag"), "input").click();
    expect(settings.get("t.flag")).toBe(true);
    input(control("t.mode"), 'input[value="b"]').click();
    expect(settings.get("t.mode")).toBe("b");

    const budget = input(control("t.budget"), 'input[type="range"]');
    expect(Number(budget.min)).toBeCloseTo(5);
    expect(Number(budget.max)).toBeCloseTo(10);
    drag(budget, 9);
    expect(settings.get("t.budget")).toBe(512);
    const field = input(control("t.budget"), ".foss-earth-parameter__field");
    field.value = "300";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.budget")).toBe(300);
    field.value = "5000";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.budget")).toBe(300);
    const header = control("t.budget").querySelector(".foss-earth-parameter__header")!;
    const helpButton = header.querySelector(".foss-earth-parameter__help-button")!;
    // One phrase, label first and help last: "Budget [0300] MiB ?", its track on demand between them.
    expect([...header.children].map(child => child.classList[0])).toEqual(["foss-earth-parameter__label", "foss-earth-parameter__value-end"]);
    const end = header.querySelector(".foss-earth-parameter__value-end")!;
    expect([...end.children].map(child => child.classList[0])).toEqual(["foss-earth-parameter__readout", "foss-earth-track-popover", "foss-earth-parameter__tail"]);
    expect([...end.querySelector(".foss-earth-parameter__readout")!.children].map(child => child.classList[0])).toEqual(["foss-earth-parameter__number", "foss-earth-parameter__unit"]);
    expect([...end.querySelector(".foss-earth-parameter__tail")!.children].map(child => child.classList[0])).toEqual([
      "foss-earth-parameter__text-after", "foss-earth-parameter__reading", "foss-earth-parameter__status", "foss-earth-choice",
    ]);
    expect(helpButton.previousElementSibling).toBe(header.querySelector(".foss-earth-parameter__status"));
    const helpId = helpButton.getAttribute("aria-controls")!;
    expect(document.getElementById(helpId)!.querySelector(".foss-earth-parameter__note")!.textContent).toMatch(/outside 32 MiB to 1,024 MiB/);

    // A named value hides the track and the number; "Value" brings them back.
    expect(input(control("t.cap"), 'input[value="off"]').checked).toBe(true);
    expect(control("t.cap").querySelector<HTMLElement>(".foss-earth-track")!.hidden).toBe(true);
    expect(control("t.cap").querySelector<HTMLElement>(".foss-earth-parameter__number")!.hidden).toBe(true);
    input(control("t.cap"), 'input[value=""]').click();
    expect(typeof settings.get("t.cap")).toBe("number");
    drag(input(control("t.cap"), 'input[type="range"]'), 60);
    expect(settings.get("t.cap")).toBe(60);
  });

  it("keeps a range's thumbs from passing each other", () => {
    const { settings, control } = setup();
    const [low, high] = [...control("t.range").querySelectorAll<HTMLInputElement>('input[type="range"]')];
    drag(low, 80);
    expect(settings.get("t.range")).toEqual({ min: 60, max: 60 });
    drag(high, 90);
    drag(low, 20);
    expect(settings.get("t.range")).toEqual({ min: 20, max: 90 });
    // "Range [020] to [090] ?": each end is a field of the range's width, its leading zero drawn faint.
    const fields = [...control("t.range").querySelectorAll<HTMLInputElement>(".foss-earth-parameter__field")];
    expect(fields.map(field => [field.value, field.size])).toEqual([["20", 3], ["90", 3]]);
    expect(control("t.range").querySelector(".foss-earth-parameter__face")!.textContent).toBe("020");
    fields[0].value = "30";
    fields[0].dispatchEvent(new Event("change"));
    expect(settings.get("t.range")).toEqual({ min: 30, max: 90 });
    fields[1].value = "10";
    fields[1].dispatchEvent(new Event("change"));
    expect(settings.get("t.range")).toEqual({ min: 30, max: 90 });
  });

  it("never shows a secret, and forgets it on Clear", () => {
    const { settings, control } = setup();
    const field = input(control("t.key"), "input");
    expect(field.type).toBe("password");
    field.value = "abc";
    [...control("t.key").querySelectorAll("button")].find(button => button.textContent === "Save")!.click();
    expect(settings.get("t.key")).toBe("abc");
    expect(field.value).toBe("");
    expect(control("t.key").textContent).toContain("Set");
    [...control("t.key").querySelectorAll("button")].find(button => button.textContent === "Clear")!.click();
    expect(settings.get("t.key")).toBe("");
  });

  it("sizes text and number fields to their text, after their label", () => {
    const { settings, control } = setup();
    const key = control("t.key");
    const field = input(key, "input");
    expect(key.querySelector(".foss-earth-parameter__header")!.firstElementChild!.classList.contains("foss-earth-parameter__label")).toBe(true);
    expect(field.size).toBe("Paste key".length + 1);
    field.value = "a key longer than its placeholder";
    field.dispatchEvent(new Event("input"));
    expect(field.size).toBe(field.value.length + 1);
    // Save, Clear and ? wrap as one, help last.
    const tail = key.querySelector(".foss-earth-parameter__tail")!;
    expect([...tail.querySelectorAll("button")].map(button => button.textContent)).toEqual(["Save", "Clear", "?"]);
    expect(tail.lastElementChild!.matches(".foss-earth-parameter__help-button")).toBe(true);
    // A slider's field always holds its range's widest value, 32 to 1024, with
    // leading zeros, so a drag that changes its digits never changes its width.
    const budget = input(control("t.budget"), ".foss-earth-parameter__field");
    const face = control("t.budget").querySelector(".foss-earth-parameter__face")!;
    for (const [value, shown] of [[300, "0300"], [1000, "1000"], [32, "0032"]] as const) {
      settings.set("t.budget", value);
      expect([budget.value, face.textContent, budget.size, budget.style.getPropertyValue("--field-chars")]).toEqual([String(value), shown, 4, "4"]);
    }
  });

  it("says where a value came from when it is not the user's", () => {
    const { settings, control } = setup(new URLSearchParams("set.t.mode=b"));
    expect(control("t.mode").querySelector(".foss-earth-parameter__note")!.textContent).toMatch(/From the URL for this visit/);
    const release = settings.force("t.flag", true, "the flight needs it");
    expect(input(control("t.flag"), "input").disabled).toBe(true);
    expect(control("t.flag").textContent).toMatch(/Set by the app: the flight needs it/);
    release();
    expect(input(control("t.flag"), "input").disabled).toBe(false);
  });

  it("shows what a budget bounds beside it, read again every second while it is shown", () => {
    vi.useFakeTimers();
    try {
      const { settings, control } = setup();
      let used = 100;
      const remove = settings.setReadingSource("t.budget", () => `${used} MiB in use`);
      settings.set("t.budget", 256);
      const reading = control("t.budget").querySelector<HTMLElement>(".foss-earth-parameter__reading")!;
      expect(reading.textContent).toBe("100 MiB in use");
      used = 180;
      vi.advanceTimersByTime(1000);
      expect(reading.textContent).toBe("180 MiB in use");
      remove();
      vi.advanceTimersByTime(1000);
      expect(reading.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws a host's parameter registered after the section exists", () => {
    const { settings, control } = setup();
    settings.register([{ ...base, id: "host.waiver", label: "Waiver", description: "A host switch.", unit: "none", kind: "boolean", default: false, session: true, home: { tab: "map", section: "loading", level: "main" } }]);
    expect(control("host.waiver")).not.toBeNull();
  });

  it("shows guarded numeric fields only while their editor is enabled, including Show all", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    settings.register([
      { ...base, id: "t.editPriorities", label: "Edit priorities", description: "Show priorities.", unit: "none", kind: "boolean", default: false, home: { tab: "other", section: "external", level: "main" } },
      { ...base, id: "t.priority", label: "Priority", description: "Lower comes first.", unit: "count", kind: "number", numberControl: "field", bounds: () => ({ min: 0, max: 99 }), step: 1, default: 2, visibleWhen: { id: "t.editPriorities", value: true }, home: { tab: "interface", section: "guarded", level: "main" } },
      { ...base, id: "t.extraPriority", label: "Extra priority", description: "Lower comes first.", unit: "count", kind: "number", numberControl: "field", default: 4, visibleWhen: { id: "t.editPriorities", value: true }, home: { tab: "interface", section: "guarded", level: "all" } },
    ]);
    const section = createParameterSection(settings, { tab: "interface", section: "guarded" });
    document.body.append(section.element);
    const main = section.element.querySelector<HTMLElement>(".foss-earth-parameter-section__main")!;
    const showAll = section.element.querySelector<HTMLInputElement>(".foss-earth-parameter-section__toggle input")!;
    if (!showAll.checked) showAll.click();
    expect(section.element.querySelector('[data-parameter="t.priority"]')).toBeNull();
    expect(section.element.querySelector('[data-parameter="t.extraPriority"]')).toBeNull();
    expect(settings.list({ tab: "interface", section: "guarded" })).toHaveLength(2);
    // The guard is in another tab: its change still rebuilds both views.
    settings.set("t.editPriorities", true);
    const priority = main.querySelector<HTMLElement>('[data-parameter="t.priority"]')!;
    expect(priority).not.toBeNull();
    expect(priority.querySelector('input[type="range"]')).toBeNull();
    const field = input(priority, 'input[type="number"]');
    expect([field.value, field.min, field.max, field.step]).toEqual(["2", "0", "99", "1"]);
    const list = section.element.querySelector(".foss-earth-parameter-list")!;
    expect(list.querySelector('[data-parameter="t.priority"]')).toBeNull();
    expect(list.querySelector('[data-parameter="t.extraPriority"]')).not.toBeNull();
    field.value = "7";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.priority")).toBe(7);
    field.value = "100";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.priority")).toBe(7);
    const tooltipId = priority.querySelector(".foss-earth-parameter__help-button")!.getAttribute("aria-controls")!;
    expect(document.getElementById(tooltipId)!.hidden).toBe(false);
    settings.set("t.editPriorities", false);
    expect(section.element.querySelector('[data-parameter="t.priority"]')).toBeNull();
    expect(section.element.querySelector('[data-parameter="t.extraPriority"]')).toBeNull();
    expect(document.getElementById(tooltipId)).toBeNull();
    expect(settings.get("t.priority")).toBe(7);
    expect(settings.export().values["t.priority"]).toBe(7);
    settings.set("t.editPriorities", true);
    expect(input(main.querySelector<HTMLElement>('[data-parameter="t.priority"]')!, 'input[type="number"]').value).toBe("7");
    section.destroy();
  });

  it("lists only the extra parameters under Show all parameters, with default, provenance and source", () => {
    const { settings, section } = setup();
    const toggle = section.element.querySelector<HTMLInputElement>(".foss-earth-parameter-section__toggle input")!;
    toggle.click();
    const rows = [...section.element.querySelectorAll<HTMLElement>(".foss-earth-parameter-row")];
    expect(rows.map(row => row.dataset.parameter)).toEqual(["t.hidden"]);
    const hidden = rows.find(row => row.dataset.parameter === "t.hidden")!;
    expect(hidden.querySelector(".foss-earth-parameter-row__meta")!.textContent).toBe("Now 2 ms (default). Default 2 ms: Chosen for tests.");
    const link = hidden.querySelector<HTMLAnchorElement>(".foss-earth-parameter-row__source")!;
    expect(link.href).toBe("https://example.test/blob/main/src/test.ts");
    const reset = hidden.querySelector<HTMLButtonElement>(".foss-earth-parameter__reset")!;
    expect(reset.hidden).toBe(true);
    settings.set("t.hidden", 5);
    expect(hidden.querySelector(".foss-earth-parameter-row__meta")!.textContent).toMatch(/^Now 5 ms \(set by you\)\./);
    expect(reset.hidden).toBe(false);
    toggle.click();
    expect(section.element.querySelector(".foss-earth-parameter-row")).toBeNull();
  });

  it("draws a choice's segments before its label only when the spec asks", () => {
    const { settings, control } = setup();
    settings.register([{
      ...base, id: "t.row", label: "Toolbar", description: "Visibility.", unit: "none", kind: "choice", default: "on", controlFirst: true,
      choices: [{ id: "on", label: "On" }, { id: "off", label: "Off" }], home: { tab: "map", section: "loading", level: "main" },
    }]);
    const header = control("t.row").querySelector(".foss-earth-parameter__header")!;
    expect(header.firstElementChild!.classList.contains("foss-earth-parameter__pills")).toBe(true);
    expect(header.children[1]!.classList.contains("foss-earth-choices__heading")).toBe(true);
    expect(header.lastElementChild!.classList.contains("foss-earth-parameter__help-button")).toBe(true);
  });

  it("keeps named values in one segmented track on the label's line, with accessible radios", () => {
    const { control } = setup();
    const cap = control("t.cap");
    const line = cap.querySelector(".foss-earth-parameter__header")!;
    const named = line.querySelector<HTMLElement>(".foss-earth-parameter__pills.foss-earth-parameter__named")!;
    expect(named.getAttribute("role")).toBe("radiogroup");
    expect(named.previousElementSibling).toBe(line.querySelector(".foss-earth-parameter__label"));
    expect([...named.querySelectorAll("label")].map(label => label.textContent)).toEqual(["Off", "Value"]);
    expect([...named.querySelectorAll<HTMLInputElement>("input[type=radio]")].every(radio => !radio.hidden && radio.getAttribute("aria-hidden") === null)).toBe(true);
    expect(line.querySelector(".foss-earth-parameter__tail")!.lastElementChild!.classList.contains("foss-earth-parameter__help-button")).toBe(true);
    // Off shows in its segment only, not again in the phrase: "Cap [Off | Value] ?".
    expect([...cap.querySelectorAll<HTMLElement>(".foss-earth-parameter__number, .foss-earth-parameter__unit")].every(element => element.hidden)).toBe(true);
    // A number without named values has no empty track.
    expect(control("t.budget").querySelector(".foss-earth-parameter__named")).toBeNull();
  });

  it("shows Changes pending with Apply & reload and Discard for a value that applies on the next start", () => {
    const storage = memoryStorage();
    const settings = createSettingsRegistry({ storage });
    const home = { tab: "renderer", section: "backend", level: "main" } as const;
    settings.register([
      { ...base, appliesLive: false, id: "t.backend", label: "Backend", description: "Applies after a reload.", unit: "none", kind: "choice", default: "auto", choices: [{ id: "auto", label: "Auto" }, { id: "webgl2", label: "WebGL2" }], home },
      { ...base, appliesLive: false, id: "t.workers", label: "Workers", description: "Applies after a reload.", unit: "count", kind: "number", numberControl: "field", bounds: () => ({ min: 1, max: 8 }), step: 1, default: 2, home },
    ]);
    settings.set("t.workers", 4);
    const reload = vi.fn();
    const section = createParameterSection(settings, { tab: home.tab, section: home.section, reload });
    document.body.append(section.element);
    const bar = section.element.querySelector<HTMLElement>(".foss-earth-parameter-section__pending")!;
    const status = (id: string) => section.element.querySelector(`[data-parameter="${id}"] .foss-earth-parameter__status`)!;
    // Values saved before this start are already in effect.
    expect(bar.hidden).toBe(true);
    input(section.element, '[data-parameter="t.backend"] input[value="webgl2"]').click();
    expect(settings.get("t.backend")).toBe("webgl2");
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector("[role=status]")!.textContent).toBe("Changes pending");
    expect(status("t.backend").textContent).toBe("Pending");
    expect(section.element.querySelector('[data-parameter="t.backend"]')!.classList.contains("is-pending")).toBe(true);
    expect(status("t.workers").textContent).toBe("");
    const field = input(section.element, '[data-parameter="t.workers"] input[type="number"]');
    field.value = "6";
    field.dispatchEvent(new Event("change"));
    expect(status("t.workers").textContent).toBe("Pending");
    const button = (label: string) => bar.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    button("Apply pending changes and reload").click();
    expect(reload).toHaveBeenCalledTimes(1);
    // Discard returns each value to what this start used: the default is reset, a saved value restored.
    button("Discard pending changes").click();
    expect(settings.get("t.backend")).toBe("auto");
    expect(settings.inspect("t.backend").provenance).toBe("default");
    expect(settings.get("t.workers")).toBe(4);
    expect(bar.hidden).toBe(true);
    expect(status("t.backend").textContent).toBe("");
    section.destroy();
  });

  it("marks only the parameters consumed by an in-place subsystem restart as applied", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    settings.register(["speed", "workers"].map(name => ({
      ...base, appliesLive: false, id: `t.${name}`, label: name, description: name,
      unit: "count", kind: "number", default: 2,
      home: { tab: "test", section: "start", level: "main" },
    })));
    parameterStartValue(settings, "t.speed");
    settings.setMany({ "t.speed": 4, "t.workers": 8 });
    expect(isParameterPending(settings, "t.speed")).toBe(true);
    expect(isParameterPending(settings, "t.workers")).toBe(true);
    markParametersApplied(settings, ["t.speed"]);
    expect(isParameterPending(settings, "t.speed")).toBe(false);
    expect(isParameterPending(settings, "t.workers")).toBe(true);
    settings.set("t.speed", 6);
    expect(isParameterPending(settings, "t.speed")).toBe(true);
    expect(parameterStartValue(settings, "t.speed")).toBe(4);
  });

  it("draws a mark before a compact choice label and skips Show all when nothing is extra", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    const home = { tab: "interface", section: "toolbar", level: "main" } as const;
    const choice = { unit: "none" as const, kind: "choice" as const, default: "on" as const, home, choices: [{ id: "on", label: "On", shortLabel: "On" }, { id: "off", label: "Off", shortLabel: "Off" }] };
    settings.register([
      { ...base, ...choice, id: "t.bug", label: "Bug report", description: "The bug button.", mark: "bug" },
      { ...base, ...choice, id: "t.meshes", label: "Active meshes", description: "The mesh count.", mark: "polygon" },
      { ...base, ...choice, id: "t.settings", label: "Settings", description: "The settings button.", mark: "gear" },
    ]);
    const section = createParameterSection(settings, { tab: "interface", section: "toolbar" });
    for (const [id, label] of [["t.bug", "Bug report"], ["t.meshes", "Active meshes"], ["t.settings", "Settings"]] as const) {
      const heading = section.element.querySelector(`[data-parameter="${id}"] .foss-earth-choices__heading`)!;
      expect(heading.firstElementChild?.classList.contains("foss-earth-parameter__mark")).toBe(true);
      expect(heading.textContent).toBe(label);
    }
    expect(section.element.querySelector(".foss-earth-parameter-section__toggle")).toBeNull();
    section.destroy();
  });

  it("edits paired priorities in the existing row and retains them across Auto and Custom", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    const home = { tab: "interface", section: "toolbar", level: "main" } as const;
    settings.register([
      { ...base, id: "t.custom", label: "Priorities", description: "Auto or Custom.", unit: "none", kind: "boolean", booleanControl: "auto-custom", default: false, home },
      { ...base, id: "t.visibility", label: "Camera position", description: "Visibility.", unit: "none", kind: "choice", choices: [{ id: "auto", label: "Auto", shortLabel: "A" }], default: "auto", home },
      { ...base, id: "t.priority", label: "Camera position priority", description: "Lower comes first.", unit: "count", kind: "number", numberControl: "field", bounds: () => ({ min: 0, max: 99 }), step: 1, default: 8, visibleWhen: { id: "t.custom", value: true }, inlineWith: "t.visibility", home },
    ]);
    const section = createParameterSection(settings, { tab: home.tab, section: home.section });
    document.body.append(section.element);
    expect(section.element.querySelector(".foss-earth-parameter-section__toggle")).toBeNull();
    const main = section.element.querySelector<HTMLElement>(".foss-earth-parameter-section__main")!;
    const mode = input(main, '[data-parameter="t.custom"] input[type="range"]');
    expect(mode.getAttribute("aria-valuetext")).toBe("Auto");
    expect(section.element.querySelector('input[type="number"]')).toBeNull();
    drag(mode, 1);
    const row = main.querySelector<HTMLElement>('[data-parameter="t.visibility"]')!;
    const field = input(row, 'input[type="number"]');
    expect(row.querySelector(".foss-earth-parameter__header")!.firstElementChild!.getAttribute("data-parameter")).toBe("t.priority");
    expect(main.querySelector(':scope > [data-parameter="t.priority"]')).toBeNull();
    expect(section.element.querySelector(".foss-earth-parameter-list")).toBeNull();
    field.value = "3";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.priority")).toBe(3);
    field.value = "100";
    field.dispatchEvent(new Event("change"));
    expect(settings.get("t.priority")).toBe(3);
    const help = row.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
    expect(help.getAttribute("aria-expanded")).toBe("true");
    const tooltip = document.getElementById(help.getAttribute("aria-controls")!)!;
    expect(tooltip.textContent).toContain("Camera position priority: 3");
    drag(mode, 0);
    expect(section.element.querySelector('input[type="number"]')).toBeNull();
    expect(settings.export().values["t.priority"]).toBe(3);
    drag(mode, 1);
    expect(input(row, 'input[type="number"]').value).toBe("3");
    section.destroy();
  });

  it("exports, imports and resets the section", () => {
    const { settings, section } = setup();
    section.element.querySelector<HTMLInputElement>(".foss-earth-parameter-section__toggle input")!.click();
    settings.set("t.budget", 256);
    settings.set("t.key", "secret");
    const button = (text: string) => [...section.element.querySelectorAll<HTMLButtonElement>(".foss-earth-settings-transfer button")].find(item => item.textContent === text)!;
    button("Export").click();
    const text = section.element.querySelector<HTMLTextAreaElement>(".foss-earth-settings-transfer__text")!;
    expect(JSON.parse(text.value)).toEqual({ format: "foss-earth.settings", version: 1, values: { "t.budget": 256 } });
    button("Import").click();
    text.value = JSON.stringify({ "t.mode": "b", "t.flag": "yes" });
    button("Apply").click();
    expect(settings.get("t.mode")).toBe("b");
    expect(section.element.querySelector(".foss-earth-settings-transfer [role=status]")!.textContent).toMatch(/Applied 1 value\. t\.flag: Expected on or off\./);
    button("Reset all").click();
    expect(settings.get("t.mode")).toBe("b");
    button("Reset every value here to its default?").click();
    expect(settings.get("t.mode")).toBe("a");
    expect(settings.get("t.budget")).toBe(128);
  });
});

describe("sections", () => {
  it("follows a section title with its ?, which opens without opening or closing the section", () => {
    const sections = createSectionsElement([
      { id: "map.selection", title: "Imagery selection", element: document.createElement("div"), defaultOpen: false, help: "How 2D imagery is chosen as the view moves." },
      { id: "map.detail", title: "Detail", element: document.createElement("div"), defaultOpen: true },
    ], { document, storage: memoryStorage() });
    document.body.append(sections.element);
    const [selection, detail] = [...sections.element.querySelectorAll("details")];
    const summary = selection!.querySelector("summary")!;
    // The summary is a button, so the ? is beside it, never inside it.
    expect(summary.textContent).toBe("Imagery selection");
    expect(summary.querySelector("button")).toBeNull();
    const frame = selection!.parentElement!;
    expect(frame.classList.contains("foss-earth-panel-section__frame")).toBe(true);
    const help = frame.querySelector<HTMLButtonElement>(":scope > .foss-earth-panel-section__help .foss-earth-parameter__help-button")!;
    expect(help.getAttribute("aria-label")).toBe("Explain Imagery selection");
    help.click();
    expect(selection!.open).toBe(false);
    expect(help.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(help.getAttribute("aria-controls")!)!.textContent).toBe("How 2D imagery is chosen as the view moves.");
    // The title itself still opens the section.
    summary.click();
    expect(selection!.open).toBe(true);
    expect(detail!.parentElement).toBe(sections.element);
    sections.destroy();
  });

  it("draws a tab's everyday controls on the tab itself, with no disclosure or title", () => {
    const controls = document.createElement("div");
    const sections = createSectionsElement([
      { id: "renderer.main", title: "Renderer", element: controls },
      { id: "renderer.clipping", title: "Depth range", element: document.createElement("div"), defaultOpen: false },
    ], { document, storage: memoryStorage() });
    const main = sections.element.firstElementChild as HTMLElement;
    expect([main.dataset.section, main.firstElementChild === controls]).toEqual(["renderer.main", true]);
    expect(main.querySelector("details, summary")).toBeNull();
    expect(sections.has("renderer.main")).toBe(true);
    expect([...sections.element.querySelectorAll(".foss-earth-panel-section__title")].map(title => title.textContent)).toEqual(["Depth range"]);
    sections.destroy();
  });
});

describe("host sections in FOSS Earth's tabs", () => {
  it("adds a section for each host section of a tab, titled by the host", () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register(specs);
    const sections = createSectionsElement([{ id: "renderer.main", title: "Renderer", element: document.createElement("div") }], { document });
    const hosts = appendHostSections(settings, "renderer", sections, ["main"]);
    settings.setSectionTitle("renderer", "instruments", "Instruments");
    settings.register([{ ...base, id: "osfs.renderer.attitudeIndicator", label: "Attitude indicator", description: "Its renderer.", unit: "none", kind: "choice", choices: [{ id: "auto", label: "Auto" }, { id: "canvas2d", label: "Canvas 2D" }], default: "auto", home: { tab: "renderer", section: "instruments", level: "main" } }]);
    settings.setNote("osfs.renderer.attitudeIndicator", "Drawing with Canvas 2D.");
    const titles = [...sections.element.querySelectorAll(".foss-earth-panel-section__title")].map(title => title.textContent);
    expect(titles).toEqual(["Instruments"]);
    expect(sections.element.textContent).toContain("Drawing with Canvas 2D.");
    hosts.destroy();
  });
});

describe("saved settings", () => {
  it("keeps this visit's URL values only when asked", () => {
    const storage = memoryStorage();
    const settings = createSettingsRegistry({ storage, searchParams: new URLSearchParams("set.t.budget=512") });
    settings.register(specs);
    const saved = createSavedSettingsSection(settings, document);
    document.body.append(saved.element);
    expect(saved.element.textContent).toContain("Budget: 512 MiB");
    const keep = [...saved.element.querySelectorAll("button")].find(button => button.textContent === "Keep")!;
    keep.click();
    expect(JSON.parse(storage.data.get("foss-earth.settings.v1")!).values).toEqual({ "t.budget": 512 });
    expect(saved.element.textContent).toContain("Saved 1 value.");
    expect(keep.hidden).toBe(true);
    saved.destroy();
  });

  it("copies an export", async () => {
    const settings = createSettingsRegistry({ storage: null });
    settings.register(specs);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const saved = createSavedSettingsSection(settings, document);
    document.body.append(saved.element);
    [...saved.element.querySelectorAll("button")].find(button => button.textContent === "Export")!.click();
    [...saved.element.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "Copy the settings")!.click();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\"format\": \"foss-earth.settings\""));
    vi.unstubAllGlobals();
    saved.destroy();
  });
});
