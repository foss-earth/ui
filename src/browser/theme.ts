import type { SettingsRegistry } from "../settings/registry.js";
import type { SettingsStorage } from "../settings/registry.js";

export type GlobeTheme = "light" | "dark";
export type UiThemePreset = "earth" | "umn";
/** Shared with static hosts; brand selection is independent of this mode. */
export const SHARED_THEME_STORAGE_KEY = "foss-earth.theme";
export interface ThemeStorageEvents {
  addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
}
export interface ThemeMediaQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: MediaQueryListEvent) => void): void;
  removeEventListener(type: "change", listener: (event: MediaQueryListEvent) => void): void;
}
export interface ThemePorts {
  root: HTMLElement;
  /** Defaults to the supplied root's window. Null keeps mode in memory. */
  storage?: SettingsStorage | null;
  eventTarget?: ThemeStorageEvents | null;
  /** Used as the default until a mode is chosen; null preserves the registry default. */
  mediaQuery?: ThemeMediaQuery | null;
  preset?: UiThemePreset;
  /** Optional host event bridge; no global event target is assumed. */
  onChange?(theme: GlobeTheme): void;
}

/** Named palettes only set CSS tokens; a host can also provide its own token overrides. */
export function setUiThemePreset(root: HTMLElement, preset: UiThemePreset): void {
  if (preset === "earth") root.removeAttribute("data-ui-theme");
  else root.setAttribute("data-ui-theme", preset);
}

function themeValue(value: unknown): GlobeTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

function rootStorage(root: HTMLElement): SettingsStorage | null {
  try { return root.ownerDocument.defaultView?.localStorage ?? null; }
  catch { return null; }
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
  const view = ports.root.ownerDocument.defaultView;
  const storage = ports.storage === undefined ? rootStorage(ports.root) : ports.storage;
  const events: ThemeStorageEvents | null = ports.eventTarget === undefined ? view : ports.eventTarget;
  const media: ThemeMediaQuery | null = ports.mediaQuery === undefined ? view?.matchMedia?.("(prefers-color-scheme: dark)") ?? null : ports.mediaQuery;
  let disposed = false;
  let followingSystem = false;
  let applyingSystem = false;
  let saved: GlobeTheme | null = null;
  try { saved = themeValue(storage?.getItem(SHARED_THEME_STORAGE_KEY)); } catch { /* Storage is best effort. */ }
  const initial = settings.inspect(id);
  if (ports.preset) setUiThemePreset(ports.root, ports.preset);
  if (saved) settings.set(id, saved);
  else if (!initial.layers.saved && media) {
    followingSystem = true;
    settings.setHostDefault(id, media.matches ? "dark" : "light", "The device's light or dark appearance.");
  }
  const read = (): GlobeTheme => settings.get(id) === "light" ? "light" : "dark";
  const persist = (theme: GlobeTheme): void => {
    try { storage?.setItem(SHARED_THEME_STORAGE_KEY, theme); } catch { /* Mode still applies when saving fails. */ }
  };
  const apply = (): GlobeTheme => {
    const theme = read();
    ports.root.setAttribute("data-theme", theme);
    ports.root.classList.toggle("dark", theme === "dark");
    ports.root.classList.toggle("light", theme === "light");
    return theme;
  };
  apply();
  if (!saved && initial.layers.saved) persist(read());
  const stop = settings.watch(id, () => {
    if (disposed) return;
    const theme = apply();
    if (!applyingSystem) { followingSystem = false; persist(theme); }
    ports.onChange?.(theme);
    for (const listener of [...listeners]) listener(theme);
  });
  const set = (theme: GlobeTheme): void => {
    if (disposed) throw new Error("Theme controller is disposed.");
    if (theme === "light" || theme === "dark") {
      followingSystem = false;
      settings.set(id, theme);
      persist(read());
    }
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== SHARED_THEME_STORAGE_KEY || (event.storageArea && event.storageArea !== storage)) return;
    const next = themeValue(event.newValue);
    if (next) set(next);
  };
  const onSystem = (event: MediaQueryListEvent): void => {
    if (!followingSystem || disposed) return;
    applyingSystem = true;
    try { settings.setHostDefault(id, event.matches ? "dark" : "light", "The device's light or dark appearance."); }
    finally { applyingSystem = false; }
  };
  events?.addEventListener("storage", onStorage);
  media?.addEventListener("change", onSystem);
  return {
    getTheme: read,
    setTheme: set,
    toggleTheme() { const theme = read() === "dark" ? "light" : "dark"; set(theme); return theme; },
    onThemeChange(listener) {
      if (disposed) throw new Error("Theme controller is disposed.");
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true; stop(); listeners.clear();
      events?.removeEventListener("storage", onStorage);
      media?.removeEventListener("change", onSystem);
    },
  };
}
