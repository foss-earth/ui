import type { SettingsRegistry } from "../settings/registry.js";
import { formatValue } from "../settings/values.js";
import type { ReportSetting } from "./report.js";
/** A provenance as the report words it. */
const FROM: Record<string, string> = { user: "saved on this device", url: "from the address", preset: "from a preset", host: "set by the app" };

/** Every parameter that someone or something set: what makes this visit differ from a first one. A secret says only whether it is set. */
export function settingsNotAtDefaults(settings: SettingsRegistry): ReportSetting[] {
  const changed: ReportSetting[] = [];
  for (const spec of settings.list()) {
    const state = settings.inspect(spec.id);
    const from = FROM[state.provenance];
    if (from) changed.push({ id: spec.id, value: formatValue(spec, state.value, state.choices), from, defaultValue: formatValue(spec, state.defaultValue, state.choices) });
  }
  return changed;
}

/** Actual registered secrets, including saved and URL layers, to remove from a publication preview. */
export function reportSecrets(settings: SettingsRegistry): string[] {
  return settings.list().filter(spec => spec.sensitive).flatMap(spec => {
    const state = settings.inspect(spec.id);
    return [state.value, ...Object.values(state.layers).map(layer => layer?.value)]
      .filter((value): value is string => typeof value === "string" && value.length > 0);
  });
}

/** Include derived defaults too: another device can have different effective defaults. */
export function effectiveReportSettings(settings: SettingsRegistry): ReportSetting[] {
  return settings.list().map(spec => {
    const state = settings.inspect(spec.id);
    const location = /(?:^|\.)(?:latitude|longitude|lat|lon|latdeg|londeg)(?:\.|$)/i.test(spec.id);
    return {
      id: spec.id,
      value: location ? "omitted from public reports" : formatValue(spec, state.value, state.choices),
      defaultValue: location ? "omitted" : formatValue(spec, state.defaultValue, state.choices),
      from: FROM[state.provenance] ?? `${state.provenance}${state.defaultDerivedFrom ? `: ${state.defaultDerivedFrom}` : ""}`,
    };
  });
}

