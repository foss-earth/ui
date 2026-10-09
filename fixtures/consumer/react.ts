import { createElement } from "react";
import { SectionsPanel, type PanelSection, DockPanel, TabStrip } from "@foss-earth/ui/react";
const sections: PanelSection[] = [{ id: "host-section", title: "Host", defaultOpen: true, render: () => "Host contribution" }];
createElement(SectionsPanel, { sections, storage: null });
void DockPanel;
void TabStrip;

import { WindowOverlay, type WindowOverlayProps } from "@foss-earth/ui/react";
const overlay: WindowOverlayProps<Tab> = { tabDefinitions: [{ id: "host", label: "Host" }], renderTabContent: () => "Host content", context: { active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "host" }, restorableTabs: new Set(["host"]), storage: null, geometry: { observeWidth: (_element, listener) => { listener(1200); return () => {}; }, menuBottom: () => null }, logSize: { getWidth: () => null, subscribe: () => () => {} }, layoutPort: { publish() {}, clear() {} } };
type Tab = "host";
createElement(WindowOverlay<Tab>, overlay);

import { MeshInspectorPanel, type MeshInspectorPanelPort, type MeshInspectorPanelSnapshot } from "@foss-earth/ui/react";
const snapshot: MeshInspectorPanelSnapshot = { roots: [], enabled: false, error: null };
const inspector: MeshInspectorPanelPort = { getSnapshot: () => snapshot, subscribe: () => () => {}, setSelected() {}, selectAll() {} };
createElement(MeshInspectorPanel, { inspector });
