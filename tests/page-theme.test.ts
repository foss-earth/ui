// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { initializePageTheme, SHARED_THEME_STORAGE_KEY } from "../assets/theme-page.js";
import { createSettingsRegistry } from "../src/settings/registry.js";
import { UI_PARAMETERS } from "../src/settings/uiParameters.js";
import { createThemeController } from "../src/browser/theme.js";

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe("standalone branded page modes", () => {
  it("shares choices with the viewer and updates accessible toggle state", () => {
    const storage = memoryStorage();
    const root = document.createElement("section");
    root.innerHTML = '<button data-theme-toggle><span data-theme-label></span></button>';
    const page = initializePageTheme({ root, storage, eventTarget: window, mediaQuery: null });
    const toggle = root.querySelector<HTMLButtonElement>("button")!;
    expect(page.getTheme()).toBe("light");
    expect(toggle.getAttribute("aria-label")).toBe("Switch to dark mode");
    toggle.click();
    expect(page.getTheme()).toBe("dark");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent).toBe("\u263C");
    expect(storage.data.get(SHARED_THEME_STORAGE_KEY)).toBe("dark");
    const settings = createSettingsRegistry({ storage }); settings.register(UI_PARAMETERS);
    const viewer = createThemeController(settings, { root: document.createElement("section"), storage, eventTarget: null, mediaQuery: null });
    expect(viewer.getTheme()).toBe("dark");
    viewer.setTheme("light");
    window.dispatchEvent(new StorageEvent("storage", { key: SHARED_THEME_STORAGE_KEY, newValue: storage.getItem(SHARED_THEME_STORAGE_KEY) }));
    expect(page.getTheme()).toBe("light");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    page.dispose(); page.dispose(); viewer.dispose();
    toggle.click();
    expect(page.getTheme()).toBe("light");
    expect(() => page.toggleTheme()).toThrow("disposed");
  });
  it("adopts existing viewer preferences without altering its settings record", () => {
    const storage = memoryStorage();
    const settings = createSettingsRegistry({ storage }); settings.register(UI_PARAMETERS);
    settings.set("interface.theme", "dark"); settings.set("diagnostics.trail", false);
    const previous = storage.getItem("foss-earth.settings.v1");
    const page = initializePageTheme({ root: document.createElement("section"), storage, eventTarget: null, mediaQuery: null });
    expect(page.getTheme()).toBe("dark");
    page.setTheme("light");
    expect(storage.getItem("foss-earth.settings.v1")).toBe(previous);
    page.dispose();
  });
  it("follows the system while the shared choice is auto", () => {
    const callbacks = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      matches: true,
      addEventListener(_type: string, listener: EventListenerOrEventListenerObject) { callbacks.add(listener as (event: MediaQueryListEvent) => void); },
      removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) { callbacks.delete(listener as (event: MediaQueryListEvent) => void); },
    };
    const storage = memoryStorage();
    storage.data.set(SHARED_THEME_STORAGE_KEY, "auto");
    const root = document.createElement("section");
    const page = initializePageTheme({ root, storage, eventTarget: null, mediaQuery: media });
    expect(page.getTheme()).toBe("dark");
    media.matches = false;
    for (const callback of callbacks) callback({ matches: false } as MediaQueryListEvent);
    expect(page.getTheme()).toBe("light");
    expect(storage.data.get(SHARED_THEME_STORAGE_KEY)).toBe("auto");
    page.dispose();
  });
  it("follows system changes until chosen and resumes on removal of the saved mode", () => {
    const callbacks = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      matches: true,
      addEventListener(_type: string, listener: EventListenerOrEventListenerObject) { callbacks.add(listener as (event: MediaQueryListEvent) => void); },
      removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) { callbacks.delete(listener as (event: MediaQueryListEvent) => void); },
    };
    const storage = memoryStorage();
    const page = initializePageTheme({ root: document.createElement("section"), storage, eventTarget: window, mediaQuery: media });
    expect(page.getTheme()).toBe("dark");
    const change = (matches: boolean) => { media.matches = matches; for (const callback of callbacks) callback({ matches } as MediaQueryListEvent); };
    change(false); expect(page.getTheme()).toBe("light");
    page.setTheme("dark");
    change(false); expect(page.getTheme()).toBe("dark");
    window.dispatchEvent(new StorageEvent("storage", { key: SHARED_THEME_STORAGE_KEY, newValue: null }));
    expect(page.getTheme()).toBe("light");
    change(true); expect(page.getTheme()).toBe("dark");
    page.dispose(); expect(callbacks.size).toBe(0);
  });
});
