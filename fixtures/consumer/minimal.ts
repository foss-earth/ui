import {
  createSettingsRegistry,
  createUiContributionRegistry,
  createWindowWorkspaceState,
  openOrSelectTabInWorkspace,
  type ParameterSpec,
  type WindowTabDefinition,
} from "@foss-earth/ui";
import { loadSavedWorkspace, saveWorkspace, readDeviceContext, type BrowserDeviceContextPorts } from "@foss-earth/ui/browser";
const devicePorts: BrowserDeviceContextPorts = { navigator: null, window: null };
readDeviceContext(devicePorts);

type Context = "globe" | "image";
type Tab = "settings" | "host-panel";
const settings = createSettingsRegistry({ storage: null });
const parameter: ParameterSpec = {
  id: "host.visible", label: "Visible", description: "The host owns this setting.",
  unit: "none", kind: "boolean", default: true, defaultReason: "Shown initially.",
  home: { tab: "host-panel", section: "display", level: "main" }, appliesLive: true, source: "src/host.ts",
};
settings.register([parameter]);
const contributions = createUiContributionRegistry<Context, { text: string }, { toggleTab(id: Tab): void }>({
  settings, context: "globe", ports: { toggleTab: () => {} },
});
contributions.register({
  id: "host.panel", tabId: "host-panel", sectionId: "display", label: "Host panel",
  create: ({ settings: hostSettings }) => ({
    mount: ({ target }) => { target.text = String(hostSettings.get("host.visible")); },
    unmount: () => {}, dispose: () => {},
  }),
});
const target = { text: "" };
contributions.mount("host.panel", target);
const definitions: readonly WindowTabDefinition<Tab>[] = [{ id: "settings", label: "Settings" }, { id: "host-panel", label: "Host panel" }];
const workspace = openOrSelectTabInWorkspace(createWindowWorkspaceState<Tab>(), "host-panel", "primary", definitions);
saveWorkspace(workspace, null);
loadSavedWorkspace(new Set<Tab>(["settings", "host-panel"]), null);
contributions.dispose();

import { UI_PARAMETERS, THEME_LEGACY_MIGRATION, createSessionTrail, buildReport, createIssueDraft, resolveDockLayout, foldWorkspace, type ReportParts, type TrailEnvironment } from "@foss-earth/ui";
import { createDial, wrapTurn, createGameLog, createThemeController, createSettingsView, createReportView, createAppFilesSection, createParameterSection, type GameLogPorts, type DialFrame } from "@foss-earth/ui/browser";
settings.register(UI_PARAMETERS); settings.migrateLegacy([THEME_LEGACY_MIGRATION]);
function inspectTrail(environment: TrailEnvironment, parts: ReportParts) { const trail = createSessionTrail({ app: () => parts.appName, kept: () => false, limit: () => 80, environment }); trail.step("Host opened"); buildReport({ ...parts, steps: trail.steps() }); trail.dispose(); }
function mountUi(document: Document, logPorts: GameLogPorts, frame: DialFrame) {
  const dial = createDial({ ariaLabel: "Cycle", valueMax: 59, centre: document.createElement("div"), onPress() {}, onDragStart() {}, onDrag() {}, onKey() {}, onMark() {} }); dial.render(frame);
  const log = createGameLog(settings, logPorts); const theme = createThemeController(settings, { root: document.documentElement });
  const source = { report: async () => "Host report", previous: async () => null };
  const report = createReportView(source, { document, href: "https://host.test/?report", now: () => new Date(0) });
  const section = createAppFilesSection({ status: async () => ({ unavailable: null, installed: false, controlling: false, files: 0, bytes: 0 }) }, undefined, { subscribe: () => () => {} }, document);
  const parameters = createParameterSection(settings, { document, tab: "interface", section: "log", panelStorage: null, refresh: { subscribe: () => () => {} } });
  const view = createSettingsView([{ id: "settings.app-files", title: "App files", element: section.element }], null, document);
  return () => { dial.destroy(); log.destroy(); theme.dispose(); report.destroy(); view.destroy(); section.destroy(); parameters.destroy(); };
}
createIssueDraft({ repository: "owner/host", appName: "Host" }, { title: "Issue", description: "Reproduction", report: "Report", filename: "report.txt" });
resolveDockLayout({ availableWidth: 1200, primaryWidth: 320, secondaryWidth: 320, logWidth: null }); foldWorkspace(workspace); wrapTurn(1.25);
void inspectTrail; void mountUi;

import { trackViewportInsets, type ViewportInsetsView, type ViewportInsetPolicy } from "@foss-earth/ui/browser";
function suppliedViewport(target: HTMLElement, view: ViewportInsetsView, policy: ViewportInsetPolicy) { return trackViewportInsets(target, view, policy); }
void suppliedViewport;

import type { MeshInspectorPanelPort as CoreMeshInspectorPort } from "@foss-earth/ui";
const coreInspector: CoreMeshInspectorPort = { getSnapshot: () => ({ roots: [], enabled: false, error: null }), subscribe: () => () => {}, setSelected() {}, selectAll() {} };
void coreInspector;

import { appendHostSections, createSectionsElement } from "@foss-earth/ui/browser";
function suppliedSections(document: Document) {
  const refresh = { subscribe: (listener: () => void) => { void listener; return () => {}; } };
  const sections = createSectionsElement([{ id: "host", title: "Host", element: document.createElement("div") }], { document, storage: null });
  const own = appendHostSections(settings, "host", sections, [], { document, panelStorage: null, refresh });
  return () => { own.destroy(); sections.destroy(); };
}
void suppliedSections;

// Resolve/type-check every pure advertised subpath as a public consumer too;
// importing only the root barrel could conceal a broken subpath declaration.
import * as settingsEntry from "@foss-earth/ui/settings";
import * as windowingEntry from "@foss-earth/ui/windowing";
import * as contributionsEntry from "@foss-earth/ui/contributions";
import * as diagnosticsEntry from "@foss-earth/ui/diagnostics";
const registryEntry: typeof createSettingsRegistry = settingsEntry.createSettingsRegistry;
const workspaceEntry: typeof createWindowWorkspaceState = windowingEntry.createWindowWorkspaceState;
const contributionsEntryFactory: typeof createUiContributionRegistry = contributionsEntry.createUiContributionRegistry;
void registryEntry; void workspaceEntry; void contributionsEntryFactory; void diagnosticsEntry.createDiagnostics;
