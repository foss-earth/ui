// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishedVersion } from "../diagnostics/publishedVersion.js";
import { createAppFilesSection as createDocumentAppFilesSection, describeAppFiles, type AppFilesSectionHandle } from "./appFilesSection.js";

const createInjectedAppFilesSection = (source: Parameters<typeof createDocumentAppFilesSection>[0], published: Parameters<typeof createDocumentAppFilesSection>[1], refresh: Parameters<typeof createDocumentAppFilesSection>[2]) => createDocumentAppFilesSection(source, published, refresh, document);

const status = { unavailable: null, installed: true, controlling: true, files: 34, bytes: 7.25 * 1024 * 1024 };

describe("the app files section", () => {
  it("uses host refreshes only while visible and ignores older or disposed status answers", async () => {
    const settle = async () => { for (let turn = 0; turn < 5; turn++) await Promise.resolve(); };
    const answers: ((value: typeof status) => void)[] = [];
    let refresh!: () => void; const stop = vi.fn();
    const read = vi.fn(() => new Promise<typeof status>(resolve => { answers.push(resolve); }));
    const section = createInjectedAppFilesSection({ status: read }, undefined, { subscribe(listener) { refresh = listener; return stop; } });
    const details = document.createElement("details"); details.open = true; details.append(section.element); document.body.append(details);
    await settle(); refresh(); await settle();
    answers[1]({ ...status, files: 2 }); await settle(); expect(section.element.textContent).toContain("2 files");
    answers[0]({ ...status, files: 1 }); await settle(); expect(section.element.textContent).toContain("2 files");
    details.open = false; refresh(); await settle(); expect(read).toHaveBeenCalledTimes(2);
    details.open = true; refresh(); await settle(); section.destroy(); section.destroy();
    answers[2]({ ...status, files: 99 }); await settle(); refresh(); await settle();
    expect(section.element.textContent).not.toContain("99 files"); expect(stop).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledTimes(3); details.remove();
  });
  it("detaches retained published-version action buttons", async () => {
    const reload = vi.fn(); const ask = vi.fn(async () => {}); const stop = vi.fn();
    const section = createInjectedAppFilesSection({ status: async () => status }, { state: () => ({ kind: "older", build: "old", published: "new", at: 0 }), subscribe: () => stop, ask, reload, now: () => 0 }, { subscribe: () => () => {} });
    const [askButton, reloadButton] = [...section.element.querySelectorAll("button")];
    section.destroy(); askButton.click(); reloadButton.click(); await Promise.resolve();
    expect(ask).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
  });
  it("says what is kept and whether this visit was answered from it", () => {
    expect(describeAppFiles(status)).toBe("34 files (7.3 MB) of the app kept on this device. This visit takes them from there.");
    expect(describeAppFiles({ ...status, controlling: false })).toMatch(/The next visit takes them from there\.$/);
    expect(describeAppFiles({ ...status, installed: false, files: 0, bytes: 0 })).toBe("Nothing kept yet: the app's files are kept once this page has loaded.");
    expect(describeAppFiles({ ...status, installed: false })).toMatch(/from before keeping was turned off/);
  });

  it("says why nothing can be kept, in the keeper's words", () => {
    expect(describeAppFiles({ ...status, unavailable: "This build has no worker to keep its files." })).toBe("This build has no worker to keep its files.");
    expect(describeAppFiles(null)).toBe("Reading the app's files…");
  });
});

describe("the published version in the app files section", () => {
  const OLD = "2026-10-03T05:33:53.461Z";
  const NEW = "2026-10-04T17:33:49.408Z";
  let section: AppFilesSectionHandle | null = null;
  afterEach(() => { section?.destroy(); section = null; });

  /** The check as the section uses it, with an answer the test gives when it likes. */
  function published(first: PublishedVersion) {
    let state = first;
    let reloads = 0;
    let answer: ((state: PublishedVersion) => void) | null = null;
    const listeners = new Set<(state: PublishedVersion) => void>();
    return {
      source: {
        state: () => state,
        subscribe: (listener: (state: PublishedVersion) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        ask: () => new Promise<PublishedVersion>(resolve => { answer = resolve; }),
        reload: () => { reloads += 1; },
        now: () => 60_000,
      },
      reloads: () => reloads,
      listeners: () => listeners.size,
      async answer(next: PublishedVersion): Promise<void> {
        state = next;
        for (const listener of [...listeners]) listener(state);
        answer?.(state);
        await Promise.resolve();
        await Promise.resolve();
      },
    };
  }
  const buttons = (): HTMLButtonElement[] => [...section!.element.querySelectorAll("button")];
  const says = (): string => section!.element.querySelectorAll("[role=status]")[1].textContent ?? "";

  it("says that this page is the published one, and asks the site again when asked to", async () => {
    const check = published({ kind: "published", build: NEW, at: 0 });
    section = createAppFilesSection({ status: async () => status }, check.source);
    const [ask, reload] = buttons();
    expect(says()).toBe(`This page is the published version of the app, built ${NEW}; the site was asked 60 s ago.`);
    expect([ask.textContent, ask.disabled, reload.hidden]).toEqual(["Ask now", false, true]);
    ask.click();
    expect(says()).toBe("Asking the site which version is published…");
    expect(ask.disabled).toBe(true);
    await check.answer({ kind: "published", build: NEW, at: 60_000 });
    expect(says()).toMatch(/the site was asked just now\.$/);
    expect(ask.disabled).toBe(false);
  });

  it("offers the reload on a page that is older than the published one", async () => {
    const check = published({ kind: "not-asked", build: OLD });
    section = createAppFilesSection({ status: async () => status }, check.source);
    expect(buttons()[1].hidden).toBe(true);
    await check.answer({ kind: "older", build: OLD, published: NEW, at: 60_000 });
    expect(says()).toBe(`This page is an older version of the app, built ${OLD}: the published one was built ${NEW}; the site was asked just now.`);
    const reload = buttons()[1];
    expect([reload.textContent, reload.hidden]).toEqual(["Reload to use the published version", false]);
    reload.click();
    expect(check.reloads()).toBe(1);
  });

  it("has nothing to ask where the page carries no stamp or asking is off, and stops listening when it goes", () => {
    for (const state of [{ kind: "unstamped" }, { kind: "off", build: NEW }] as PublishedVersion[]) {
      const check = published(state);
      const made = createAppFilesSection({ status: async () => status }, check.source);
      expect(made.element.querySelector("button")!.disabled).toBe(true);
      expect(check.listeners()).toBe(1);
      made.destroy();
      expect(check.listeners()).toBe(0);
    }
  });

  it("is the kept files alone for an app that gives no check", () => {
    section = createAppFilesSection({ status: async () => status });
    expect(buttons()).toEqual([]);
    expect(section.element.querySelectorAll("[role=status]")).toHaveLength(1);
  });
});

function createAppFilesSection(source: Parameters<typeof createInjectedAppFilesSection>[0], published?: Parameters<typeof createInjectedAppFilesSection>[1]) {
  return createInjectedAppFilesSection(source, published, { subscribe: () => () => {} });
}
