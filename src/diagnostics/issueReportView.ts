import { createIconButton } from "../shell/iconButton.js";
import { issueReportZip, splitIssueReport, type IssueFile } from "./issueReport.js";

export interface IssueReportViewOptions {
  document?: Document;
  downloads?: { create(blob: Blob): string; revoke(url: string): void };
  zipFilename?: string;
  copy?(text: string): Promise<void>;
  onDownload?(filename: string): void;
}

export interface IssueReportViewHandle {
  element: HTMLElement;
  setReport(report: string): void;
  destroy(): void;
}

let nextView = 0;
const SHORT_LINES = 24;
const MAX_HITS = 40;

/** One report viewer for every host. Long files open only at a named line. */
export function createIssueReportView(report: string, options: IssueReportViewOptions = {}): IssueReportViewHandle {
  const document = options.document ?? globalThis.document;
  const id = `foss-earth-issue-report-${++nextView}`;
  const browserUrl = document.defaultView?.URL;
  const downloads = options.downloads ?? {
    create: (blob: Blob) => {
      if (!browserUrl?.createObjectURL) throw new Error("File download unavailable");
      return browserUrl.createObjectURL(blob);
    },
    revoke: (url: string) => browserUrl?.revokeObjectURL(url),
  };
  const copy = options.copy ?? (text => {
    const clipboard = document.defaultView?.navigator.clipboard;
    return clipboard ? clipboard.writeText(text) : Promise.reject(new Error("No clipboard"));
  });
  const zipFilename = options.zipFilename ?? "error-report.zip";
  let raw = report;
  let bundle = splitIssueReport(raw);
  let active = "index.txt";
  let focusLine: number | null = null;
  let disposed = false;
  const urls = new Map<string, string>();
  const element = document.createElement("div");
  element.className = "foss-earth-issue-report";
  const tools = document.createElement("div");
  tools.className = "foss-earth-issue-report__tools foss-earth-choices";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "foss-earth-parameter__text";
  search.placeholder = "Find a line";
  search.setAttribute("aria-label", "Find a line in the error report");
  const copyIndex = createIconButton(document, { icon: "copy", label: "Copy index" });
  const downloadFile = createIconButton(document, { icon: "download", label: "Download this file", tag: "a" });
  const downloadAll = document.createElement("a");
  downloadAll.className = "foss-earth-choice foss-earth-parameter__action";
  downloadAll.textContent = "Download all";
  downloadAll.title = "Download all report files as a zip";
  downloadAll.download = zipFilename;
  downloadAll.href = "#";
  tools.append(search, copyIndex, downloadFile, downloadAll);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.hidden = true;
  const hits = document.createElement("div");
  hits.className = "foss-earth-issue-report__hits";
  hits.hidden = true;
  const tabs = document.createElement("div");
  tabs.className = "foss-earth-issue-report__tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Error report files");
  const needles = document.createElement("div");
  needles.className = "foss-earth-issue-report__needles foss-earth-choices";
  const panel = document.createElement("div");
  panel.id = `${id}-panel`;
  panel.className = "foss-earth-issue-report__panel";
  panel.setAttribute("role", "tabpanel");
  element.append(tools, status, hits, tabs, needles, panel);

  const message = (text: string): void => { status.textContent = text; status.hidden = !text; };
  const currentFile = (): IssueFile => bundle.files.find(file => file.name === active) ?? bundle.files[0]!;
  const button = (text: string): HTMLButtonElement => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "foss-earth-choice foss-earth-parameter__action";
    item.textContent = text;
    return item;
  };
  const openLine = (name: string, line: number): void => {
    active = name;
    focusLine = line;
    renderFile();
    // Native focus scrolls the named line into view in a narrow host panel.
    panel.querySelector<HTMLElement>("pre")?.focus();
  };
  const renderFile = (): void => {
    const file = currentFile();
    active = file.name;
    const lines = file.text.split("\n");
    for (const tab of tabs.querySelectorAll<HTMLButtonElement>("[role=tab]")) {
      const selected = tab.dataset.file === active;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) panel.setAttribute("aria-labelledby", tab.id);
    }
    panel.replaceChildren();
    const short = lines.length <= SHORT_LINES || file.name === "index.txt";
    if (short || focusLine !== null) {
      const text = document.createElement("pre");
      text.className = "foss-earth-issue-report__text";
      text.tabIndex = 0;
      text.setAttribute("aria-label", focusLine === null ? file.name : `${file.name}:${focusLine}`);
      text.textContent = focusLine !== null
        ? `${focusLine}> ${lines[focusLine - 1] ?? ""}`
        : lines.map((line, index) => `${index + 1}  ${line}`).join("\n");
      panel.append(text);
    } else {
      const closed = document.createElement("p");
      closed.textContent = `${lines.length} lines in ${file.name}. Find a line, or open one from the index. The file stays closed until a line is named.`;
      panel.append(closed);
    }
    needles.hidden = active !== "index.txt" || bundle.needles.length === 0;
    downloadFile.download = file.name;
    downloadFile.href = "#";
  };
  const renderTabs = (): void => {
    tabs.replaceChildren(...bundle.files.map((file, index) => {
      const tab = button(file.name);
      tab.id = `${id}-tab-${index}`;
      tab.dataset.file = file.name;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panel.id);
      return tab;
    }));
    needles.replaceChildren(...bundle.needles.map(needle => {
      const item = button(`Open ${needle.file}:${needle.line}`);
      item.dataset.file = needle.file;
      item.dataset.line = String(needle.line);
      item.title = `${needle.why}: ${needle.text}`;
      return item;
    }));
    renderFile();
  };
  const renderSearch = (): void => {
    const query = search.value.trim().toLowerCase();
    hits.replaceChildren();
    hits.hidden = !query;
    if (!query) return;
    const found: Array<{ file: string; line: number; text: string }> = [];
    const address = /^([^\s:]+):(\d+)$/.exec(query);
    for (const file of bundle.files) {
      if (!address && (file.name === "index.txt" || file.name === "index.json")) continue;
      const lines = file.text.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const text = lines[index]!;
        if (address ? file.name.toLowerCase() === address[1] && index + 1 === Number(address[2]) : text.toLowerCase().includes(query)) {
          found.push({ file: file.name, line: index + 1, text });
          if (found.length === MAX_HITS) break;
        }
      }
      if (found.length === MAX_HITS) break;
    }
    if (!found.length) { hits.textContent = "No line matches."; return; }
    const list = document.createElement("ul");
    for (const hit of found) {
      const row = document.createElement("li");
      const item = button(`${hit.file}:${hit.line}  ${hit.text.trim().slice(0, 160)}`);
      item.dataset.file = hit.file;
      item.dataset.line = String(hit.line);
      row.append(item);
      list.append(row);
    }
    hits.append(list);
    if (found.length === MAX_HITS) hits.append("Showing the first 40 matching lines.");
  };
  const release = (): void => {
    for (const url of urls.values()) downloads.revoke(url);
    urls.clear();
    downloadFile.href = "#";
    downloadAll.href = "#";
  };
  const prepareDownload = (event: MouseEvent, all: boolean): void => {
    if (disposed) { event.preventDefault(); return; }
    const file = currentFile();
    const name = all ? zipFilename : file.name;
    const key = all ? "zip" : `file:${name}`;
    const link = all ? downloadAll : downloadFile;
    try {
      let url = urls.get(key);
      if (!url) {
        const blob = all
          ? new Blob([new Uint8Array(issueReportZip(bundle)).buffer], { type: "application/zip" })
          : new Blob([file.text], { type: "text/plain;charset=utf-8" });
        url = downloads.create(blob);
        urls.set(key, url);
      }
      link.href = url;
      link.download = name;
      message(`Downloaded ${name}.`);
      options.onDownload?.(name);
    } catch {
      event.preventDefault();
      message(`The browser could not download ${name}. Try Copy index or another browser.`);
    }
  };
  const onClick = (event: MouseEvent): void => {
    if (disposed) return;
    const target = event.target as Element | null;
    const item = target?.closest<HTMLButtonElement>("button[data-file]");
    if (!item || !element.contains(item)) return;
    const file = item.dataset.file!;
    if (item.dataset.line) openLine(file, Number(item.dataset.line));
    else { active = file; focusLine = null; renderFile(); }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const items = [...tabs.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const index = items.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next]!.click();
    items[next]!.focus();
  };
  const onCopy = (): void => {
    if (disposed || copyIndex.disabled) return;
    copyIndex.disabled = true;
    const text = bundle.files.find(file => file.name === "index.txt")?.text ?? "";
    void Promise.resolve().then(() => copy(text)).then(() => {
      if (!disposed) message("Index copied.");
    }, () => {
      if (!disposed) message("Copy failed. Download index.txt.");
    }).finally(() => { if (!disposed) copyIndex.disabled = false; });
  };
  const onFile = (event: MouseEvent): void => prepareDownload(event, false);
  const onAll = (event: MouseEvent): void => prepareDownload(event, true);
  element.addEventListener("click", onClick);
  tabs.addEventListener("keydown", onKey);
  search.addEventListener("input", renderSearch);
  copyIndex.addEventListener("click", onCopy);
  downloadFile.addEventListener("click", onFile);
  downloadAll.addEventListener("click", onAll);
  renderTabs();
  return {
    element,
    setReport(next) {
      if (disposed || raw === next) return;
      release();
      raw = next;
      bundle = splitIssueReport(raw);
      active = "index.txt";
      focusLine = null;
      message("");
      renderTabs();
      renderSearch();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      release();
      element.removeEventListener("click", onClick);
      tabs.removeEventListener("keydown", onKey);
      search.removeEventListener("input", renderSearch);
      copyIndex.removeEventListener("click", onCopy);
      downloadFile.removeEventListener("click", onFile);
      downloadAll.removeEventListener("click", onAll);
      element.remove();
    },
  };
}
