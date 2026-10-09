import type { SettingsRegistry } from "../settings/registry.js";

export type GlobeTheme = "light" | "dark";
export interface ThemePorts {
  root: HTMLElement;
  /** Optional host event bridge; no global event target is assumed. */
  onChange?(theme: GlobeTheme): void;
}
export interface ThemeController {
  getTheme(): GlobeTheme;
  setTheme(theme: GlobeTheme): void;
  toggleTheme(): GlobeTheme;
  onThemeChange(listener: (theme: GlobeTheme) => void): () => void;
  dispose(): void;
}

/** Explicit instance of the former theme singleton, bound to the supplied host. */
export function createThemeController(settings: SettingsRegistry, ports: ThemePorts): ThemeController {
  const id = "interface.theme";
  const listeners = new Set<(theme: GlobeTheme) => void>();
  let disposed = false;
  const read = (): GlobeTheme => settings.get(id) === "light" ? "light" : "dark";
  const apply = (): GlobeTheme => {
    const theme = read();
    ports.root.setAttribute("data-theme", theme);
    ports.root.classList.toggle("dark", theme === "dark");
    ports.root.classList.toggle("light", theme === "light");
    return theme;
  };
  apply();
  const stop = settings.watch(id, () => {
    if (disposed) return;
    const theme = apply();
    ports.onChange?.(theme);
    for (const listener of [...listeners]) listener(theme);
  });
  const set = (theme: GlobeTheme): void => {
    if (disposed) throw new Error("Theme controller is disposed.");
    if (theme === "light" || theme === "dark") settings.set(id, theme);
  };
  return {
    getTheme: read,
    setTheme: set,
    toggleTheme() { const theme = read() === "dark" ? "light" : "dark"; set(theme); return theme; },
    onThemeChange(listener) {
      if (disposed) throw new Error("Theme controller is disposed.");
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    dispose() { if (disposed) return; disposed = true; stop(); listeners.clear(); },
  };
}
