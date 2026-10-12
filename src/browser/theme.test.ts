// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry } from "../settings/registry.js";
import { UI_PARAMETERS, THEME_LEGACY_MIGRATION } from "../settings/uiParameters.js";
import { createThemeController, setUiThemePreset, SHARED_THEME_STORAGE_KEY, type ThemeMediaQuery } from "./theme.js";

afterEach(() => { window.localStorage.clear(); });

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

function systemPreference(matches: boolean): ThemeMediaQuery & { change(matches: boolean): void; listeners: Set<(event: MediaQueryListEvent) => void> } {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  return {
    matches, listeners,
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
    change(next) { this.matches = next; for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent); },
  };
}

describe("host theme instance and legacy record", () => {
  it("migrates the original raw theme without deleting rollback bytes, then reloads the same v1 record", () => {
    const data = new Map([["foss-earth.theme", "light"]]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const settings = createSettingsRegistry({ storage }); settings.register(UI_PARAMETERS); settings.migrateLegacy([THEME_LEGACY_MIGRATION]);
    expect(settings.get("interface.theme")).toBe("light"); expect(data.get("foss-earth.theme")).toBe("light");
    const reloaded = createSettingsRegistry({ storage }); reloaded.register(UI_PARAMETERS);
    expect(reloaded.get("interface.theme")).toBe("light");
  });
  it("changes only the supplied root and stops host events and style updates when disposed", () => {
    const settings = createSettingsRegistry({ storage: null }); settings.register(UI_PARAMETERS);
    const root = document.createElement("section"); const other = document.createElement("section");
    const onChange = vi.fn(); const listener = vi.fn();
    const controller = createThemeController(settings, { root, onChange, storage: null, mediaQuery: null, eventTarget: null });
    const stop = controller.onThemeChange(listener);
    expect(root.dataset.theme).toBe("dark"); expect(onChange).not.toHaveBeenCalled();
    expect(controller.toggleTheme()).toBe("light"); expect(root.classList.contains("light")).toBe(true);
    expect(other.hasAttribute("data-theme")).toBe(false); expect(onChange).toHaveBeenCalledWith("light");
    stop(); controller.setTheme("dark"); expect(listener).toHaveBeenCalledTimes(1);
    controller.dispose(); controller.dispose(); settings.set("interface.theme", "light");
    expect(root.dataset.theme).toBe("dark"); expect(onChange).toHaveBeenCalledTimes(2);
    expect(() => controller.toggleTheme()).toThrow("disposed");
  });
  it("uses the system appearance until an explicit choice, including a choice equal to the default", () => {
    const storage = memoryStorage();
    const settings = createSettingsRegistry({ storage }); settings.register(UI_PARAMETERS);
    const media = systemPreference(false);
    const root = document.createElement("section");
    const controller = createThemeController(settings, { root, storage, mediaQuery: media, eventTarget: null, preset: "umn" });
    expect(controller.getTheme()).toBe("light");
    expect(root.dataset.uiTheme).toBe("umn");
    expect(storage.data.has(SHARED_THEME_STORAGE_KEY)).toBe(false);
    media.change(true);
    expect(controller.getTheme()).toBe("dark");
    expect(storage.data.has(SHARED_THEME_STORAGE_KEY)).toBe(false);
    controller.setTheme("dark");
    expect(storage.data.get(SHARED_THEME_STORAGE_KEY)).toBe("dark");
    expect(settings.inspect("interface.theme").layers.saved?.value).toBe("dark");
    media.change(false);
    expect(controller.getTheme()).toBe("dark");
    controller.dispose();
    expect(media.listeners.size).toBe(0);
  });
  it("adopts a page's newer shared mode and receives other-tab changes without changing its brand", () => {
    const storage = memoryStorage();
    const settings = createSettingsRegistry({ storage }); settings.register(UI_PARAMETERS);
    settings.set("interface.theme", "dark");
    storage.data.set(SHARED_THEME_STORAGE_KEY, "light");
    const root = document.createElement("section");
    const controller = createThemeController(settings, { root, storage, eventTarget: window, mediaQuery: null, preset: "umn" });
    expect(controller.getTheme()).toBe("light");
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "dark" }));
    expect(controller.getTheme()).toBe("light");
    window.dispatchEvent(new StorageEvent("storage", { key: SHARED_THEME_STORAGE_KEY, newValue: "dark" }));
    expect(controller.getTheme()).toBe("dark");
    expect(root.dataset.uiTheme).toBe("umn");
    controller.dispose();
    window.dispatchEvent(new StorageEvent("storage", { key: SHARED_THEME_STORAGE_KEY, newValue: "light" }));
    expect(root.dataset.theme).toBe("dark");
    setUiThemePreset(root, "earth");
    expect(root.hasAttribute("data-ui-theme")).toBe(false);
    expect(root.dataset.theme).toBe("dark");
  });
  it("keeps Auto as the choice and follows the system appearance", () => {
    const storage = memoryStorage();
    const settings = createSettingsRegistry({ storage }); settings.register(UI_PARAMETERS);
    const media = systemPreference(true);
    const root = document.createElement("section");
    const controller = createThemeController(settings, { root, storage, mediaQuery: media, eventTarget: null });
    settings.set("interface.theme", "auto");
    expect(controller.getTheme()).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(storage.data.get(SHARED_THEME_STORAGE_KEY)).toBe("auto");
    media.change(false);
    expect(controller.getTheme()).toBe("light");
    expect(settings.get("interface.theme")).toBe("auto");
    expect(storage.data.get(SHARED_THEME_STORAGE_KEY)).toBe("auto");
    controller.setTheme("dark");
    media.change(false);
    expect(controller.getTheme()).toBe("dark");
    expect(settings.get("interface.theme")).toBe("dark");
    controller.dispose();
  });
  it("seeds the shared key from existing saved settings and tolerates inaccessible storage", () => {
    const storage = memoryStorage();
    const settings = createSettingsRegistry({ storage }); settings.register(UI_PARAMETERS);
    settings.set("interface.theme", "light");
    const controller = createThemeController(settings, { root: document.createElement("section"), storage, mediaQuery: systemPreference(true), eventTarget: null });
    expect(storage.data.get(SHARED_THEME_STORAGE_KEY)).toBe("light");
    controller.dispose();
    const unavailable = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const memory = createSettingsRegistry(); memory.register(UI_PARAMETERS);
    const fallback = createThemeController(memory, { root: document.createElement("section"), storage: unavailable, mediaQuery: null, eventTarget: null });
    expect(() => fallback.setTheme("light")).not.toThrow();
    expect(fallback.getTheme()).toBe("light");
    fallback.dispose();
  });
});
