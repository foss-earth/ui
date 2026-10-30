// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createTestLink, type TestPlan } from "../diagnostics/testFeedback.js";
import { createTestFeedbackPanel, type TestFeedbackPanel } from "./testFeedbackPanel.js";

let panel: TestFeedbackPanel | null = null;
afterEach(() => { panel?.destroy(); panel = null; document.body.replaceChildren(); });
const plan: TestPlan = { version: 1, id: "try", title: "Try dragging", steps: [{ id: "drag", text: "Drag gently" }], sources: ["diagnostics"] };
const settle = async (): Promise<void> => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

it("supports the complete Start → thoughts/result → Finish → reviewed JSON download flow", async () => {
  const create = vi.fn(() => "blob:feedback"); const revoke = vi.fn();
  panel = createTestFeedbackPanel({ document, href: createTestLink("https://example.org/", plan), now: () => new Date(), providers: { diagnostics: () => "Build: test\nGPU: fixture" }, downloads: { create, revoke } });
  document.body.append(panel!.element);
  const action = (label: string): HTMLButtonElement => [...panel!.element.querySelectorAll("button")].find(b => b.textContent === label)!;
  action("Start").click(); await settle();
  const thoughts = panel!.element.querySelector<HTMLTextAreaElement>('[aria-label="Thoughts: Drag gently"]')!;
  thoughts.value = "The camera jumps";
  const fail = panel!.element.querySelector<HTMLInputElement>('input[value="fail"]')!;
  fail.click(); await settle();
  action("Finish").click(); await settle();
  const preview = panel!.element.querySelector<HTMLTextAreaElement>('[aria-label="Review feedback JSON"]')!;
  const bundle = JSON.parse(preview.value);
  expect(bundle.steps[0]).toMatchObject({ outcome: "fail", notes: "The camera jumps" });
  expect(bundle.samples.some((s: { value: string }) => s.value.includes("GPU: fixture"))).toBe(true);
  const download = panel!.element.querySelector<HTMLAnchorElement>('a[download]')!;
  expect(download.download).toBe("test-try-feedback.json");
  expect(create).toHaveBeenCalledOnce();
  preview.value = "invalid JSON"; preview.dispatchEvent(new Event("input"));
  expect(download.hidden).toBe(true);
  expect(revoke).toHaveBeenCalledWith("blob:feedback");
});

it("opens the checklist a short link's dev server put into the page, and explains a missing one", () => {
  const options = { document, now: () => new Date(), providers: { diagnostics: () => "" }, downloads: { create: vi.fn(), revoke: vi.fn() } };
  const element = document.createElement("script");
  element.type = "application/json"; element.id = "foss-earth-test-plan"; element.dataset.name = "try";
  element.textContent = JSON.stringify(plan).replace(/</g, "\\u003c");
  document.head.append(element);
  try {
    panel = createTestFeedbackPanel({ ...options, href: "https://localhost:7470/fly/?renderer=webgl2&test=try" });
    expect(panel!.element.querySelector("h3")!.textContent).toBe("Try dragging");
    expect(panel!.session).not.toBeNull();
    panel!.destroy();
    // Another page's checklist is not this link's.
    panel = createTestFeedbackPanel({ ...options, href: "https://localhost:7470/fly/?test=other" });
    expect(panel!.element.textContent).toContain('No test checklist named "other"');
    expect(panel!.element.textContent).toContain("build/test-plans/other.json");
    expect(panel!.session).toBeNull();
    panel!.destroy();
    panel = createTestFeedbackPanel({ ...options, href: "https://localhost:7470/fly/?test=../other" });
    expect(panel!.element.textContent).toContain("invalid");
  } finally { element.remove(); }
});

it("leaves ordinary visits inactive and displays malformed test links as errors", () => {
  const options = { document, now: () => new Date(), providers: {}, downloads: { create: vi.fn(), revoke: vi.fn() } };
  expect(createTestFeedbackPanel({ ...options, href: "https://example.org/" })).toBeNull();
  panel = createTestFeedbackPanel({ ...options, href: "https://example.org/#test=%zz" });
  expect(panel!.element.textContent).toContain("invalid");
  expect(panel!.session).toBeNull();
  expect(options.downloads.create).not.toHaveBeenCalled();
});
