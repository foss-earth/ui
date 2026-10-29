// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBugReportPanel, type BugReportPanelHandle } from "./bugReportPanel.js";

const settle = async (): Promise<void> => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };
let section: BugReportPanelHandle | null = null;
afterEach(() => { section?.destroy(); section = null; vi.restoreAllMocks(); });
const reporter = { repository: "UMN-VR/UMN-VR.github.io", appName: "Campus tour" };
const rawReport = [
  "TypeError: Failed to fetch dynamically imported module: /aircraft.js",
  "Campus tour report, 2026-10-28T00:00:00.000Z",
  "Browser: Android Firefox Mobile", "Build: abc123", "Renderer: webgl2", "GPU: Adreno 740",
  "Settings (all effective values):", ...Array.from({ length: 60 }, (_, n) => `setting.${n} = VALUE_${n}`),
  "Errors nothing handled: none.", "This visit, oldest first:", "1.0 s FULL_ACTIVITY_MARKER", "2.0 s Failed with opaque-settings-key",
  "The visit before: no trail of one on this device.", "",
].join("\n");

function action<T extends HTMLElement = HTMLButtonElement>(name: string): T {
  return [...section!.element.querySelectorAll("button, a")].find(element => element.textContent === name || element.getAttribute("aria-label") === name) as T;
}
function fields() {
  return {
    title: section!.element.querySelector<HTMLInputElement>('input[name="title"]')!,
    description: section!.element.querySelector<HTMLTextAreaElement>('textarea[name="description"]')!,
  };
}
function describeBug(title = "The panorama goes black", description = "I opened the mall panorama."): void {
  fields().title.value = title;
  fields().description.value = description;
  fields().description.dispatchEvent(new Event("input", { bubbles: true }));
}
function downloads() {
  const blobs = new Map<string, Blob>();
  const create = vi.fn((blob: Blob): string => { const url = `blob:report-${blobs.size + 1}`; blobs.set(url, blob); return url; });
  const revoke = vi.fn((url: string): void => { blobs.delete(url); });
  return { blobs, create, revoke };
}
function create(source: Parameters<typeof createBugReportPanel>[0], options: Partial<Parameters<typeof createBugReportPanel>[1]> = {}) {
  return createBugReportPanel(source, { now: () => new Date("2026-10-28T00:00:00.000Z"), downloads: downloads(), ...options });
}
function activate(link: HTMLAnchorElement): void {
  link.addEventListener("click", event => event.preventDefault(), { once: true });
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = (): void => resolve(reader.result as string); reader.onerror = (): void => reject(reader.error); reader.readAsText(blob);
  });
}

