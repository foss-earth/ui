import { createIssueReportView } from "../diagnostics/issueReportView.js";
import { redactIssueReport, type IssueFile } from "../diagnostics/issueReport.js";
import { describePreviousVisit, type PreviousVisit } from "../diagnostics/sessionTrail.js";
import { createExternalLinkIcon } from "./externalLinkIcon.js";
import { createHelpTooltip } from "./helpTooltip.js";

export interface DiagnosticsSectionHandle {
  element: HTMLElement;
  destroy(): void;
}

export interface DiagnosticsSource {
  /** The report as text (src/diagnostics/report.ts). */
  report(): Promise<string>;
  files?(): readonly IssueFile[];
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
 * from (diagnostics.*). The shared viewer opens the same report as files.
 */
export function createDiagnosticsSection(source: DiagnosticsSource, options: { reportOnlyHref?: string; document?: Document; downloads?: { create(blob: Blob): string; revoke(url: string): void } } = {}): DiagnosticsSectionHandle {
  const document = options.document ?? globalThis.document;
  const element = document.createElement("div");
  element.className = "foss-earth-status-section foss-earth-diagnostics-section";
  element.setAttribute("aria-label", "Diagnostics");
  const last = paragraph(document, "Reading the last visit's trail…");
  // What the report holds and where it goes, behind ? beside the action.
  const how = document.createElement("p");
  how.textContent = "The report says what ran, on what, how it is set, and what this visit and the one before it did. It is made on this device and sent nowhere: copy it to whoever is looking into a fault. Keys are left out of it.";
  if (options.reportOnlyHref) {
    const link = document.createElement("a");
    link.href = options.reportOnlyHref;
    link.textContent = "Report-only page";
    link.append(" ", createExternalLinkIcon(document));
    how.append(" ", link);
  }
  const helpContent = document.createElement("div");
  helpContent.append(how);
  const help = createHelpTooltip({ label: "Explain the report", content: helpContent });
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "foss-earth-choice foss-earth-parameter__action";
  copyButton.textContent = "Copy report";
  const viewButton = document.createElement("button");
  viewButton.type = "button";
  viewButton.className = "foss-earth-choice foss-earth-parameter__action";
  viewButton.textContent = "View report";
  const actions = document.createElement("div");
  actions.className = "foss-earth-choices";
  actions.append(viewButton, copyButton, help.element);
  const status = paragraph(document, "");
  status.setAttribute("role", "status");
  status.hidden = true;
  const reportHost = document.createElement("div");
  element.append(last, actions, status, reportHost);
  let viewer: ReturnType<typeof createIssueReportView> | null = null;

  let disposed = false;
  void Promise.resolve().then(() => disposed ? null : source.previous()).then(previous => {
    if (!disposed) last.textContent = describeLastVisit(previous);
  }, () => {
    if (!disposed) last.textContent = "Could not read the last visit's trail.";
  });

  const copy = source.copy ?? (() => Promise.reject(new Error("No clipboard port")));
  const prepare = (shouldCopy: boolean): void => {
    if (disposed || copyButton.disabled) return;
    copyButton.disabled = true;
    viewButton.disabled = true;
    status.hidden = false;
    status.textContent = "Preparing the report on this device…";
    void Promise.resolve().then(() => disposed ? "" : source.report()).then(async raw => {
      if (disposed) return;
      const report = redactIssueReport(raw, source.reportSecrets?.());
      if (viewer) viewer.setReport(report);
      else {
        viewer = createIssueReportView(report, { document, downloads: options.downloads, copy, additionalFiles: () => (source.files?.() ?? []).map(file => ({ ...file, text: redactIssueReport(file.text, source.reportSecrets?.()) })) });
        reportHost.append(viewer.element);
      }
      status.textContent = "Review the report files below.";
      if (!shouldCopy) return;
      try {
        await copy(report);
        if (!disposed) status.textContent = `Copied, ${size(report)}: paste it where you are reporting the fault. Review the files below.`;
      } catch {
        if (!disposed) status.textContent = "The browser did not let the page copy it. Download the report files below.";
      }
    }, () => {
      if (disposed) return;
      status.textContent = "The report could not be made. Try View report again.";
    }).finally(() => {
      if (disposed) return;
      copyButton.disabled = false;
      viewButton.disabled = false;
    });
  };
  const onCopy = (): void => prepare(true);
  const onView = (): void => prepare(false);
  copyButton.addEventListener("click", onCopy);
  viewButton.addEventListener("click", onView);

  return {
    element,
    destroy() {
      if (disposed) return;
      disposed = true;
      copyButton.removeEventListener("click", onCopy);
      viewButton.removeEventListener("click", onView);
      viewer?.destroy();
      viewer = null;
      help.destroy();
      element.remove();
    },
  };
}
