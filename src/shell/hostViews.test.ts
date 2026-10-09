// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createSettingsView } from "./settingsView.js";
import { createReportView } from "./reportView.js";

describe("host-owned Settings and report views", () => {
  it("rejects two homes with the same section ID and adopts the supplied section", () => {
    const element = document.createElement("p"); element.textContent = "Host section";
    expect(() => createSettingsView([{ id: "same", title: "One", element }, { id: "same", title: "Two", element }], null, document)).toThrow("Duplicate");
    const view = createSettingsView([{ id: "host", title: "Host", element }], null, document);
    expect(view.element.contains(element)).toBe(true); view.destroy();
  });
  it("stops a retained section's open-state writes when the Settings view is destroyed", () => {
    const write = vi.fn();
    const view = createSettingsView([{ id: "host", title: "Host", element: document.createElement("p") }], { getItem: () => null, setItem: write }, document);
    const details = view.element.querySelector("details")!;
    view.destroy(); details.open = true; details.dispatchEvent(new Event("toggle"));
    expect(write).not.toHaveBeenCalled();
    expect(() => view.append({ id: "next", title: "Next", element: document.createElement("p") })).toThrow("disposed");
  });
  it("creates the report in the supplied document without mounting or starting the host", async () => {
    const document = globalThis.document.implementation.createHTMLDocument("Host report");
    const report = vi.fn(async () => "Host report"); const copy = vi.fn(async () => {});
    const view = createReportView({ report, copy, previous: async () => null }, { document, href: "https://host.test/?report&dev=1#anchor", now: () => new Date(0) });
    expect(view.element.ownerDocument).toBe(document); expect(view.element.isConnected).toBe(false);
    expect([...view.element.querySelectorAll("*")].every(element => element.ownerDocument === document)).toBe(true);
    expect(view.element.querySelector<HTMLAnchorElement>("a")!.href).toBe("https://host.test/?dev=1#anchor");
    expect(report).not.toHaveBeenCalled(); view.show();
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    expect(report).toHaveBeenCalledTimes(2); expect(copy).toHaveBeenCalledWith("Host report");
    view.destroy(); view.show();
    expect(view.element.isConnected).toBe(false); expect(report).toHaveBeenCalledTimes(2);
  });
});
