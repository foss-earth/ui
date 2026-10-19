import { createIssueDraft, issueReportAttachment, issueReportFilename, redactIssueReport, validateIssueReporterConfig, type IssueReporterConfig } from "../diagnostics/issueReport.js";
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

const size = (text: string): string => `${(new Blob([text]).size / 1024).toFixed(1)} KB`;

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
  const review = paragraph(document, "Remove personal details from the report before continuing. GitHub attachments become public when uploaded. ");
  const reviewHelp = document.createElement("div");
  const reviewText = document.createElement("p");
  reviewText.textContent = "Known keys, recognized secrets, email addresses, coordinates and URL queries are removed automatically. Download the report, then open the GitHub issue and attach that file. Submit publishes the issue. The draft contains a short summary; the file keeps the full report.";
  reviewHelp.append(reviewText);
  const reviewTooltip = createHelpTooltip({ label: "Explain the bug report", content: reviewHelp });
  review.append(reviewTooltip.element);
  const reportText = document.createElement("textarea");
  reportText.className = "foss-earth-settings-transfer__text";
  reportText.name = "report";
  reportText.rows = 12;
  reportText.spellcheck = false;
  reportText.setAttribute("aria-label", "Activity report to attach");
  const result = paragraph(document, "");
  result.setAttribute("role", "status");
  const download = createIconButton(document, { icon: "download", label: "Download report", tag: "a" });
  download.setAttribute("aria-disabled", "true");
  const open = document.createElement("a");
  open.className = "foss-earth-choice foss-earth-parameter__action";
  open.append("GitHub issue ", createExternalLinkIcon(document));
  open.setAttribute("aria-label", "Open GitHub issue");
  open.title = "Open GitHub issue, in a new tab";
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.setAttribute("aria-disabled", "true");
  const copyReviewed = createIconButton(document, { icon: "copy", label: "Copy reviewed report" });
  copyReviewed.hidden = true;
  const refresh = createIconButton(document, { icon: "refresh", label: "Refresh report" });
  panel.append(titleLabel, descriptionLabel, review, reportText, result, download, open, copyReviewed, refresh);

  let generation = 0;
  let ready = false;
  let filename = "";
  let attachment = "";
  let objectUrl: string | null = null;
  let downloadedAttachment: string | null = null;
  let copiedAttachment: string | null = null;
  const disableLink = (link: HTMLAnchorElement): void => {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
  };
  const releaseDownload = (): void => {
    if (objectUrl) options.downloads?.revoke(objectUrl);
    objectUrl = null;
    attachment = "";
    disableLink(download);
    disableLink(open);
  };
  const updateLinks = (): boolean => {
    if (disposed || !ready) return false;
    const secrets = source.reportSecrets?.();
    const redactedTitle = redactIssueReport(title.value, secrets);
    const redactedDescription = redactIssueReport(description.value, secrets);
    if (redactedTitle !== title.value) title.value = redactedTitle;
    if (redactedDescription !== description.value) description.value = redactedDescription;
    if (!title.value.trim() || !description.value.trim()) {
      releaseDownload();
      copyReviewed.hidden = true;
      result.textContent = "Add an issue title and describe what happened, then download the reviewed report.";
      return false;
    }
    const redacted = redactIssueReport(reportText.value, secrets);
    if (redacted !== reportText.value) reportText.value = redacted;
    const snapshot = { title: title.value, description: description.value, report: reportText.value, filename };
    const nextAttachment = issueReportAttachment(config, snapshot);
    if (nextAttachment !== attachment) {
      releaseDownload();
      attachment = nextAttachment;
      try {
        if (!options.downloads) throw new Error("File download unavailable");
        objectUrl = options.downloads.create(new Blob([attachment], { type: "text/plain;charset=utf-8" }));
      } catch {
        copyReviewed.hidden = false;
      }
    }
    if (objectUrl) {
      download.href = objectUrl;
      download.download = filename;
      download.setAttribute("aria-disabled", "false");
      copyReviewed.hidden = true;
    }
    const transferred = downloadedAttachment === attachment || copiedAttachment === attachment;
    if (transferred && config) {
      open.href = createIssueDraft(config, snapshot).url;
      open.setAttribute("aria-disabled", "false");
    } else disableLink(open);
    if (!objectUrl) {
      result.textContent = config
        ? "File downloads are unavailable in this browser. Use Copy reviewed report and paste it into the GitHub issue, or use a browser that can download files."
        : "File downloads are unavailable in this browser. Use Copy reviewed report and send it to the app maintainer, or use a browser that can download files.";
    } else if (!config) {
      result.textContent = `${configurationNote} Download ${filename} and send it to the app maintainer.`;
    } else if (transferred) {
      result.textContent = `Open GitHub issue, then attach ${filename}. GitHub attachments become public when uploaded.`;
    } else if (downloadedAttachment !== null || copiedAttachment !== null) {
      result.textContent = "The report changed. Download the updated report before opening the GitHub issue.";
    } else {
      result.textContent = `Ready, ${size(attachment)}. Download ${filename}, then open the GitHub issue and attach it. Nothing has been sent.`;
    }
    return true;
  };
  const prepare = (): void => {
    if (disposed || refresh.disabled) return;
    const current = ++generation;
    ready = false;
    releaseDownload();
    downloadedAttachment = null;
    copiedAttachment = null;
    reportText.value = "";
    reportText.disabled = true;
    copyReviewed.hidden = true;
    copyReviewed.disabled = false;
    result.textContent = "Preparing the activity report on this device…";
    refresh.disabled = true;
    void Promise.resolve().then(() => disposed ? "" : source.report()).then(report => {
      if (disposed || current !== generation) return;
      reportText.value = redactIssueReport(report, source.reportSecrets?.());
      filename = issueReportFilename(config, options.now());
      ready = true;
      reportText.disabled = false;
      setIconButtonLabel(refresh, "Refresh report");
      updateLinks();
    }).catch(() => {
      if (disposed || current !== generation) return;
      setIconButtonLabel(refresh, "Try report again");
      result.textContent = "The activity report could not be prepared. Try again with ↻, or use Copy report in Settings → Diagnostics.";
    }).finally(() => {
      if (disposed || current !== generation) return;
      refresh.disabled = false;
    });
  };
  const clear = (): void => {
    generation++;
    ready = false;
    releaseDownload();
    downloadedAttachment = null;
    copiedAttachment = null;
    title.value = "";
    description.value = "";
    reportText.value = "";
    filename = "";
    result.textContent = "";
    refresh.disabled = false;
    copyReviewed.hidden = true;
    copyReviewed.disabled = false;
    setIconButtonLabel(refresh, "Refresh report");
  };
  const onDownload = (event: MouseEvent): void => {
    if (!updateLinks() || !objectUrl) { event.preventDefault(); return; }
    // Leave this object URL alive: the browser may still be saving the file.
    downloadedAttachment = attachment;
    updateLinks();
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
      result.textContent = "The browser did not allow copying. Select and copy the activity report below, or use a browser that can download the report.";
      reportText.focus();
      reportText.select();
    }).finally(() => { if (!disposed && current === generation) copyReviewed.disabled = false; });
  };
  const onEdit = (): void => { updateLinks(); };
  refresh.addEventListener("click", prepare);
  download.addEventListener("click", onDownload);
  open.addEventListener("click", onOpen);
  copyReviewed.addEventListener("click", onCopyReviewed);
  title.addEventListener("input", onEdit);
  description.addEventListener("input", onEdit);
  reportText.addEventListener("input", onEdit);
  return {
    element: panel,
    show() { if (!disposed && !ready) prepare(); },
    destroy() {
      if (disposed) return;
      disposed = true;
      clear();
      refresh.removeEventListener("click", prepare);
      download.removeEventListener("click", onDownload);
      open.removeEventListener("click", onOpen);
      copyReviewed.removeEventListener("click", onCopyReviewed);
      title.removeEventListener("input", onEdit);
      description.removeEventListener("input", onEdit);
      reportText.removeEventListener("input", onEdit);
      reviewTooltip.destroy();
      panel.remove();
    },
  };
}
