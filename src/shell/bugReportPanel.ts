import { createIssueDraft, issueReportAttachment, issueReportFilename, redactIssueReport, validateIssueReporterConfig, type IssueReporterConfig } from "../diagnostics/issueReport.js";
import { createIssueReportView } from "../diagnostics/issueReportView.js";
import type { DiagnosticsSource } from "./diagnosticsSection.js";
import { createExternalLinkIcon } from "./externalLinkIcon.js";
import { createHelpTooltip } from "./helpTooltip.js";
import { createIconButton, setIconButtonLabel } from "./iconButton.js";

export interface BugReportPanelHandle {
  element: HTMLElement;
  /** Prepare on first opening; preserve edits on later openings until Refresh. */
  show(): void;
  destroy(): void;
}

export interface BugReportPanelOptions {
  document?: Document;
  issueReporter?: IssueReporterConfig;
  now(): Date;
  downloads?: { create(blob: Blob): string; revoke(url: string): void };
}

function paragraph(document: Document, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = "foss-earth-choices__note";
  element.textContent = text;
  return element;
}

/** A dedicated Bug report tab: local review and download, then a short GitHub draft. */
export function createBugReportPanel(source: DiagnosticsSource, options: BugReportPanelOptions): BugReportPanelHandle {
  const document = options.document ?? globalThis.document;
  let disposed = false;
  let config: IssueReporterConfig | undefined;
  let configurationNote = "The GitHub issue repository is not configured.";
  if (options.issueReporter) {
    try { config = validateIssueReporterConfig(options.issueReporter); }
    catch (error) { configurationNote = `GitHub reporting is unavailable: ${error instanceof Error ? error.message : "Check the issue repository configuration."}`; }
  }
  const copy = source.copy ?? (() => Promise.reject(new Error("No clipboard port")));
  const panel = document.createElement("div");
  panel.className = "foss-earth-status-section foss-earth-choices foss-earth-bug-report-panel";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Bug report");
  if (!config) panel.append(paragraph(document, `${configurationNote} You can still download a report for the app maintainer.`));
  const titleLabel = document.createElement("label");
  titleLabel.className = "foss-earth-bug-report__field";
  titleLabel.textContent = "Issue title";
  const title = document.createElement("input");
  title.className = "foss-earth-parameter__text";
  title.type = "text";
  title.name = "title";
  title.maxLength = 200;
  title.required = true;
  title.placeholder = "A short summary of the problem";
  titleLabel.append(title);
  const descriptionLabel = document.createElement("label");
  descriptionLabel.className = "foss-earth-bug-report__field";
  descriptionLabel.textContent = "What happened?";
  const description = document.createElement("textarea");
  description.className = "foss-earth-parameter__text";
  description.name = "description";
  description.rows = 3;
  description.required = true;
  description.placeholder = "What you did, what you expected, and what went wrong";
  descriptionLabel.append(description);
  // What someone must see before continuing stays visible; the rest is behind ?.
  const review = paragraph(document, "Review the report before sharing it. GitHub attachments become public when uploaded. ");
  const reviewHelp = document.createElement("div");
  const reviewText = document.createElement("p");
  reviewText.textContent = "Known keys, recognized secrets, email addresses, coordinates and URL queries are removed automatically. Review the files, then download all as a zip and attach it to the GitHub issue. Submit publishes the issue. The draft contains a short summary; the zip keeps the full report.";
  reviewHelp.append(reviewText);
  const reviewTooltip = createHelpTooltip({ label: "Explain the bug report", content: reviewHelp });
  review.append(reviewTooltip.element);
  const reportHost = document.createElement("div");
  const result = paragraph(document, "");
  result.setAttribute("role", "status");
  const open = document.createElement("a");
  open.className = "foss-earth-choice foss-earth-parameter__action";
  open.append("GitHub issue ", createExternalLinkIcon(document));
  open.setAttribute("aria-label", "Open GitHub issue");
  open.title = "Open GitHub issue, in a new tab";
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.setAttribute("aria-disabled", "true");
  const copyReviewed = createIconButton(document, { icon: "copy", label: "Copy reviewed report" });
  copyReviewed.disabled = true;
  const refresh = createIconButton(document, { icon: "refresh", label: "Refresh report" });
  panel.append(titleLabel, descriptionLabel, review, reportHost, result, open, copyReviewed, refresh);

  let generation = 0;
  let ready = false;
  let filename = "";
  let report = "";
  let attachment = "";
  let viewer: ReturnType<typeof createIssueReportView> | null = null;
  let downloadedAttachment: string | null = null;
  let copiedAttachment: string | null = null;
  const disableOpen = (): void => {
    open.removeAttribute("href");
    open.setAttribute("aria-disabled", "true");
  };
  const updateLinks = (): boolean => {
    if (disposed || !ready) return false;
    const secrets = source.reportSecrets?.();
    title.value = redactIssueReport(title.value, secrets);
    description.value = redactIssueReport(description.value, secrets);
    const snapshot = { title: title.value, description: description.value, report, filename };
    const nextAttachment = issueReportAttachment(config, snapshot);
    if (nextAttachment !== attachment) {
      attachment = nextAttachment;
      viewer?.setReport(attachment);
    }
    copyReviewed.disabled = !title.value.trim() || !description.value.trim();
    if (copyReviewed.disabled) {
      disableOpen();
      result.textContent = "Add an issue title and describe what happened, then download all report files.";
      return false;
    }
    const transferred = downloadedAttachment === attachment || copiedAttachment === attachment;
    if (transferred && config) {
      open.href = createIssueDraft(config, snapshot).url;
      open.setAttribute("aria-disabled", "false");
    } else disableOpen();
    if (!config) {
      result.textContent = `${configurationNote} Download ${filename} and send it to the app maintainer.`;
    } else if (transferred) {
      result.textContent = `Open GitHub issue, then attach ${filename}. GitHub attachments become public when uploaded.`;
    } else if (downloadedAttachment !== null || copiedAttachment !== null) {
      result.textContent = "The report changed. Download all updated files before opening the GitHub issue.";
    } else {
      result.textContent = `Download all files as ${filename}, then open the GitHub issue and attach it. Nothing has been sent.`;
    }
    return true;
  };
  const prepare = (): void => {
    if (disposed || refresh.disabled) return;
    const current = ++generation;
    ready = false;
    viewer?.destroy();
    viewer = null;
    reportHost.replaceChildren();
    disableOpen();
    downloadedAttachment = null;
    copiedAttachment = null;
    report = "";
    attachment = "";
    copyReviewed.disabled = true;
    result.textContent = "Preparing the activity report on this device…";
    refresh.disabled = true;
    void Promise.resolve().then(() => disposed ? "" : source.report()).then(raw => {
      if (disposed || current !== generation) return;
      report = redactIssueReport(raw, source.reportSecrets?.());
      filename = issueReportFilename(config, options.now());
      ready = true;
      updateLinks();
      viewer = createIssueReportView(attachment, {
        document, downloads: options.downloads, zipFilename: filename, copy,
        additionalFiles: () => (source.files?.() ?? []).map(file => ({ ...file, text: redactIssueReport(file.text, source.reportSecrets?.()) })),
        onDownload(name) {
          if (disposed || name !== filename) return;
          downloadedAttachment = attachment;
          updateLinks();
        },
      });
      reportHost.append(viewer.element);
      setIconButtonLabel(refresh, "Refresh report");
    }).catch(() => {
      if (disposed || current !== generation) return;
      ready = false;
      setIconButtonLabel(refresh, "Try report again");
      result.textContent = "The activity report could not be prepared. Try again with ↻, or use View report in Settings → Diagnostics.";
    }).finally(() => {
      if (disposed || current !== generation) return;
      refresh.disabled = false;
    });
  };
  const clear = (): void => {
    generation++;
    ready = false;
    viewer?.destroy();
    viewer = null;
    reportHost.replaceChildren();
    disableOpen();
    downloadedAttachment = null;
    copiedAttachment = null;
    title.value = "";
    description.value = "";
    report = "";
    attachment = "";
    filename = "";
    result.textContent = "";
    refresh.disabled = false;
    copyReviewed.disabled = true;
    setIconButtonLabel(refresh, "Refresh report");
  };
  const onOpen = (event: MouseEvent): void => {
    if (!config) { event.preventDefault(); return; }
    if (!updateLinks() || open.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      if (ready) result.textContent = "Download the reviewed report first, then open the GitHub issue and attach that file.";
    }
  };
  const onCopyReviewed = (): void => {
    if (disposed || copyReviewed.disabled || !updateLinks()) return;
    const current = generation;
    const copied = attachment;
    copyReviewed.disabled = true;
    void Promise.resolve().then(() => { if (!disposed) return copy(copied); }).then(() => {
      if (disposed || current !== generation) return;
      copiedAttachment = copied;
      updateLinks();
      if (copied === attachment) result.textContent = config
        ? "Copied the reviewed report. Open GitHub issue and paste it into the description. Submitted issues are public."
        : "Copied the reviewed report. You can send it to the app maintainer.";
    }, () => {
      if (disposed || current !== generation) return;
      copiedAttachment = null;
      updateLinks();
      result.textContent = "The browser did not allow copying. Download all files, or download index.txt and the files it names.";
    }).finally(() => {
      if (!disposed && current === generation) copyReviewed.disabled = !ready || !title.value.trim() || !description.value.trim();
    });
  };
  const onEdit = (): void => { updateLinks(); };
  refresh.addEventListener("click", prepare);
  open.addEventListener("click", onOpen);
  copyReviewed.addEventListener("click", onCopyReviewed);
  title.addEventListener("input", onEdit);
  description.addEventListener("input", onEdit);
  return {
    element: panel,
    show() { if (!disposed && !ready) prepare(); },
    destroy() {
      if (disposed) return;
      disposed = true;
      clear();
      refresh.removeEventListener("click", prepare);
      open.removeEventListener("click", onOpen);
      copyReviewed.removeEventListener("click", onCopyReviewed);
      title.removeEventListener("input", onEdit);
      description.removeEventListener("input", onEdit);
      reviewTooltip.destroy();
      panel.remove();
    },
  };
}
