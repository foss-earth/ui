/** Shared light/dark mode for static pages. This module has no dependencies. */
export const SHARED_THEME_STORAGE_KEY = "foss-earth.theme";

const mode = value => value === "light" || value === "dark" ? value : null;

function browserStorage(view) {
  try { return view?.localStorage ?? null; } catch { return null; }
}

/** Defaults are derived from the supplied root, so imports need no global browser. */
export function initializePageTheme(ports) {
  const { root } = ports;
  const view = root.ownerDocument.defaultView;
  const storage = ports.storage === undefined ? browserStorage(view) : ports.storage;
  const events = ports.eventTarget === undefined ? view : ports.eventTarget;
  const media = ports.mediaQuery === undefined ? view?.matchMedia?.("(prefers-color-scheme: dark)") ?? null : ports.mediaQuery;
  let chosen = null;
  let disposed = false;
  let current;
  try {
    const raw = storage?.getItem(SHARED_THEME_STORAGE_KEY);
    // Auto, and a missing choice, follow the device. Light and dark are explicit.
    if (raw !== "auto") chosen = mode(raw);
    // Existing viewer preferences also seed pages before the shared key exists.
    if (!chosen && raw !== "auto") {
      const record = JSON.parse(storage?.getItem("foss-earth.settings.v1") ?? "null");
      const saved = record?.version === 1 ? record.values?.["interface.theme"] : null;
      if (saved !== "auto") chosen = mode(saved);
    }
  } catch { /* A page still has a usable theme with unavailable storage. */ }
  const toggles = [...root.querySelectorAll("[data-theme-toggle]")];
  const apply = theme => {
    current = theme;
    root.setAttribute("data-theme", theme);
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    for (const toggle of toggles) {
      toggle.setAttribute("aria-pressed", String(theme === "dark"));
      toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      toggle.setAttribute("title", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      const label = toggle.querySelector("[data-theme-label]");
      // Same marks as the globe toolbar: sun offers light, moon offers dark.
      if (label) label.textContent = theme === "dark" ? "\u263C" : "\u263E";
    }
    ports.onChange?.(theme);
  };
  const setTheme = theme => {
    if (disposed) throw new Error("Page theme controller is disposed.");
    if (!mode(theme)) return;
    chosen = theme;
    try { storage?.setItem(SHARED_THEME_STORAGE_KEY, theme); } catch { /* Best effort. */ }
    apply(theme);
  };
  const toggleTheme = () => { const next = current === "dark" ? "light" : "dark"; setTheme(next); return next; };
  const onToggle = () => { toggleTheme(); };
  const onStorage = event => {
    if (event.key !== SHARED_THEME_STORAGE_KEY || (event.storageArea && event.storageArea !== storage)) return;
    chosen = event.newValue === "auto" ? null : mode(event.newValue);
    apply(chosen ?? (media?.matches ? "dark" : "light"));
  };
  const onSystem = event => { if (!chosen) apply(event.matches ? "dark" : "light"); };
  apply(chosen ?? (media?.matches ? "dark" : "light"));
  for (const toggle of toggles) toggle.addEventListener("click", onToggle);
  events?.addEventListener("storage", onStorage);
  media?.addEventListener("change", onSystem);
  return {
    getTheme: () => current,
    setTheme,
    toggleTheme,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const toggle of toggles) toggle.removeEventListener("click", onToggle);
      events?.removeEventListener("storage", onStorage);
      media?.removeEventListener("change", onSystem);
    },
  };
}

// Linking the asset opts a branded HTML page into the runtime. Core imports in
// Node and unbranded documents perform no work.
if (typeof document !== "undefined" && document.documentElement.hasAttribute("data-ui-theme")) {
  initializePageTheme({ root: document.documentElement });
}
