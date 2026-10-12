export const SHARED_THEME_STORAGE_KEY: "foss-earth.theme";
export interface PageThemePorts {
  root: HTMLElement;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  eventTarget?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  mediaQuery?: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener"> | null;
  onChange?(theme: "light" | "dark"): void;
}
export function initializePageTheme(ports: PageThemePorts): {
  getTheme(): "light" | "dark";
  setTheme(theme: "light" | "dark"): void;
  toggleTheme(): "light" | "dark";
  dispose(): void;
};
