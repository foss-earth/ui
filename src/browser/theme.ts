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

type ThemeChoice = GlobeTheme | "auto";

function storedChoice(value: unknown): ThemeChoice | null {
  return value === "light" || value === "dark" || value === "auto" ? value : null;
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
  let saved: ThemeChoice | null = null;
  try { saved = storedChoice(storage?.getItem(SHARED_THEME_STORAGE_KEY)); } catch { /* Storage is best effort. */ }
  const initial = settings.inspect(id);
  if (ports.preset) setUiThemePreset(ports.root, ports.preset);
  if (saved) settings.set(id, saved);
  else if (!initial.layers.saved && media) {
    followingSystem = true;
    settings.setHostDefault(id, "auto", "The device's light or dark appearance.");
  }
  const readChoice = (): ThemeChoice => {
    const value = settings.get(id);
    return value === "light" || value === "auto" ? value : "dark";
  };
  const resolve = (choice: ThemeChoice): GlobeTheme => choice === "auto" ? (media?.matches ? "dark" : "light") : choice;
  const read = (): GlobeTheme => resolve(readChoice());
  const persist = (choice: ThemeChoice): void => {
    try { storage?.setItem(SHARED_THEME_STORAGE_KEY, choice); } catch { /* Mode still applies when saving fails. */ }
  };
  const notify = (theme: GlobeTheme): void => {
    ports.onChange?.(theme);
    for (const listener of [...listeners]) listener(theme);
  };
  const apply = (): GlobeTheme => {
    const theme = read();
    ports.root.setAttribute("data-theme", theme);
    ports.root.classList.toggle("dark", theme === "dark");
    ports.root.classList.toggle("light", theme === "light");
    return theme;
  };
  apply();
  if (!saved && initial.layers.saved) persist(readChoice());
  const stop = settings.watch(id, () => {
    if (disposed) return;
    const choice = readChoice();
    const theme = apply();
    if (!applyingSystem) {
      if (choice !== "auto") followingSystem = false;
      persist(choice);
    }
    notify(theme);
  });
  const set = (theme: GlobeTheme): void => {
    if (disposed) throw new Error("Theme controller is disposed.");
    if (theme === "light" || theme === "dark") {
      followingSystem = false;
      settings.set(id, theme);
      persist(readChoice());
    }
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== SHARED_THEME_STORAGE_KEY || (event.storageArea && event.storageArea !== storage)) return;
    const next = storedChoice(event.newValue);
    if (next === "auto") settings.set(id, next);
    else if (next) set(next);
  };
  const onSystem = (event: MediaQueryListEvent): void => {
    if (disposed) return;
    if (readChoice() === "auto") {
      const previous = ports.root.getAttribute("data-theme");
      const theme = apply();
      if (theme !== previous) notify(theme);
      return;
    }
    if (!followingSystem) return;
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
