import { createTestFeedbackPanel } from "./testFeedbackPanel.js";
import { addressWithoutReport } from "../diagnostics/reportAddress.js";
import { createDiagnosticsSection, type DiagnosticsSource } from "./diagnosticsSection.js";
import { createBugReportPanel, type BugReportPanelOptions } from "./bugReportPanel.js";

let nextReportView = 0;

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
  const reportContent = document.createElement("div");
  reportContent.append(why, section.element, back, bugTitle, bugReport.element);
  page.append(title, reportContent);
  const feedback = options.downloads ? createTestFeedbackPanel({ href: options.href, document, downloads: options.downloads,
    now: options.now, providers: { diagnostics: source.report, startup: () => source.files?.() ?? [] }, secrets: source.reportSecrets }) : null;
  if (feedback) {
    const tabs = document.createElement("div"); tabs.className = "foss-earth-choices";
    tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Report and test");
    const contents = [reportContent, feedback.element];
    const id = `report-test-${++nextReportView}`;
    reportContent.setAttribute("role", "tabpanel"); feedback.element.setAttribute("role", "tabpanel");
    const buttons = ["Report", "Test"].map((name, index) => {
      const button = document.createElement("button"); button.type = "button"; button.textContent = name; button.className = "foss-earth-choice foss-earth-parameter__action";
      button.id = `${id}-tab-${index}`;
      contents[index]!.id = `${id}-panel-${index}`;
      contents[index]!.setAttribute("aria-labelledby", button.id);
      button.setAttribute("aria-controls", contents[index]!.id);
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => {
        contents.forEach((content, position) => { content.hidden = position !== index; });
        buttons.forEach((tab, position) => { tab.setAttribute("aria-selected", String(position === index)); tab.tabIndex = position === index ? 0 : -1; });
      });
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
        buttons[next]!.click(); buttons[next]!.focus();
      });
      tabs.append(button); return button;
    });
    page.insertBefore(tabs, reportContent); page.append(feedback.element); buttons[0]!.click();
  }
  let disposed = false;
  return {
    element: page,
    show() { if (disposed) return; [...section.element.querySelectorAll("button")].find(button => button.textContent === "View report")?.click(); bugReport.show(); },
    destroy() {
      if (disposed) return;
      disposed = true;
      runAll([() => feedback?.destroy(), () => section.destroy(), () => bugReport.destroy(), () => page.remove()]);
    },
  };
}
