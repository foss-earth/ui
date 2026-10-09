import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>", { url: "https://host.test/?dev=1" });
const { window } = dom, { document } = window;
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent", "KeyboardEvent", "Node", "MutationObserver"]) Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? window : name === "document" ? document : window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ui = await import("@foss-earth/ui");
const browser = await import("@foss-earth/ui/browser");
const reactUi = await import("@foss-earth/ui/react");
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const cleanups = [], ticks = new Set(), timers = new Map();
let nextTimer = 0;
const errors = [];
const refresh = { subscribe(listener) { ticks.add(listener); let stopped = false; return () => { if (!stopped) { stopped = true; ticks.delete(listener); } }; } };
const pulse = () => { for (const listener of [...ticks]) listener(); };
const settle = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };
try {
  assert.deepEqual(browser.readDeviceContext({ navigator: { hardwareConcurrency: 6, maxTouchPoints: 2, deviceMemory: 8 }, window: { devicePixelRatio: 1.5 } }), { devicePixelRatio: 1.5, hardwareConcurrency: 6, deviceMemoryGiB: 8, touch: true });
  const settings = ui.createSettingsRegistry({ storage: null }); settings.register(ui.UI_PARAMETERS);
  settings.register([{ id: "host.cost", label: "Cost", description: "Host reading.", unit: "ms", kind: "number", bounds: () => ({ min: 0, max: 100 }), default: 1, defaultReason: "Host default.", home: { tab: "host", section: "cost", level: "main" }, appliesLive: true, source: "src/host.ts" }]);
  let reading = "First reading"; settings.setReadingSource("host.cost", () => reading);
  const parameters = browser.createParameterSection(settings, { document, tab: "host", section: "cost", panelStorage: null, refresh }); cleanups.push(() => parameters.destroy());
  document.body.append(parameters.element); reading = "Shared host reading"; pulse(); assert.match(parameters.element.textContent, /Shared host reading/);
  const sections = browser.createSectionsElement([{ id: "host.cost", title: "Cost", element: parameters.element, defaultOpen: true }], { document, storage: null }); cleanups.push(() => sections.destroy()); document.body.append(sections.element);
  const theme = browser.createThemeController(settings, { root: document.documentElement }); cleanups.push(() => theme.dispose()); theme.setTheme("light"); assert.equal(document.documentElement.dataset.theme, "light");
  const dial = browser.createDial({ ariaLabel: "Host cycle", valueMax: 59, centre: document.createElement("span"), onPress() {}, onDragStart() {}, onDrag() {}, onKey() {}, onMark() {} }); cleanups.push(() => dial.destroy()); document.body.append(dial.element);
  dial.render({ turn: 0.25, valueNow: 15, valueText: "Fifteen", arcs: [], ticks: [], marks: [] }); assert.equal(dial.element.querySelector('[role="slider"]').getAttribute("aria-valuenow"), "15");
  const log = browser.createGameLog(settings, { element: document.createElement("div"), copy: async () => {}, onSize() {}, viewportHeight: () => 800, isCentered: () => false, timers: { set(work, ms) { const id = ++nextTimer; timers.set(id, { work, ms }); return id; }, clear(id) { timers.delete(id); } } }); cleanups.push(() => log.destroy()); document.body.append(log.element);
  const parts = () => ({ appName: "Host", at: new Date(0), page: "https://host.test/", build: "host-build", source: "host-source", bundle: "host.js", userAgent: "Unit fixture", screen: { width: 0, height: 0, devicePixelRatio: 1, touch: false }, device: { cores: null, memoryGiB: null }, renderer: { asked: "not started", mode: "not started", driver: null, maxTextureSize: null, fallbackReason: null, lost: 0 }, state: ["Host state"] });
  const diagnostics = ui.createDiagnostics({ settings, log, parts, trailEnvironment: { storage: null, onStorage: () => () => {}, now: () => 0, elapsed: () => 0, newId: () => "host-unit-trail", defer: work => queueMicrotask(work), wait: async () => {} } }); cleanups.push(() => diagnostics.destroy()); diagnostics.log.print({ text: "Host opened", tone: "info" }); assert.match(await diagnostics.report(), /^Host report/);
  const source = { report: request => diagnostics.report(request), previous: () => diagnostics.previous(), copy: async () => {} };
  const diagnosticSection = browser.createDiagnosticsSection(source, { document }); cleanups.push(() => diagnosticSection.destroy()); document.body.append(diagnosticSection.element);
  const bug = browser.createBugReportPanel(source, { document, now: () => new Date(0), issueReporter: { repository: "owner/host", appName: "Host" }, downloads: { create: () => "blob:host-unit-report", revoke() {} } }); cleanups.push(() => bug.destroy()); bug.show(); await settle(); assert.match(bug.element.querySelector('textarea[name="report"]').value, /Host report/);
  const report = browser.createReportView(source, { document, href: "https://host.test/?report&dev=1", now: () => new Date(0) }); cleanups.push(() => report.destroy()); report.show(); await settle(); assert.equal(report.element.querySelector("a").href, "https://host.test/?dev=1");
  const appFiles = browser.createAppFilesSection({ status: async () => ({ unavailable: null, installed: true, controlling: true, files: 2, bytes: 32 }) }, undefined, refresh, document); cleanups.push(() => appFiles.destroy()); document.body.append(appFiles.element); await settle(); pulse(); await settle(); assert.match(appFiles.element.textContent, /2 files/);
  const settingsView = browser.createSettingsView([{ id: "settings.app-files", title: "App files", element: appFiles.element }], null, document); cleanups.push(() => settingsView.destroy()); document.body.append(settingsView.element); assert.ok(settingsView.element.contains(appFiles.element));
  const viewport = Object.assign(new window.EventTarget(), { scale: 1, height: 720, offsetTop: 0 });
  const view = new window.EventTarget(); view.visualViewport = viewport; const insetTarget = document.createElement("div"); Object.defineProperty(insetTarget, "clientHeight", { value: 800 });
  const insets = browser.trackViewportInsets(insetTarget, view); cleanups.push(() => insets.dispose()); assert.equal(insetTarget.style.getPropertyValue(browser.VIEWPORT_INSET_BOTTOM_PROPERTY), "80px"); viewport.height = 800; viewport.dispatchEvent(new window.Event("resize")); assert.equal(insetTarget.style.getPropertyValue(browser.VIEWPORT_INSET_BOTTOM_PROPERTY), "0px");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); cleanups.push(() => act(async () => root.unmount()));
  let snapshot = { roots: [{ id: 1, name: "Host mesh", mesh: true, selected: true, mixed: false, children: [] }], enabled: true, error: null }, selection = null; const listeners = new Set();
  const inspector = { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, setSelected(id, selected) { selection = [id, selected]; }, selectAll(selected) { selection = ["all", selected]; } };
  await act(async () => root.render(createElement(reactUi.MeshInspectorPanel, { inspector }))); await act(async () => host.querySelector('input[type="checkbox"]').click()); assert.deepEqual(selection, [1, false]);
  await act(async () => { snapshot = { ...snapshot, enabled: false }; for (const update of listeners) update(); }); assert.match(host.textContent, /Enable polygon edges/);
  await act(async () => root.render(createElement(reactUi.WindowOverlay, { tabDefinitions: [{ id: "host", label: "Host" }], renderTabContent: () => "Host tab", context: { active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "host" }, restorableTabs: new Set(["host"]), storage: null, geometry: { observeWidth(_element, listener) { listener(1200); return () => {}; }, menuBottom: () => null }, logSize: { getWidth: () => null, subscribe: () => () => {} }, layoutPort: { publish() {}, clear() {} } }))); assert.ok(host.querySelector(".foss-earth-window-overlay")); assert.equal(listeners.size, 0);
  process.stdout.write("Installed UI widgets used supplied settings/refresh/timers/report/device snapshots and React structural ports. No browser, renderer or network started.\n");
} catch (error) {
  errors.push(error);
} finally {
  for (const dispose of cleanups.reverse()) { try { await dispose(); } catch (error) { errors.push(error); } }
  try { dom.window.close(); } catch (error) { errors.push(error); }
  try { assert.equal(ticks.size, 0); } catch (error) { errors.push(error); }
  try { assert.equal(timers.size, 0); } catch (error) { errors.push(error); }
}
if (errors.length) throw new AggregateError(errors, "Consumer fixture or cleanup failed");
