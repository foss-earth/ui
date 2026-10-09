// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReportView } from "./reportView.js";

afterEach(() => { vi.restoreAllMocks(); });

function mountedReport() {
  const document = globalThis.document.implementation.createHTMLDocument("Report lifecycle");
  const report = vi.fn(async () => "Host report");
  const view = createReportView({ report, previous: async () => null }, {
    document, href: "https://host.test/?report", now: () => new Date(0),
  });
  document.body.append(view.element);
  const diagnosticsButton = view.element.querySelector<HTMLButtonElement>('[aria-label="Diagnostics"] button')!;
  const bugReport = view.element.querySelector<HTMLElement>('[aria-label="Bug report"]')!;
  const refresh = [...bugReport.querySelectorAll("button")].find(button => button.textContent === "Refresh report")!;
  return { view, report, diagnosticsButton, bugReport, refresh };
}

describe("report view cleanup failures", () => {
  it("releases the Bug report and page after Diagnostics cleanup fails, then stays disposed", () => {
    const { view, report, diagnosticsButton, bugReport, refresh } = mountedReport();
    const failure = new Error("Diagnostics listener cleanup failed");
    const diagnosticsCleanup = vi.spyOn(diagnosticsButton, "removeEventListener").mockImplementation(() => {
      view.destroy();
      throw failure;
    });
    const bugCleanup = vi.spyOn(refresh, "removeEventListener");
    const remove = vi.spyOn(view.element, "remove");
    let caught: unknown;
    try { view.destroy(); } catch (error) { caught = error; }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([failure]);
    expect(bugCleanup).toHaveBeenCalledTimes(1);
    expect(bugReport.parentNode).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(view.element.isConnected).toBe(false);
    expect(() => view.destroy()).not.toThrow();
    view.show();
    expect(diagnosticsCleanup).toHaveBeenCalledTimes(1);
    expect(bugCleanup).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("preserves all child and DOM failures after every release has been attempted", () => {
    const { view, diagnosticsButton, refresh } = mountedReport();
    const diagnosticsFailure = new Error("Diagnostics cleanup failed");
    const bugFailure = new Error("Bug report cleanup failed");
    const domFailure = new Error("Page cleanup failed");
    const attempts: string[] = [];
    vi.spyOn(diagnosticsButton, "removeEventListener").mockImplementation(() => {
      attempts.push("Diagnostics"); throw diagnosticsFailure;
    });
    vi.spyOn(refresh, "removeEventListener").mockImplementation(() => {
      attempts.push("Bug report"); throw bugFailure;
    });
    const remove = view.element.remove.bind(view.element);
    vi.spyOn(view.element, "remove").mockImplementation(() => {
      attempts.push("Page"); remove(); throw domFailure;
    });
    let caught: unknown;
    try { view.destroy(); } catch (error) { caught = error; }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([diagnosticsFailure, bugFailure, domFailure]);
    expect(attempts).toEqual(["Diagnostics", "Bug report", "Page"]);
    expect(view.element.isConnected).toBe(false);
    expect(() => view.destroy()).not.toThrow();
    expect(attempts).toHaveLength(3);
  });
});
