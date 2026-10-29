// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviousVisit } from "../diagnostics/sessionTrail.js";
import { createDiagnosticsSection, describeLastVisit, type DiagnosticsSectionHandle } from "./diagnosticsSection.js";

const visit = (ended: PreviousVisit["ended"]): PreviousVisit => ({
  ended,
  record: { version: 1, id: "a", startedAt: 0, app: "", state: "", steps: [{ ms: 42_000, text: "Inside the 360 image northrop-mall" }], closed: ended === "closed", hidden: ended === "hidden" },
});
const settle = async (): Promise<void> => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };
const report = "FOSS Earth report, 2026-10-28T00:00:00.000Z\nRenderer: webgpu\nSettings: all at their defaults.\nErrors nothing handled: none.\nThis visit, oldest first:\nThe visit before: no trail of one on this device.\n";
let section: DiagnosticsSectionHandle | null = null;
afterEach(() => { section?.destroy(); section = null; });
function action(name: string): HTMLButtonElement { return [...section!.element.querySelectorAll("button")].find(button => button.textContent === name)!; }

describe("Settings → Diagnostics shared report caller", () => {
  it("says how the last visit ended", async () => {
    expect(describeLastVisit(null)).toBe("No trail of an earlier visit on this device.");
    section = createDiagnosticsSection({ report: async () => "", previous: async () => visit("unexpected") });
    await settle();
    expect(section.element.querySelector("p")?.textContent).toBe("The last visit stopped without being closed, 42 s after it opened or later; its last step: Inside the 360 image northrop-mall.");
  });
  it("opens shared file tabs without requiring a clipboard", async () => {
    const read = vi.fn(async () => report);
    section = createDiagnosticsSection({ report: read, previous: async () => null });
    expect(read).not.toHaveBeenCalled();
    action("View report").click(); await settle();
    expect(section.element.querySelector('[role=tablist][aria-label="Error report files"]')).not.toBeNull();
    expect(section.element.querySelector("textarea")).toBeNull();
    expect(section.element.querySelector("pre")?.textContent).toContain("index.json");
  });
  it("copies the same redacted report that the shared viewer downloads", async () => {
    const copied: string[] = [];
    section = createDiagnosticsSection({ report: async () => report + "opaque-settings-key\n", previous: async () => null, reportSecrets: () => ["opaque-settings-key"], copy: async text => { copied.push(text); } });
    action("Copy report").click(); await settle();
    expect(copied).toEqual([report + "[redacted]\n"]);
    expect(section.element.querySelector('[role=tablist]')).not.toBeNull();
    expect(section.element.querySelector('[role=status]')?.textContent).toMatch(/^Copied,/);
  });
  it("offers the shared downloads if the clipboard is unavailable", async () => {
    section = createDiagnosticsSection({ report: async () => report, previous: async () => null, copy: () => Promise.reject(new Error("Denied")) });
    action("Copy report").click(); await settle();
    expect(section.element.querySelector('[role=status]')?.textContent).toContain("Download the report files below");
    expect([...section.element.querySelectorAll("a")].some(link => link.textContent === "Download all")).toBe(true);
  });
});
