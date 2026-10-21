// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createSettingsRegistry, type SettingsStorage } from "../../settings/registry.js";
import type { ParameterSpec } from "../../settings/types.js";
import { createParameterControl } from "./controls.js";
import { createParameterSection } from "./parameterSection.js";
import { createResetBadge } from "./resetBadge.js";

import { testReadingRefresh } from "../../../tests/fixtures/readingRefresh.js";
const readingRefresh = testReadingRefresh();
afterEach(() => { readingRefresh.dispose(); document.body.replaceChildren(); });

function memoryStorage(): SettingsStorage {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const base = { appliesLive: true, source: "src/test.ts", defaultReason: "Chosen for tests." } as const;
const home = { tab: "map", section: "loading", level: "main" } as const;

const specs: ParameterSpec[] = [
  { ...base, id: "t.flag", label: "Flag", description: "A switch.", unit: "none", kind: "boolean", default: false, home },
  { ...base, id: "t.mode", label: "Mode", description: "A choice.", unit: "none", kind: "choice", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], default: "a", home },
  { ...base, id: "t.dock", label: "Dock", description: "Two ends.", unit: "none", kind: "choice", choiceControl: "two-position", choices: [{ id: "top", label: "Top" }, { id: "bottom", label: "Bottom" }], default: "bottom", home },
  { ...base, id: "t.cap", label: "Cap", description: "A number or off.", unit: "fps", kind: "number", named: [{ id: "off", label: "Off" }], bounds: () => ({ min: 10, max: 240 }), step: 1, default: 60, home },
  { ...base, id: "t.range", label: "Range", description: "A range.", unit: "count", kind: "range", bounds: () => ({ min: 0, max: 100 }), default: { min: 10, max: 60 }, home },
  { ...base, id: "t.date", label: "Date", description: "Text.", unit: "none", kind: "text", default: "", home },
];

function setup(searchParams?: URLSearchParams) {
  const settings = createSettingsRegistry({ storage: memoryStorage(), searchParams });
  settings.register(specs);
  const section = createParameterSection(settings, { tab: "map", section: "loading", document, refresh: readingRefresh });
  document.body.append(section.element);
  const badges = (id: string) => [...section.element.querySelectorAll<HTMLButtonElement>(`[data-parameter="${id}"] .foss-earth-parameter__reset`)];
  const badge = (id: string) => badges(id)[0]!;
  const shown = (id: string) => badges(id).filter(button => !button.hidden).map(button => button.parentElement!);
  return { settings, section, badges, badge, shown };
}

