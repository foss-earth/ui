// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIssueReportView, type IssueReportViewHandle } from "./issueReportView.js";

const report = [
  "Aircraft switch failed",
  'Error: Aircraft "test-plane" failed to load',
  "    at loadAircraft (aircraft.ts:24:7)",
  "0SFS report, 2026-10-28T12:00:00Z",
  "Browser: Test",
  "Renderer: webgpu",
  "GPU: test gpu",
  "Settings (all effective values):",
  ...Array.from({ length: 80 }, (_, index) => index === 40 ? '  aircraft.id = "test-plane"' : `  setting.${index} = ${index}`),
  "Errors nothing handled: none.",
  "This visit, oldest first:",
  "  Aircraft selected",
  "The visit before: no trail of one on this device.",
].join("\n");

const views: IssueReportViewHandle[] = [];
const settle = async (): Promise<void> => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
function make(options: Parameters<typeof createIssueReportView>[1] = {}): IssueReportViewHandle {
  const view = createIssueReportView(report, options);
  document.body.append(view.element);
  // jsdom does not implement navigating to downloads.
  view.element.addEventListener("click", event => { if ((event.target as Element).closest("a")) event.preventDefault(); });
  views.push(view);
  return view;
}
function tab(view: IssueReportViewHandle, name: string): HTMLButtonElement {
  return [...view.element.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(item => item.textContent === name)!;
}
function find(view: IssueReportViewHandle, query: string): void {
  const search = view.element.querySelector<HTMLInputElement>("input[type=search]")!;
  search.value = query;
  search.dispatchEvent(new Event("input", { bubbles: true }));
}
function read(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.replaceChildren(); });

