// @vitest-environment jsdom
import { expect, it } from "vitest";
import { ACTION_ICONS, createIconButton, setIconButtonLabel } from "./iconButton.js";

it("draws a familiar action as an icon with its full accessible name and hover title", () => {
  const copy = createIconButton(document, { icon: "copy", label: "Copy the settings" });
  expect(copy.tagName).toBe("BUTTON");
  expect(copy.type).toBe("button");
  expect(copy.getAttribute("aria-label")).toBe("Copy the settings");
  expect(copy.title).toBe("Copy the settings");
  expect(copy.textContent).toBe("");
  const svg = copy.querySelector("svg")!;
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("focusable")).toBe("false");
  setIconButtonLabel(copy, "Copied");
  expect(copy.getAttribute("aria-label")).toBe("Copied");
  expect(copy.title).toBe("Copied");
});

it("makes a link for downloads and other pages", () => {
  const link = createIconButton(document, { icon: "download", label: "Download report", tag: "a" });
  expect(link.tagName).toBe("A");
  expect(link.hasAttribute("type")).toBe(false);
  expect(link.getAttribute("aria-label")).toBe("Download report");
});

it("draws every icon it offers", () => {
  for (const icon of ACTION_ICONS) expect(createIconButton(document, { icon, label: icon }).querySelectorAll("svg path").length).toBeGreaterThan(0);
});