describe("reset badge", () => {
  it("sits on each widget, never on the row around it, and hides while the value is its default", () => {
    const { section, badges } = setup();
    const anchors = (id: string) => badges(id).map(button => button.parentElement!);
    for (const spec of specs) {
      for (const button of badges(spec.id)) {
        expect(button.hidden).toBe(true);
        expect(button.parentElement!.classList.contains("foss-earth-parameter__reset-anchor")).toBe(true);
        expect(button.parentElement!.classList.contains("foss-earth-parameter__header")).toBe(false);
      }
    }
    // A switch and a text field sit in a span that can hold the button.
    expect(anchors("t.flag").map(anchor => anchor.firstElementChild!.className)).toEqual(["foss-earth-choice foss-earth-switch"]);
    expect(anchors("t.mode").map(anchor => anchor.className)).toEqual(["foss-earth-parameter__pills foss-earth-parameter__reset-anchor"]);
    expect(anchors("t.dock").map(anchor => anchor.classList[0])).toEqual(["foss-earth-two-position-slider"]);
    // "Cap [Off | Value] [060] fps": one on the segments, one on the field.
    expect(anchors("t.cap").map(anchor => ["named", "number"].find(part => anchor.classList.contains(`foss-earth-parameter__${part}`)))).toEqual(["named", "number"]);
    // "Range [10] to [60]": one on each end.
    expect(anchors("t.range").map(anchor => anchor.querySelector("input")!.getAttribute("aria-label"))).toEqual(["Range: lower end", "Range: upper end"]);
    expect(anchors("t.date").map(anchor => anchor.firstElementChild!.className)).toEqual(["foss-earth-parameter__text"]);
    section.destroy();
  });

  it("appears when a value leaves its default, names the default, and resets it", () => {
    const { settings, section, badges, shown } = setup();
    settings.set("t.flag", true);
    settings.set("t.mode", "b");
    settings.set("t.dock", "top");
    settings.set("t.cap", "off");
    settings.set("t.range", { min: 20, max: 80 });
    settings.set("t.date", "2026-04-20");
    for (const spec of specs) expect(shown(spec.id).length).toBeGreaterThan(0);
    const cap = badges("t.cap").find(button => !button.hidden)!;
    expect(cap.getAttribute("aria-label")).toBe("Reset Cap to the default: 60 fps");
    expect(cap.title).toBe("Reset Cap to the default: 60 fps");
    for (const spec of specs) for (const button of badges(spec.id)) if (!button.hidden) button.click();
    for (const spec of specs) {
      expect(settings.inspect(spec.id).provenance).toBe("default");
      expect(shown(spec.id)).toEqual([]);
    }
    expect(settings.export().values).toEqual({});
    section.destroy();
  });

  it("puts Off's reset on the segments and a number's on its field", () => {
    const { settings, section, badges, shown } = setup();
    const [segments, field] = badges("t.cap");
    settings.set("t.cap", "off");
    expect(shown("t.cap")).toEqual([segments!.parentElement]);
    segments!.click();
    expect(settings.get("t.cap")).toBe(60);
    settings.set("t.cap", 90);
    expect(shown("t.cap")).toEqual([field!.parentElement]);
    expect(field!.parentElement!.hidden).toBe(false);
    field!.click();
    expect(settings.inspect("t.cap").provenance).toBe("default");
    expect(shown("t.cap")).toEqual([]);
    section.destroy();
  });

  it("resets a range's ends one at a time", () => {
    const { settings, section, badges, shown } = setup();
    const [low, high] = badges("t.range");
    settings.set("t.range", { min: 20, max: 80 });
    expect(shown("t.range")).toEqual([low!.parentElement, high!.parentElement]);
    expect(low!.getAttribute("aria-label")).toBe("Reset the lower end of Range to the default: 10");
    high!.click();
    expect(settings.get("t.range")).toEqual({ min: 20, max: 60 });
    expect(shown("t.range")).toEqual([low!.parentElement]);
    low!.click();
    expect(settings.inspect("t.range").provenance).toBe("default");
    // An end that cannot go back alone, past the other end, takes both back.
    settings.set("t.range", { min: 65, max: 70 });
    high!.click();
    expect(settings.inspect("t.range").provenance).toBe("default");
    section.destroy();
  });

  it("follows the control's own edits", () => {
    const { section, badge } = setup();
    const toggle = section.element.querySelector<HTMLInputElement>('[data-parameter="t.flag"] input[type="checkbox"]')!;
    toggle.click();
    expect(badge("t.flag").hidden).toBe(false);
    toggle.click();
    expect(badge("t.flag").hidden).toBe(true);
    section.destroy();
  });

  it("compares with the app's default, and forgets a value from the URL", () => {
    const { settings, section, badge } = setup(new URLSearchParams("set.t.mode=b"));
    expect(badge("t.mode").hidden).toBe(false);
    badge("t.mode").click();
    expect(settings.get("t.mode")).toBe("a");
    settings.setHostDefault("t.flag", true, "This app starts with it on.");
    expect(settings.get("t.flag")).toBe(true);
    expect(badge("t.flag").hidden).toBe(true);
    settings.set("t.flag", false);
    expect(badge("t.flag").hidden).toBe(false);
    badge("t.flag").click();
    expect(settings.get("t.flag")).toBe(true);
    section.destroy();
  });

  it("stays hidden for a value the app forces or one that is read-only", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    settings.register([...specs, { ...base, id: "t.fixed", label: "Fixed", description: "Read-only.", unit: "none", kind: "boolean", default: false, readOnly: "Measured.", home }]);
    settings.set("t.flag", true);
    const release = settings.force("t.mode", "b", "The renderer needs it.");
    const controls = ["t.flag", "t.mode", "t.fixed"].map(id => createParameterControl(settings, id, document));
    const [flag, mode, fixed] = controls.map(control => control.element.querySelector<HTMLButtonElement>(".foss-earth-parameter__reset")!);
    expect(flag!.hidden).toBe(false);
    expect(mode!.hidden).toBe(true);
    expect(fixed!.hidden).toBe(true);
    release();
    expect(mode!.hidden).toBe(true);
    for (const control of controls) control.destroy();
  });

  it("gives each field paired into a row its own reset", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    const toolbar = { tab: "interface", section: "toolbar", level: "main" } as const;
    settings.register([
      { ...base, id: "t.custom", label: "Priorities", description: "Auto or Custom.", unit: "none", kind: "boolean", booleanControl: "auto-custom", default: false, home: toolbar },
      { ...base, id: "t.visibility", label: "Camera position", description: "Visibility.", unit: "none", kind: "choice", choices: [{ id: "auto", label: "Auto" }, { id: "off", label: "Off" }], default: "auto", home: toolbar },
      { ...base, id: "t.priority", label: "Camera position priority", description: "Lower comes first.", unit: "count", kind: "number", numberControl: "field", bounds: () => ({ min: 0, max: 99 }), step: 1, default: 8, visibleWhen: { id: "t.custom", value: true }, inlineWith: "t.visibility", home: toolbar },
    ]);
    const section = createParameterSection(settings, { tab: "interface", section: "toolbar", document, refresh: readingRefresh });
    document.body.append(section.element);
    const row = section.element.querySelector<HTMLElement>('[data-parameter="t.visibility"]')!;
    const on = (selector: string) => row.querySelector<HTMLButtonElement>(`${selector} > .foss-earth-parameter__reset`)!;
    settings.set("t.custom", true);
    const custom = section.element.querySelector<HTMLButtonElement>('[data-parameter="t.custom"] .foss-earth-two-position-slider > .foss-earth-parameter__reset')!;
    expect(custom.getAttribute("aria-label")).toBe("Reset Priorities to the default: Auto");
    settings.set("t.priority", 3);
    const priority = on(".foss-earth-parameter__inline-field > .foss-earth-parameter__widget");
    expect(priority.hidden).toBe(false);
    expect(on(".foss-earth-parameter__pills").hidden).toBe(true);
    settings.set("t.visibility", "off");
    on(".foss-earth-parameter__pills").click();
    expect(settings.get("t.visibility")).toBe("auto");
    expect(settings.get("t.priority")).toBe(3);
    priority.click();
    expect(settings.get("t.priority")).toBe(8);
    section.destroy();
  });

  it("hands focus to its widget when it hides, and a press leaves focus where it was", async () => {
    const { settings, section, badge } = setup();
    settings.set("t.mode", "b");
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    badge("t.mode").dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    badge("t.mode").focus();
    badge("t.mode").click();
    await Promise.resolve();
    expect(document.activeElement).toBe(section.element.querySelector('[data-parameter="t.mode"] input[value="a"]'));
    section.destroy();
  });

  it("follows the registry by itself on a hand-built widget", () => {
    const settings = createSettingsRegistry({ storage: memoryStorage() });
    settings.register(specs);
    const widget = document.createElement("div");
    const badge = createResetBadge(settings, document, { ids: () => ["t.mode"], label: () => "Reset Mode" });
    widget.append(badge.element);
    settings.set("t.mode", "b");
    expect(badge.element.hidden).toBe(false);
    badge.element.click();
    expect(settings.get("t.mode")).toBe("a");
    expect(badge.element.hidden).toBe(true);
    badge.destroy();
    settings.set("t.mode", "b");
    expect(widget.childElementCount).toBe(0);
  });
});
