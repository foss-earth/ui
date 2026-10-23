import { createTestFeedbackSession, readTestPlan, type TestFeedbackOptions, type TestFeedbackSession, type TestOutcome } from "../diagnostics/testFeedback.js";
import { redactIssueReport } from "../diagnostics/issueReport.js";
import { createChoiceGroup, checkChoice } from "./choiceGroup.js";
import { createHelpTooltip } from "./helpTooltip.js";

export interface TestFeedbackPanel {
  element: HTMLElement;
  session: TestFeedbackSession | null;
  destroy(): void;
}
export interface TestFeedbackPanelOptions extends Omit<TestFeedbackOptions, "plan" | "page"> {
  href: string;
  document: Document;
  downloads: { create(blob: Blob): string; revoke(url: string): void };
}

/** Returns null for ordinary visits; an invalid test link produces an actionable error tab. */
export function createTestFeedbackPanel(options: TestFeedbackPanelOptions): TestFeedbackPanel | null {
  const { document } = options;
  let plan;
  let failure = "";
  try { plan = readTestPlan(options.href); }
  catch { failure = "This test link is invalid. Ask the agent for a new link."; }
  if (!plan && !failure) return null;
  const element = document.createElement("div");
  element.className = "foss-earth-test-feedback";
  element.setAttribute("aria-label", "Test feedback");
  const paragraph = (message: string): HTMLParagraphElement => {
    const p = document.createElement("p"); p.className = "foss-earth-choices__note"; p.textContent = message; return p;
  };
  if (!plan) {
    element.append(paragraph(failure));
    return { element, session: null, destroy() { element.remove(); } };
  }
  const session = createTestFeedbackSession({ ...options, plan, page: options.href });
  const heading = document.createElement("h3"); heading.textContent = plan.title;
  element.append(heading);
  if (plan.instructions) element.append(paragraph(plan.instructions));
  const unavailable = plan.sources.filter(source => !Object.hasOwn(options.providers, source));
  const status = paragraph(unavailable.length
    ? `Unavailable data: ${unavailable.join(", ")}. Ask the agent to check the build, or continue with these gaps recorded.`
    : "Press Start, follow the steps, then finish and download your feedback.");
  status.setAttribute("role", "status");
  const actions = document.createElement("div"); actions.className = "foss-earth-choices";
  const button = (label: string): HTMLButtonElement => {
    const b = document.createElement("button"); b.type = "button"; b.className = "foss-earth-choice foss-earth-parameter__action"; b.textContent = label; return b;
  };
  const start = button("Start");
  const finish = button("Finish"); finish.disabled = true;
  const download = document.createElement("a");
  download.className = "foss-earth-choice foss-earth-parameter__action"; download.textContent = "Download feedback"; download.hidden = true;
  const helpContent = document.createElement("div");
  helpContent.append(paragraph(`Selected data: ${plan.sources.join(", ") || "none"}.${plan.intervalMs ? ` Samples every ${plan.intervalMs / 1000} s while the test runs.` : " Captured at Start, results, notes and Finish."} The file includes your checklist, notes, timestamps and diagnostics. Review it before sharing; nothing is uploaded.`));
  const help = createHelpTooltip({ label: "Explain test data", content: helpContent });
  actions.append(start, finish, download, help.element);
  element.append(status, actions);
  const fields: { id: string; notes: HTMLTextAreaElement; group: HTMLElement }[] = [];
  for (const step of plan.steps) {
    const card = document.createElement("section"); card.className = "foss-earth-test-feedback__step";
    const group = createChoiceGroup(`test-${plan.id}-${step.id}`, step.text,
      [{ id: "untested", label: "Untested" }, { id: "pass", label: "Pass" }, { id: "fail", label: "Fail" }, { id: "skip", label: "Skip" }], document);
    checkChoice(group, `test-${plan.id}-${step.id}`, "untested");
    const label = document.createElement("label"); label.className = "foss-earth-bug-report__field"; label.textContent = "Thoughts";
    const notes = document.createElement("textarea"); notes.className = "foss-earth-parameter__text"; notes.rows = 2; notes.maxLength = 20_000;
    notes.setAttribute("aria-label", `Thoughts: ${step.text}`); notes.placeholder = "What you noticed";
    label.append(notes); card.append(group, label); element.append(card);
    fields.push({ id: step.id, notes, group });
  }
  const noteLabel = document.createElement("label"); noteLabel.className = "foss-earth-bug-report__field"; noteLabel.textContent = "Other thoughts";
  const note = document.createElement("textarea"); note.className = "foss-earth-parameter__text"; note.rows = 3; note.maxLength = 20_000; note.placeholder = "Anything else, including when something felt wrong";
  noteLabel.append(note);
  const mark = button("Save note"); mark.disabled = true;
  const noteStatus = paragraph(""); noteStatus.setAttribute("role", "status");
  const previewLabel = document.createElement("label"); previewLabel.className = "foss-earth-bug-report__field"; previewLabel.textContent = "Review file"; previewLabel.hidden = true;
  const preview = document.createElement("textarea"); preview.className = "foss-earth-parameter__text"; preview.rows = 10; preview.spellcheck = false; preview.setAttribute("aria-label", "Review feedback JSON");
  previewLabel.append(preview); element.append(noteLabel, mark, noteStatus, previewLabel);
  let disposed = false, objectUrl: string | null = null, finished = false;
  const listeners: (() => void)[] = [];
  const listen = (target: HTMLElement, name: string, fn: () => void): void => {
    target.addEventListener(name, fn); listeners.push(() => target.removeEventListener(name, fn));
  };
  const lock = (disabled: boolean): void => {
    for (const input of element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) input.disabled = disabled;
  };
  lock(true);
  const saveNote = (): void => {
    if (!note.value.trim()) return;
    session.note(note.value); note.value = ""; noteStatus.textContent = "Note saved with the current test data.";
  };
  listen(start, "click", () => {
    session.start(); start.disabled = true; finish.disabled = false; mark.disabled = false; lock(false);
    status.textContent = "Test running. Record a result and your thoughts for each step.";
  });
  for (const field of fields) {
    const update = (): void => {
      const outcome = field.group.querySelector<HTMLInputElement>("input:checked")?.value as TestOutcome ?? "untested";
      session.setStep(field.id, outcome, field.notes.value);
    };
    listen(field.group, "change", update);
    // Store edits immediately; capture only on result changes, saved notes and Finish.
    listen(field.notes, "change", update);
  }
  listen(mark, "click", saveNote);
  const release = (): void => { if (objectUrl) options.downloads.revoke(objectUrl); objectUrl = null; download.removeAttribute("href"); download.hidden = true; };
  const prepareDownload = (): void => {
    release();
    try {
      JSON.parse(preview.value);
      objectUrl = options.downloads.create(new Blob([preview.value], { type: "application/json;charset=utf-8" }));
      download.href = objectUrl; download.download = `test-${plan.id}-feedback.json`; download.hidden = false;
    } catch { status.textContent = "The file must contain valid JSON before it can be downloaded. Correct the review text or finish again."; }
  };
  listen(finish, "click", () => {
    if (!finished) {
      for (const f of fields) session.setStep(f.id, f.group.querySelector<HTMLInputElement>("input:checked")?.value as TestOutcome ?? "untested", f.notes.value);
      saveNote();
    }
    finish.disabled = true; mark.disabled = true; lock(true); status.textContent = "Preparing your feedback…";
    void session.finish().then(bundle => {
      if (disposed) return;
      finished = true;
      preview.value = JSON.stringify(bundle, null, 2);
      previewLabel.hidden = false; preview.disabled = false;
      const failures = bundle.samples.filter(sample => sample.error).length;
      status.textContent = `Ready. Review and download the file, then give it to the agent.${failures ? ` ${failures} diagnostic captures failed; the file records the errors.` : ""}${bundle.limits.droppedSamples || bundle.limits.shortenedValues ? " Some diagnostic data reached the capture limits; the file records the counts." : ""}`;
      prepareDownload();
    }).catch(() => { if (!disposed) status.textContent = "Could not prepare feedback. Your notes are still here. Try Finish again."; })
      .finally(() => { if (!disposed) finish.disabled = false; });
  });
  listen(preview, "input", () => {
    // Apply host-secret redaction again after manual review, without rewriting JSON structure.
    const secrets = options.secrets?.() ?? [];
    for (const secret of secrets) if (secret) preview.value = preview.value.split(secret).join("[redacted]");
    prepareDownload();
  });
  listen(download, "click", () => { status.textContent = "Download requested. Give the feedback file to the agent."; });
  // The session handles structured data. Redact selected metadata as well as diagnostic strings.
  heading.textContent = redactIssueReport(plan.title, options.secrets?.());
  return { element, session, destroy() {
    if (disposed) return;
    disposed = true; session.dispose(); release(); listeners.forEach(off => off()); help.destroy(); element.remove();
  } };
}
