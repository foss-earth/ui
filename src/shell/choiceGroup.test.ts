// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { checkChoice, createChoiceGroup } from "./choiceGroup.js";

afterEach(() => document.body.replaceChildren());

it("keeps mutually exclusive choices in one shared compact track with accessible native radios", () => {
  const group = createChoiceGroup("mode", "Mode", [{ id: "global", label: "Global" }, { id: "auto", label: "Auto" }, { id: "manual", label: "Manual" }], document);
  document.body.append(group);
  expect(group.getAttribute("role")).toBe("radiogroup");
  expect(group.getAttribute("aria-label")).toBe("Mode");
  const track = group.querySelector(".foss-earth-parameter__pills")!;
  expect(track.querySelectorAll("label")).toHaveLength(3);
  expect(group.querySelectorAll(":scope > label")).toHaveLength(0);
  const radios = [...track.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  expect(radios.every(input => input.name === "mode" && !input.hidden && input.tabIndex === 0)).toBe(true);
  checkChoice(group, "mode", "auto");
  expect(radios.filter(input => input.checked).map(input => input.value)).toEqual(["auto"]);
  radios[2]!.click();
  radios[2]!.focus();
  expect(document.activeElement).toBe(radios[2]);
  expect(radios.filter(input => input.checked).map(input => input.value)).toEqual(["manual"]);
});

it("preserves credit links, disabled options and other groups when selection changes", () => {
  const group = createChoiceGroup("one", "Source", [{ id: "a", label: "A", creditUrl: "https://example.test/credit" }, { id: "b", label: "B" }], document);
  const other = createChoiceGroup("two", "Other", [{ id: "a", label: "A" }], document);
  document.body.append(group, other);
  const credit = group.querySelector<HTMLAnchorElement>("a")!;
  checkChoice(group, "one", "a"); checkChoice(other, "two", "a");
  expect(credit.hidden).toBe(false);
  expect(credit.href).toBe("https://example.test/credit");
  checkChoice(group, "one", "b");
  expect(credit.hidden).toBe(true);
  expect(other.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
  const disabled = group.querySelector<HTMLInputElement>('input[value="a"]')!;
  disabled.disabled = true; disabled.click();
  expect(group.querySelector<HTMLInputElement>('input[value="b"]')!.checked).toBe(true);
});

it("keeps the title first, then the segments, any status, and help last", () => {
  const status = document.createElement("span");
  status.textContent = "WebGL2 running";
  const group = createChoiceGroup("backend", "Renderer", [{ id: "auto", label: "Auto-detect", shortLabel: "Auto" }, { id: "webgl2", label: "WebGL2" }], document, { help: "Which graphics backend draws the globe.", status });
  document.body.append(group);
  expect([...group.children].map(child => child.classList[0])).toEqual(["foss-earth-choices__heading", "foss-earth-parameter__pills", "foss-earth-choice-group__status", "foss-earth-help-tooltip"]);
  expect(group.lastElementChild!.querySelector("button")!.getAttribute("aria-label")).toBe("Explain Renderer");
  // The short label is visible while the full one stays the accessible name.
  const auto = group.querySelector<HTMLInputElement>('input[value="auto"]')!;
  expect(auto.parentElement!.textContent).toBe("Auto");
  expect(auto.getAttribute("aria-label")).toBe("Auto-detect");
});

it("leaves the visible title out when asked, keeping it as the accessible name", () => {
  const group = createChoiceGroup("backend", "Renderer", [{ id: "a", label: "A" }], document, { hideHeading: true });
  expect(group.querySelector(".foss-earth-choices__heading")).toBeNull();
  expect(group.getAttribute("aria-label")).toBe("Renderer");
  expect(group.firstElementChild!.classList.contains("foss-earth-parameter__pills")).toBe(true);
});
