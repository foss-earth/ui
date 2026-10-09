// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry } from "../src/settings/registry.js";
import { createDial, createHelpTooltip, createParameterSection, createSectionsElement, createSettingsTransfer, PANEL_SECTIONS_OPEN_STORAGE_KEY, type ParameterSectionOptions } from "../src/browser/index.js";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function hostDocument(): Document {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  return frame.contentDocument!;
}

describe("supplied DOM realm", () => {
  it("builds and edits section controls without ambient Document or DOM constructors", () => {
    const supplied = hostDocument();
    const settings = createSettingsRegistry({ storage: null });
    settings.register([{ id: "host.amount", label: "Amount", description: "A continuous host value.", unit: "ms", kind: "number", numberControl: "field", bounds: () => ({ min: 0, max: 100 }), default: 1, defaultReason: "Host default.", home: { tab: "host", section: "cost", level: "main" }, appliesLive: true, source: "host.ts" }]);
    for (const name of ["document", "window", "Node", "HTMLAnchorElement", "HTMLInputElement", "Event"]) vi.stubGlobal(name, undefined);
    const stop = vi.fn();
    const handle = createParameterSection(settings, { document: supplied, tab: "host", section: "cost", refresh: { subscribe: () => stop } });
    try {
      supplied.body.append(handle.element);
      expect(handle.element.ownerDocument).toBe(supplied);
      const dial = createDial({ ariaLabel: "Host dial", centre: supplied.createElement("span"), valueMax: 59, onPress() {}, onDragStart() {}, onDrag() {}, onKey() {}, onMark() {} });
      try { expect(dial.element.ownerDocument).toBe(supplied); } finally { dial.destroy(); }
      const field = handle.element.querySelector<HTMLInputElement>('input[type="number"]')!;
      field.value = "12.5";
      const event = supplied.createEvent("Event"); event.initEvent("change", true, false); field.dispatchEvent(event);
      expect(settings.get("host.amount")).toBe(12.5);
      const help = handle.element.querySelector<HTMLButtonElement>(".foss-earth-parameter__help-button")!;
      help.click();
      expect(help.getAttribute("aria-expanded")).toBe("true");
      expect(supplied.querySelector('[role="tooltip"]')?.ownerDocument).toBe(supplied);
    } finally { handle.destroy(); handle.destroy(); }
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps explanation state within each supplied document", () => {
    const a = hostDocument(), b = hostDocument();
    const first = createHelpTooltip({ label: "First", content: a.createElement("p") });
    const second = createHelpTooltip({ label: "Second", content: b.createElement("p") });
    try {
      a.body.append(first.element); b.body.append(second.element);
      first.open(); second.open();
      expect(first.button.getAttribute("aria-expanded")).toBe("true");
      expect(second.button.getAttribute("aria-expanded")).toBe("true");
      second.close();
      expect(first.button.getAttribute("aria-expanded")).toBe("true");
    } finally { first.destroy(); second.destroy(); }
  });

  it("rejects a missing host Document before constructing controls or borrowing refresh", () => {
    const settings = createSettingsRegistry({ storage: null }), subscribe = vi.fn();
    expect(() => createParameterSection(settings, { tab: "host", section: "cost", refresh: { subscribe } } as ParameterSectionOptions)).toThrow(/host Document/);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("uses presentation storage from the supplied document rather than ambient localStorage", () => {
    const supplied = hostDocument();
    const getItem = vi.fn((key: string) => key === PANEL_SECTIONS_OPEN_STORAGE_KEY ? '{"host":true}' : null);
    Object.defineProperty(supplied.defaultView, "localStorage", { configurable: true, value: { getItem, setItem: vi.fn() } });
    const ambientRead = vi.fn(() => { throw new Error("Wrong storage origin"); });
    vi.stubGlobal("localStorage", { getItem: ambientRead, setItem: ambientRead });
    const handle = createSectionsElement([{ id: "host", title: "Host", element: supplied.createElement("p") }], { document: supplied });
    try {
      expect(handle.element.querySelector("details")?.open).toBe(true);
      expect(getItem).toHaveBeenCalledWith(PANEL_SECTIONS_OPEN_STORAGE_KEY);
      expect(ambientRead).not.toHaveBeenCalled();
    } finally { handle.destroy(); }
  });

  it.each(["absent", "throws"])("offers text selection when the host Clipboard API %s", kind => {
    const supplied = hostDocument();
    Object.defineProperty(supplied.defaultView!.navigator, "clipboard", { configurable: true, value: kind === "absent" ? undefined : { writeText() { throw new Error("Clipboard refused"); } } });
    const settings = createSettingsRegistry({ storage: null });
    const handle = createSettingsTransfer(settings, {}, "host", supplied);
    try {
      supplied.body.append(handle.element);
      const buttons = [...handle.element.querySelectorAll("button")];
      buttons.find(button => button.textContent === "Export")!.click();
      const selected = vi.spyOn(handle.element.querySelector("textarea")!, "select");
      buttons.find(button => button.textContent === "Copy")!.click();
      expect(selected).toHaveBeenCalledOnce();
      expect(handle.element.querySelector('[role="status"]')?.textContent).toBe("Select the text and copy it.");
    } finally { handle.destroy(); }
  });
});
