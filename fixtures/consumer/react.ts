import { createElement } from "react";
import { SectionsPanel, type PanelSection, DockPanel, TabStrip } from "@foss-earth/ui/react";
const sections: PanelSection[] = [{ id: "host-section", title: "Host", defaultOpen: true, render: () => "Host contribution" }];
createElement(SectionsPanel, { sections, storage: null });
void DockPanel;
void TabStrip;
