import { createIconButton } from "../shell/iconButton.js";
import { issueReportZip, splitIssueReport, type IssueFile } from "./issueReport.js";

export interface IssueReportViewOptions {
  document?: Document;
  additionalFiles?(): readonly IssueFile[];
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
const PAGE_LINES = 100;
const MAX_HITS = 40;

/** One paged report viewer for every host, including browsers without downloads. */
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
  let bundle = splitIssueReport(raw, options.additionalFiles?.());
  let active = "index.txt";
  let focusLine: number | null = null;
  const positions = new Map<string, number>();
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
  const copyFile = createIconButton(document, { icon: "copy", label: "Copy this file" });
  const copyAll = createIconButton(document, { icon: "copy", label: "Copy all" });
  const downloadFile = createIconButton(document, { icon: "download", label: "Download this file", tag: "a" });
  const downloadAll = document.createElement("a");
  downloadAll.className = "foss-earth-choice foss-earth-parameter__action";
  downloadAll.textContent = "Download all";
  downloadAll.title = "Download all report files as a zip";
  downloadAll.download = zipFilename;
  downloadAll.href = "#";
  tools.append(search, copyIndex, copyFile, copyAll, downloadFile, downloadAll);
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
  const paging = document.createElement("div");
  paging.className = "foss-earth-issue-report__paging foss-earth-choices";
  const previous = document.createElement("button");
  previous.className = "foss-earth-choice foss-earth-parameter__action";
  previous.type = "button"; previous.textContent = "Previous";
  previous.setAttribute("aria-label", "Previous report page");
  const next = document.createElement("button");
  next.className = "foss-earth-choice foss-earth-parameter__action";
  next.type = "button"; next.textContent = "Next";
  next.setAttribute("aria-label", "Next report page");
  const range = document.createElement("span");
  range.setAttribute("role", "status");
  const jumpLabel = document.createElement("label");
  jumpLabel.textContent = "Go to line ";
  const jump = document.createElement("input");
  jump.className = "foss-earth-parameter__text";
  jump.type = "number"; jump.min = "1"; jump.step = "1";
  jump.setAttribute("aria-label", "Go to line");
  jump.style.width = "6em";
  const go = document.createElement("button");
  go.className = "foss-earth-choice foss-earth-parameter__action";
  go.type = "button"; go.textContent = "Go";
  jumpLabel.append(jump);
  paging.append(previous, range, next, jumpLabel, go);
  element.append(tools, status, hits, tabs, needles, paging, panel);

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
    positions.set(name, Math.floor((line - 1) / PAGE_LINES));
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
    const page = Math.max(0, Math.min(positions.get(active) ?? 0, Math.ceil(lines.length / PAGE_LINES) - 1));
    positions.set(active, page);
    const first = page * PAGE_LINES;
    const end = Math.min(lines.length, first + PAGE_LINES);
    range.textContent = `Lines ${first + 1}–${end} of ${lines.length}`;
    previous.disabled = page === 0;
    next.disabled = end === lines.length;
    jump.max = String(lines.length);
    jump.value = String(focusLine ?? first + 1);
    const text = document.createElement("pre");
    text.className = "foss-earth-issue-report__text";
    text.tabIndex = 0;
    text.setAttribute("aria-label", focusLine === null ? file.name : `${file.name}:${focusLine}`);
    for (let index = first; index < end; index++) {
      const row = document.createElement(index + 1 === focusLine ? "mark" : "span");
      row.textContent = `${index + 1}  ${lines[index]}${index + 1 < end ? "\n" : ""}`;
      text.append(row);
    }
    panel.append(text);
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
      message(`Download requested for ${name}. If downloads are blocked, read the file here.`);
      options.onDownload?.(name);
    } catch {
      event.preventDefault();
      message(`The browser could not download ${name}. Read the file here or use Copy this file.`);
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
  const copyText = (control: HTMLButtonElement, value: string, label: string): void => {
    if (disposed || control.disabled) return;
    control.disabled = true;
    void Promise.resolve().then(() => copy(value)).then(() => {
      if (!disposed) message(`${label} copied.`);
    }, () => {
      if (!disposed) message("Copy is unavailable. Every file can be read here using the file tabs and page controls.");
    }).finally(() => { if (!disposed) control.disabled = false; });
  };
  const onCopy = (): void => copyText(copyIndex, bundle.files.find(file => file.name === "index.txt")?.text ?? "", "Index");
  const onCopyFile = (): void => copyText(copyFile, currentFile().text, currentFile().name);
  const onCopyAll = (): void => copyText(copyAll, bundle.files.map(file => `=== ${file.name} ===\n${file.text}`).join("\n\n"), "All files");
  const move = (offset: number): void => {
    focusLine = null;
    positions.set(active, (positions.get(active) ?? 0) + offset);
    renderFile();
    panel.querySelector<HTMLElement>("pre")?.focus();
  };
  const onPrevious = (): void => move(-1);
  const onNext = (): void => move(1);
  const onGo = (): void => {
    const line = Number(jump.value);
    if (Number.isInteger(line) && line >= 1 && line <= currentFile().text.split("\n").length) openLine(active, line);
    else message(`Enter a line between 1 and ${jump.max}.`);
  };
  const onJumpKey = (event: KeyboardEvent): void => { if (event.key === "Enter") onGo(); };
  const onFile = (event: MouseEvent): void => prepareDownload(event, false);
  const onAll = (event: MouseEvent): void => prepareDownload(event, true);
  element.addEventListener("click", onClick);
  tabs.addEventListener("keydown", onKey);
  search.addEventListener("input", renderSearch);
  copyIndex.addEventListener("click", onCopy);
  downloadFile.addEventListener("click", onFile);
  downloadAll.addEventListener("click", onAll);
  copyFile.addEventListener("click", onCopyFile);
  copyAll.addEventListener("click", onCopyAll);
  previous.addEventListener("click", onPrevious);
  next.addEventListener("click", onNext);
  go.addEventListener("click", onGo);
  jump.addEventListener("keydown", onJumpKey);
  renderTabs();
  return {
    element,
    setReport(next) {
      if (disposed || raw === next) return;
      release();
      raw = next;
      bundle = splitIssueReport(raw, options.additionalFiles?.());
      active = "index.txt";
      focusLine = null;
      positions.clear();
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
      copyFile.removeEventListener("click", onCopyFile);
      copyAll.removeEventListener("click", onCopyAll);
      previous.removeEventListener("click", onPrevious);
      next.removeEventListener("click", onNext);
      go.removeEventListener("click", onGo);
      jump.removeEventListener("keydown", onJumpKey);
      copyIndex.removeEventListener("click", onCopy);
      downloadFile.removeEventListener("click", onFile);
      downloadAll.removeEventListener("click", onAll);
      element.remove();
    },
  };
}
