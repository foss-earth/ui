import type { SettingsRegistry } from "../settings/registry.js";
import type { ParameterValue } from "../settings/types.js";
import { copyValue, formatValue, sameValue } from "../settings/values.js";
import type { GameLog, GameLogEntry, GameLogLine } from "../log/createGameLog.js";
import { captureErrors, tapConsole, type CapturedError } from "./errorCapture.js";
import { buildReport, type ReportParts } from "./report.js";
import { createSessionTrail, describePreviousVisit, TRAIL_STEPS_DEFAULT, type TrailEnvironment } from "./sessionTrail.js";
import { effectiveReportSettings, settingsNotAtDefaults } from "./settingsReport.js";

export const TRAIL_KEPT = "diagnostics.trail";
export const TRAIL_STEPS = "diagnostics.trailSteps";
export interface DiagnosticsRuntime {
  describe(): string;
  onDeviceLost(listener: () => void): () => void;
  onDeviceRestored(listener: () => void): () => void;
}
export interface DiagnosticsOptions {
  settings: SettingsRegistry;
  log: GameLog;
  /** Host supplies identity, browser/device/renderer snapshot, clock and feature state. */
  parts(): Omit<ReportParts, "settings" | "settingsComplete" | "steps" | "errors" | "previous">;
  trailEnvironment: TrailEnvironment;
  page?: Parameters<typeof captureErrors>[0];
  console?: Parameters<typeof tapConsole>[0];
}
const ICON: Record<string, string> = { info: "›", progress: "›", success: "✓", warning: "!", error: "✕" };

