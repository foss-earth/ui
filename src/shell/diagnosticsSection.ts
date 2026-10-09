import { describePreviousVisit, type PreviousVisit } from "../diagnostics/sessionTrail.js";

export interface DiagnosticsSectionHandle {
  element: HTMLElement;
  destroy(): void;
}

export interface DiagnosticsSource {
  /** The report as text (src/diagnostics/report.ts). */
  report(): Promise<string>;
  previous(): Promise<PreviousVisit | null>;
  /** Puts text on the clipboard; rejects where the browser does not allow it. */
  copy?(text: string): Promise<void>;
  /** Secrets known to the host, redacted even when an error or activity repeats them. */
  reportSecrets?(): readonly string[];
}

function paragraph(document: Document, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = "foss-earth-choices__note";
  element.textContent = text;
  return element;
}

const size = (text: string): string => `${(new Blob([text]).size / 1024).toFixed(1)} KB`;

/** What the section says of the visit before this one. */
export function describeLastVisit(previous: PreviousVisit | null): string {
  if (!previous) return "No trail of an earlier visit on this device.";
  return `${describePreviousVisit(previous)}.`;
}

/**
 * Settings → Diagnostics: how the last visit ended, and the report to copy
 * when something went wrong, beside the parameters of the trail it is made
 * from (diagnostics.*). The report is shown as it is copied, so a person sees
 * what they are about to pass on.
 */
export function createDiagnosticsSection(source: DiagnosticsSource, options: { reportOnlyHref?: string; document?: Document } = {}): DiagnosticsSectionHandle {
  const document = options.document ?? globalThis.document;
  const element = document.createElement("div");
  element.className = "foss-earth-status-section foss-earth-diagnostics-section";
  element.setAttribute("aria-label", "Diagnostics");
  const last = paragraph(document, "Reading the last visit's trail…");
  const how = paragraph(document, "The report says what ran, on what, how it is set, and what this visit and the one before it did. It is made on this device and sent nowhere: copy it to whoever is looking into a fault. Keys are left out of it.");
  if (options.reportOnlyHref) { const link = document.createElement("a"); link.href = options.reportOnlyHref; link.textContent = "Open the report-only page"; how.append(" ", link); }
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "foss-earth-choice foss-earth-parameter__action";
  copyButton.textContent = "Copy report";
  const status = paragraph(document, "");
  status.setAttribute("role", "status");
  status.hidden = true;
  // The settings transfer's text box: the same monospace text to select and copy.
  const text = document.createElement("textarea");
  text.className = "foss-earth-settings-transfer__text";
  text.readOnly = true;
  text.rows = 12;
  text.hidden = true;
  text.setAttribute("aria-label", "The report");
  element.append(last, copyButton, how, status, text);

  let disposed = false;
  void Promise.resolve().then(() => disposed ? null : source.previous()).then(previous => {
    if (!disposed) last.textContent = describeLastVisit(previous);
  }, () => {
    if (!disposed) last.textContent = "Could not read the last visit's trail.";
  });

  const copy = source.copy ?? (() => Promise.reject(new Error("No clipboard port")));
  const onCopy = (): void => {
    if (disposed || copyButton.disabled) return;
    copyButton.disabled = true;
    void Promise.resolve().then(() => disposed ? "" : source.report()).then(async report => {
      if (disposed) return;
      text.value = report;
      text.hidden = false;
      status.hidden = false;
      try {
        await copy(report);
        if (!disposed) status.textContent = `Copied, ${size(report)}: paste it where you are reporting the fault. It is shown below.`;
      } catch {
        if (disposed) return;
        // Where the browser gives no clipboard, as on a page not served over https: the text is there to select.
        status.textContent = `The browser did not let the page copy it. Select the text below, ${size(report)}, and copy it.`;
        text.focus();
        text.select();
      }
    }, () => {
      if (disposed) return;
      status.hidden = false;
      status.textContent = "The report could not be made. Try Copy report again.";
    }).finally(() => { if (!disposed) copyButton.disabled = false; });
  };
  copyButton.addEventListener("click", onCopy);

  return {
    element,
    destroy() {
      if (disposed) return;
      disposed = true;
      copyButton.removeEventListener("click", onCopy);
      text.value = "";
      element.remove();
    },
  };
}