describe("Bug report shared diagnostics caller", () => {
  it("collects lazily and uses shared file tabs, line search, and plain downloads", async () => {
    const local = downloads();
    const report = vi.fn(async () => rawReport);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
    section = create({ report, previous: async () => null, reportSecrets: () => ["opaque-settings-key"] }, { downloads: local, issueReporter: reporter });
    document.body.append(section.element);
    expect(report).not.toHaveBeenCalled();
    section.show(); section.show(); await settle();
    expect(report).toHaveBeenCalledOnce();
    expect(section.element.querySelector('textarea[name="report"]')).toBeNull();
    expect(section.element.querySelector('[role=tablist][aria-label="Error report files"]')).not.toBeNull();
    action("settings.txt").click();
    expect(section.element.querySelector("pre")).toBeNull();
    const search = section.element.querySelector<HTMLInputElement>('input[aria-label="Find a line in the error report"]')!;
    search.value = "VALUE_49"; search.dispatchEvent(new Event("input", { bubbles: true }));
    const hit = [...section.element.querySelectorAll("button")].find(button => button.textContent?.startsWith("settings.txt:51"))!;
    hit.click();
    expect(section.element.querySelector("pre")?.textContent).toContain("setting.49 = VALUE_49");
    expect(section.element.querySelector("pre")?.textContent).not.toContain("setting.0 =");
    activate(action<HTMLAnchorElement>("Download this file"));
    expect(action<HTMLAnchorElement>("Download this file").download).toBe("settings.txt");
    expect(await blobText([...local.blobs.values()][0]!)).toContain("setting.0 = VALUE_0");
    expect(action<HTMLAnchorElement>("Open GitHub issue").hasAttribute("href")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("redacts metadata and full activity, and opens only a short draft after a zip download", async () => {
    const local = downloads();
    section = create({ report: async () => rawReport, previous: async () => null, reportSecrets: () => ["opaque-settings-key"] }, { downloads: local, issueReporter: reporter });
    section.show(); await settle();
    describeBug("Problem with opaque-settings-key", "Reproduced using opaque-settings-key");
    expect(fields().title.value).toBe("Problem with [redacted]");
    expect(fields().description.value).toBe("Reproduced using [redacted]");
    const open = action<HTMLAnchorElement>("Open GitHub issue");
    const zip = action<HTMLAnchorElement>("Download all");
    expect(open.hasAttribute("href")).toBe(false);
    activate(zip);
    expect(zip.download).toMatch(/^UMN-VR\.github\.io-bug-report-.*\.zip$/);
    const contents = await blobText(local.blobs.get(zip.getAttribute("href")!)!);
    expect(contents.startsWith("PK")).toBe(true);
    expect(contents).toContain("index.txt"); expect(contents).toContain("index.json");
    expect(contents).toContain("Title: Problem with [redacted]");
    expect(contents).toContain("FULL_ACTIVITY_MARKER"); expect(contents).not.toContain("opaque-settings-key");
    const draft = new URL(open.href);
    expect(draft.pathname).toBe("/UMN-VR/UMN-VR.github.io/issues/new");
    expect(draft.searchParams.get("body")).toContain("Android Firefox Mobile");
    expect(draft.searchParams.get("body")).toContain(zip.download);
    expect(draft.href).not.toContain("FULL_ACTIVITY_MARKER");
    expect(open.target).toBe("_blank"); expect(open.rel).toBe("noopener noreferrer");
  });

  it("downloads without a configured repository and handles invalid configuration", async () => {
    const report = vi.fn(async () => rawReport);
    section = create({ report, previous: async () => null });
    expect(section.element.textContent).toContain("GitHub issue repository is not configured");
    section.show(); await settle();
    activate(action<HTMLAnchorElement>("Download all"));
    expect(action<HTMLAnchorElement>("Download all").download).toMatch(/^app-bug-report-.*\.zip$/);
    expect(action<HTMLAnchorElement>("Open GitHub issue").hasAttribute("href")).toBe(false);
    section.destroy();
    section = create({ report, previous: async () => null }, { issueReporter: { repository: "org/app?body=evil" } });
    expect(section.element.textContent).toContain("owner/name");
  });

  it("invalidates the download after edits and preserves metadata until Refresh", async () => {
    const local = downloads();
    const report = vi.fn<() => Promise<string>>().mockResolvedValueOnce(rawReport).mockResolvedValue(rawReport.replace("FULL_ACTIVITY_MARKER", "FRESH_ACTIVITY"));
    section = create({ report, previous: async () => null }, { downloads: local, issueReporter: reporter });
    section.show(); await settle(); describeBug();
    activate(action<HTMLAnchorElement>("Download all"));
    const first = action<HTMLAnchorElement>("Download all").getAttribute("href")!;
    describeBug("Edited title");
    expect(local.revoke).toHaveBeenCalledWith(first);
    expect(action<HTMLAnchorElement>("Open GitHub issue").hasAttribute("href")).toBe(false);
    expect(section.element.textContent).toContain("The report changed");
    section.show(); await settle(); expect(report).toHaveBeenCalledOnce();
    expect(fields().title.value).toBe("Edited title");
    action("Refresh report").click(); await settle();
    expect(report).toHaveBeenCalledTimes(2); expect(fields().title.value).toBe("Edited title");
    activate(action<HTMLAnchorElement>("Download all"));
    const zip = action<HTMLAnchorElement>("Download all");
    expect(await blobText(local.blobs.get(zip.getAttribute("href")!)!)).toContain("FRESH_ACTIVITY");
    const final = zip.getAttribute("href")!;
    section.destroy(); expect(local.revoke).toHaveBeenCalledWith(final);
  });

  it("ignores stale reports after destroy and offers a report preparation retry", async () => {
    let finish!: (text: string) => void;
    section = create({ report: () => new Promise(resolve => { finish = resolve; }), previous: async () => null });
    section.show(); await settle();
    const previous = section.element;
    section.destroy(); finish(rawReport); await settle();
    expect(previous.querySelector('[role=tablist]')).toBeNull();
    const report = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("No storage")).mockResolvedValue(rawReport);
    section = create({ report, previous: async () => null });
    section.show(); await settle();
    expect(section.element.textContent).toContain("The activity report could not be prepared");
    action("Try report again").click(); await settle();
    expect(section.element.querySelector('[role=tablist]')).not.toBeNull();
  });

  it("keeps the draft closed when text copy fails and supports a local plain-text fallback", async () => {
    const copy = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error("Denied")).mockResolvedValue(undefined);
    section = create({ report: async () => rawReport, previous: async () => null, copy }, { issueReporter: reporter });
    section.show(); await settle(); describeBug();
    action("Copy reviewed report").click(); await settle();
    expect(action<HTMLAnchorElement>("Open GitHub issue").hasAttribute("href")).toBe(false);
    expect(section.element.textContent).toContain("The browser did not allow copying");
    action("Copy reviewed report").click(); await settle();
    expect(copy.mock.calls[1]![0]).toContain("FULL_ACTIVITY_MARKER");
    expect(action<HTMLAnchorElement>("Open GitHub issue").href).toContain("https://github.com/");
  });
});
