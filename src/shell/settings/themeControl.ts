import type { SettingsRegistry } from "../../settings/registry.js";
import { createParameterControl, type ParameterControlHandle } from "./controls.js";

const THEME_ID = "interface.theme";

/** Light, Auto and Dark, in their own section above Interface → Toolbar. */
export function createThemeControl(settings: SettingsRegistry, document: Document): ParameterControlHandle {
  const control = createParameterControl(settings, THEME_ID, document);
  control.element.classList.add("foss-earth-theme-control");
  const update = (): void => { control.update(); };
  update();
  const stopWatching = settings.subscribe(changed => { if (changed.has(THEME_ID)) update(); });
  return {
    element: control.element,
    update,
    destroy() {
      stopWatching();
      control.destroy();
    },
  };
}
