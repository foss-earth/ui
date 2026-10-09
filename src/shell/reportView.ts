import { addressWithoutReport } from "../diagnostics/reportAddress.js";
import { createDiagnosticsSection, type DiagnosticsSource } from "./diagnosticsSection.js";
import { createBugReportPanel, type BugReportPanelOptions } from "./bugReportPanel.js";

function runAll(actions: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const action of actions) {
    try { action(); } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, "Report view cleanup failed.");
}

/** Report-only presentation; the host decides whether to start its application. */
export function createReportView(source: DiagnosticsSource, options: BugReportPanelOptions & { href: string; document: Document }) {
  const document = options.document;
  const page = document.createElement("main"); page.className = "foss-earth-report-only";
  const title = document.createElement("h1"); title.textContent = "Report";
  const why = document.createElement("p");
  why.textContent = "The address asks for the report only (?report). The report says how the last visit to this page ended and what it had done.";
  const back = document.createElement("a"); back.href = addressWithoutReport(options.href); back.textContent = "Open the app";
  const section = createDiagnosticsSection(source, { document });
  const bugReport = createBugReportPanel(source, options);
  const bugTitle = document.createElement("h2"); bugTitle.textContent = "Bug report";
  page.append(title, why, section.element, back, bugTitle, bugReport.element);
  let disposed = false;
  return {
    element: page,
    show() { if (disposed) return; section.element.querySelector("button")?.click(); bugReport.show(); },
    destroy() {
      if (disposed) return;
      disposed = true;
      runAll([() => section.destroy(), () => bugReport.destroy(), () => page.remove()]);
    },
  };
}
