// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createSettingsRegistry } from "../settings/registry.js";
import { UI_PARAMETERS, THEME_LEGACY_MIGRATION } from "../settings/uiParameters.js";
import { createThemeController } from "./theme.js";

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
    const controller = createThemeController(settings, { root, onChange });
    const stop = controller.onThemeChange(listener);
    expect(root.dataset.theme).toBe("dark"); expect(onChange).not.toHaveBeenCalled();
    expect(controller.toggleTheme()).toBe("light"); expect(root.classList.contains("light")).toBe(true);
    expect(other.hasAttribute("data-theme")).toBe(false); expect(onChange).toHaveBeenCalledWith("light");
    stop(); controller.setTheme("dark"); expect(listener).toHaveBeenCalledTimes(1);
    controller.dispose(); controller.dispose(); settings.set("interface.theme", "light");
    expect(root.dataset.theme).toBe("dark"); expect(onChange).toHaveBeenCalledTimes(2);
    expect(() => controller.toggleTheme()).toThrow("disposed");
  });
});