describe("shared issue report viewer", () => {
  it("opens every file and highlights search results with surrounding context", () => {
    const view = make();
    expect(view.element.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("index.txt");
    expect(view.element.querySelector("pre")?.textContent).toContain("failure.txt:2");
    tab(view, "settings.txt").click();
    expect(view.element.querySelector("pre")).not.toBeNull();
    expect(view.element.textContent).toContain("Lines 1–81 of 81");
    find(view, "setting.66");
    const hit = view.element.querySelector<HTMLButtonElement>(".foss-earth-issue-report__hits button")!;
    expect(hit.textContent).toContain("settings.txt:68");
    hit.focus();
    hit.click();
    expect(view.element.querySelector("mark")?.textContent).toContain("setting.66 = 66");
    expect(document.activeElement).toBe(view.element.querySelector("pre"));
    expect(view.element.querySelector("pre")?.textContent).toContain("setting.0");
    const settingsTab = tab(view, "settings.txt");
    settingsTab.focus();
    settingsTab.click();
    expect(view.element.querySelector("pre")).not.toBeNull();
    expect(document.activeElement).toBe(settingsTab);
    find(view, "settings.txt:42");
    view.element.querySelector<HTMLButtonElement>(".foss-earth-issue-report__hits button")!.click();
    expect(view.element.querySelector("mark")?.textContent).toContain('aircraft.id = "test-plane"');
  });

  it("opens the index needle directly and supports keyboard file tabs", () => {
    const view = make();
    const needle = [...view.element.querySelectorAll<HTMLButtonElement>(".foss-earth-issue-report__needles button")]
      .find(item => item.textContent === "Open settings.txt:42")!;
    needle.focus();
    needle.click();
    expect(view.element.querySelector("mark")?.textContent).toContain('aircraft.id = "test-plane"');
    expect(document.activeElement).toBe(view.element.querySelector("pre"));
    const selected = tab(view, "settings.txt");
    selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(tab(view, "index.txt"));
    expect(tab(view, "index.txt").getAttribute("aria-selected")).toBe("true");
    tab(view, "index.json").click();
    expect(view.element.querySelector("pre")).not.toBeNull();
    find(view, "index.json:2");
    view.element.querySelector<HTMLButtonElement>(".foss-earth-issue-report__hits button")!.click();
    expect(view.element.querySelector("pre")?.getAttribute("aria-label")).toBe("index.json:2");
  });

  it("downloads one exact file and a STORE zip, then releases its URLs", async () => {
    const blobs: Blob[] = [];
    const revoke = vi.fn();
    const onDownload = vi.fn();
    const view = make({ downloads: { create: blob => { blobs.push(blob); return `blob:test-${blobs.length}`; }, revoke }, zipFilename: "visit.zip", onDownload });
    tab(view, "failure.txt").click();
    const single = view.element.querySelector<HTMLAnchorElement>('[aria-label="Download this file"]')!;
    single.click();
    expect(single.download).toBe("failure.txt");
    expect(new TextDecoder().decode(await read(blobs[0]!))).toBe(report.split("\n").slice(0, 3).join("\n"));
    const all = [...view.element.querySelectorAll<HTMLAnchorElement>("a")].find(item => item.textContent === "Download all")!;
    all.click();
    const zip = new DataView(await read(blobs[1]!));
    expect(all.download).toBe("visit.zip");
    expect(zip.getUint32(0, true)).toBe(0x04034b50);
    expect(zip.getUint16(8, true)).toBe(0);
    expect(onDownload.mock.calls).toEqual([["failure.txt"], ["visit.zip"]]);
    view.setReport(`${report}\nChanged`);
    expect(revoke.mock.calls).toEqual([["blob:test-1"], ["blob:test-2"]]);
    expect(tab(view, "index.txt").getAttribute("aria-selected")).toBe("true");
    all.click();
    view.destroy();
    expect(revoke).toHaveBeenLastCalledWith("blob:test-3");
    expect(document.body.contains(view.element)).toBe(false);
  });

  it("copies only the index and reports unavailable downloads", async () => {
    const copy = vi.fn(async () => {});
    const view = make({ copy, downloads: { create: () => { throw new Error("Unavailable"); }, revoke() {} } });
    view.element.querySelector<HTMLButtonElement>('[aria-label="Copy index"]')!.click();
    await settle();
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.calls[0]?.[0]).toContain("failure.txt:2");
    view.element.querySelector<HTMLAnchorElement>('[aria-label="Download this file"]')!.click();
    expect(view.element.querySelector("[role=status]")?.textContent).toContain("could not download index.txt");
  });
});

it("pages through every line, remembers file positions, and stays readable with no transfer APIs", async () => {
  const view = make({ copy: async () => { throw new Error("Blocked"); },
    downloads: { create() { throw new Error("Blocked"); }, revoke() {} },
    additionalFiles: () => [{ name: "latest-loading.txt", text: Array.from({ length: 250 }, (_, i) => `entry ${i + 1}`).join("\n") }],
  });
  tab(view, "latest-loading.txt").click();
  expect(view.element.querySelector("pre")?.children).toHaveLength(100);
  view.element.querySelector<HTMLButtonElement>('[aria-label="Next report page"]')!.click();
  expect(view.element.querySelector("pre")?.textContent).toContain("entry 101");
  tab(view, "index.txt").click(); tab(view, "latest-loading.txt").click();
  expect(view.element.querySelector("pre")?.textContent).toContain("entry 101");
  const jump = view.element.querySelector<HTMLInputElement>('[aria-label="Go to line"]')!;
  jump.value = "249"; jump.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(view.element.querySelector("mark")?.textContent).toContain("entry 249");
  expect(view.element.querySelector("pre")?.children).toHaveLength(50);
  expect(view.element.querySelector<HTMLButtonElement>('[aria-label="Next report page"]')!.disabled).toBe(true);
  view.element.querySelector<HTMLButtonElement>('[aria-label="Copy this file"]')!.click(); await settle();
  expect(view.element.textContent).toContain("Every file can be read here");
  expect(view.element.querySelector("pre")?.textContent).toContain("entry 250");
});