/** Generic recorded log/error/settings lifecycle. It starts no application, clock or renderer. */
export function createDiagnostics(options: DiagnosticsOptions) {
  const { settings } = options;
  let disposed = false;
  const stops: (() => void)[] = [];
  const runtimeStops: (() => void)[] = [];
  const stateReaders = new Set<() => Promise<string | null> | string | null>();
  const trail = createSessionTrail({
    app: () => { const parts = options.parts(); return `${parts.appName}, build ${parts.build}, source ${parts.source}, bundle ${parts.bundle}, renderer ${parts.renderer.mode}.`; },
    kept: () => settings.get(TRAIL_KEPT) !== false,
    limit: () => { const value = settings.get(TRAIL_STEPS); return typeof value === "number" ? value : TRAIL_STEPS_DEFAULT; },
    environment: options.trailEnvironment,
  });
  stops.push(settings.watch(TRAIL_KEPT, () => trail.refresh()));
  const previousSettings = new Map<string, ParameterValue>(settings.list().map(spec => [spec.id, copyValue(settings.get(spec.id))]));
  stops.push(settings.subscribe(changed => {
    if (disposed) return;
    for (const id of changed) {
      const next = settings.get(id);
      if (!previousSettings.has(id)) { previousSettings.set(id, copyValue(next)); continue; }
      if (sameValue(previousSettings.get(id), next)) continue;
      previousSettings.set(id, copyValue(next));
      const state = settings.inspect(id);
      const location = /(?:^|\.)(?:latitude|longitude|lat|lon|latdeg|londeg)(?:\.|$)/i.test(id);
      trail.step(`Setting ${id}: ${location ? "location changed (value omitted)" : formatValue(state.spec, next, state.choices)}`);
    }
  }));
  const logStep = (entry: GameLogEntry): void => {
    if (disposed) return;
    const text = `${ICON[entry.tone ?? "info"]} ${entry.text}`;
    if (entry.tone === "warning" || entry.tone === "error") trail.trouble(text); else trail.step(text);
  };
  const log: GameLog = {
    ...options.log,
    get element() { return options.log.element; },
    print(entry) {
      if (disposed) return { update() {}, focusAction() {}, remove() {} };
      logStep(entry);
      const line = options.log.print(entry);
      let tone = entry.tone ?? "info";
      const recording: GameLogLine = { ...line, update(next) {
        if (disposed) return;
        const nextTone = next.tone ?? "info";
        if (nextTone !== tone || nextTone !== "progress") logStep(next);
        tone = nextTone; line.update(next);
      } };
      return recording;
    },
  };
  const errors = new Map<string, { error: CapturedError; count: number; line: GameLogLine }>();
  if (options.page) stops.push(captureErrors(options.page, error => {
    if (disposed) return;
    const key = `${error.message} ${error.where ?? ""}`;
    trail.trouble(`Unhandled ${error.kind}: ${error.message}${error.where ? ` at ${error.where}` : ""}`);
    const errorText = (count: number): string => `The app met an error it did not handle${count > 1 ? `, ${count} times` : ""}: ${error.message}${error.where ? ` (${error.where})` : ""}. Settings → Diagnostics has a report to copy.`;
    const seen = errors.get(key);
    if (!seen) errors.set(key, { error, count: 1, line: options.log.print({ text: errorText(1), tone: "error" }) });
    else { seen.count++; if ((seen.count & (seen.count - 1)) === 0) seen.line.update({ text: errorText(seen.count), tone: "error" }); }
  }));
  if (options.console) stops.push(tapConsole(options.console, (level, text) => { if (!disposed) trail.trouble(`console.${level}: ${text}`); }));
  const previous = trail.previous();
  void previous.then(visit => {
    if (!disposed && visit?.ended === "unexpected") log.print({ text: `${describePreviousVisit(visit)}. Settings → Diagnostics has a report to copy.`, tone: "warning" });
  }, () => {});
  return {
    log, trail,
    attachRuntime(runtime: DiagnosticsRuntime) {
      if (disposed) throw new Error("Diagnostics is disposed.");
      for (const stop of runtimeStops.splice(0)) stop();
      trail.step(runtime.describe()); trail.refresh();
      runtimeStops.push(runtime.onDeviceLost(() => { if (!disposed) log.print({ text: "The GPU stopped drawing for this page: the browser took its device away. The picture returns if the browser gives it back; reloading the page starts again.", tone: "warning" }); }));
      runtimeStops.push(runtime.onDeviceRestored(() => { if (!disposed) log.print({ text: "The GPU is drawing for this page again.", tone: "success" }); }));
    },
    /** Host supplies scene/feature wording and transition steps. */
    observeState(state: string, steps: readonly string[] = []) { if (disposed) return; for (const step of steps) trail.step(step); trail.setState(state); },
    addState(read: () => Promise<string | null> | string | null) {
      if (disposed) throw new Error("Diagnostics is disposed.");
      stateReaders.add(read); return () => { stateReaders.delete(read); };
    },
    previous: () => previous,
    async report(request: { allSettings?: boolean } = {}): Promise<string> {
      if (disposed) throw new Error("Diagnostics is disposed.");
      const parts = options.parts(); const state = [...parts.state];
      for (const read of stateReaders) {
        const value = await Promise.resolve().then(read).catch(() => null);
        if (disposed) throw new Error("Diagnostics is disposed.");
        if (value) state.push(value);
      }
      const visit = await previous.catch(() => null);
      if (disposed) throw new Error("Diagnostics is disposed.");
      return buildReport({ ...parts, state, settings: request.allSettings ? effectiveReportSettings(settings) : settingsNotAtDefaults(settings), settingsComplete: request.allSettings, steps: trail.steps(), errors: [...errors.values()].map(({ error, count }) => ({ ...error, count })), previous: visit });
    },
    destroy() {
      if (disposed) return; disposed = true;
      const failures: unknown[] = [];
      for (const stop of [...runtimeStops.splice(0), ...stops.splice(0)]) {
        try { stop(); } catch (error) { failures.push(error); }
      }
      stateReaders.clear();
      try { trail.dispose(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Diagnostics cleanup failed.");
    },
  };
}
