// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { UI_PARAMETERS as INTERFACE_PARAMETERS } from "../../settings/uiParameters.js";
import { createSettingsRegistry } from "../../settings/registry.js";
import { createParameterSection as createInjectedParameterSection, type ParameterSectionOptions } from "./parameterSection.js";
import { createThemeControl } from "./themeControl.js";

import { testReadingRefresh } from "../../../tests/fixtures/readingRefresh.js";
const readingRefresh = testReadingRefresh();
const createParameterSection = (settings: Parameters<typeof createInjectedParameterSection>[0], options: Omit<ParameterSectionOptions, "refresh" | "document">) => createInjectedParameterSection(settings, { ...options, document, refresh: readingRefresh });
afterEach(() => { readingRefresh.dispose(); document.body.replaceChildren(); });

function setup() {
  const settings = createSettingsRegistry({ storage: null });
  settings.register(INTERFACE_PARAMETERS);
  const control = createThemeControl(settings, document);
  document.body.append(control.element);
  const choose = (theme: "light" | "auto" | "dark") => {
    control.element.querySelector<HTMLInputElement>(`input[value="${theme}"]`)!.click();
  };
  return { settings, control, choose };
}

describe("Interface theme control", () => {
  it("shows one Light, Auto and Dark switch and changes the same setting", () => {
    const { settings, control, choose } = setup();
    const options = [...control.element.querySelectorAll<HTMLLabelElement>(".foss-earth-parameter__pills label")];
    expect(options.map(option => option.textContent)).toEqual(["", "A", ""]);
    expect(options.map(option => Boolean(option.querySelector("svg.foss-earth-choice__icon")))).toEqual([true, false, true]);
    expect(options.map(option => option.querySelector("input")!.getAttribute("aria-label"))).toEqual(["Light", "Auto", "Dark"]);
    expect(options.map(option => option.title)).toEqual(["Light", "Auto: Follow this device's light or dark appearance.", "Dark"]);
    expect(control.element.classList.contains("foss-earth-parameter--compact-choice")).toBe(true);
    expect(control.element.querySelectorAll('input[type="range"], input[type="checkbox"]')).toHaveLength(0);
    expect(control.element.getAttribute("role")).toBe("radiogroup");
    expect(control.element.getAttribute("aria-label")).toBe("Theme");
    expect(control.element.querySelector<HTMLInputElement>('input[value="dark"]')!.checked).toBe(true);
    choose("light");
    expect(settings.get("interface.theme")).toBe("light");
    expect(control.element.querySelector<HTMLInputElement>('input[value="light"]')!.checked).toBe(true);
    choose("auto");
    expect(settings.get("interface.theme")).toBe("auto");
    settings.set("interface.theme", "dark");
    expect(control.element.querySelector<HTMLInputElement>('input[value="dark"]')!.checked).toBe(true);
    control.destroy();
  });

  it("respects a host-forced theme and follows it when released", () => {
    const { settings, control, choose } = setup();
    const releaseCurrent = settings.force("interface.theme", "dark", "keep the current theme");
    expect(control.element.querySelector("input")!.disabled).toBe(true);
    expect(control.element.textContent).toContain("Set by the app: keep the current theme.");
    choose("light");
    expect(settings.get("interface.theme")).toBe("dark");
    releaseCurrent();
    expect(control.element.querySelector("input")!.disabled).toBe(false);
    const release = settings.force("interface.theme", "light", "the host needs it");
    expect(control.element.querySelector<HTMLInputElement>('input[value="light"]')!.checked).toBe(true);
    expect(control.element.querySelector("input")!.disabled).toBe(true);
    expect(control.element.textContent).toContain("Set by the app: the host needs it.");
    release();
    expect(control.element.querySelector("input")!.disabled).toBe(false);
    expect(control.element.querySelector<HTMLInputElement>('input[value="dark"]')!.checked).toBe(true);
    control.destroy();
    settings.set("interface.theme", "light");
    expect(control.element.querySelector<HTMLInputElement>('input[value="dark"]')!.checked).toBe(true);
    choose("dark");
    expect(settings.get("interface.theme")).toBe("light");
  });

  it("has one visible home above the Interface toolbar section", () => {
    const { settings, control } = setup();
    const theme = createParameterSection(settings, {
      tab: "interface",
      section: "theme",
      main: control.element,
      covers: ["interface.theme"],
    });
    const toolbar = createParameterSection(settings, { tab: "interface", section: "toolbar" });
    document.body.append(theme.element, toolbar.element);
    expect(theme.element.querySelectorAll('[data-parameter="interface.theme"]')).toHaveLength(1);
    expect(toolbar.element.querySelectorAll('[data-parameter="interface.theme"]')).toHaveLength(0);
    theme.destroy();
    toolbar.destroy();
    control.destroy();
  });

  it("does not repeat the theme switch when every parameter is already shown", () => {
    const { settings, control } = setup();
    const section = createParameterSection(settings, {
      tab: "interface",
      section: "theme",
      main: control.element,
      covers: ["interface.theme"],
    });
    document.body.append(section.element);
    expect(section.element.querySelector(".foss-earth-parameter-section__toggle")).toBeNull();
    expect(section.element.querySelector(".foss-earth-parameter-list")).toBeNull();
    expect(section.element.querySelectorAll('[data-parameter="interface.theme"]')).toHaveLength(1);
    section.element.querySelector<HTMLInputElement>('input[value="light"]')!.click();
    expect(settings.get("interface.theme")).toBe("light");
    expect(control.element.querySelector<HTMLInputElement>('input[value="light"]')!.checked).toBe(true);
    settings.set("interface.theme", "dark");
    expect(control.element.querySelector<HTMLInputElement>('input[value="dark"]')!.checked).toBe(true);
    section.destroy();
    control.destroy();
  });
});
