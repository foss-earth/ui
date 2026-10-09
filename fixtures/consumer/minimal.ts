import {
  createSettingsRegistry,
  createUiContributionRegistry,
  createWindowWorkspaceState,
  openOrSelectTabInWorkspace,
  type ParameterSpec,
  type WindowTabDefinition,
} from "@foss-earth/ui";
import { loadSavedWorkspace, saveWorkspace } from "@foss-earth/ui/browser";

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
