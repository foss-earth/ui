import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { WindowOverlay, type WindowOverlayHandle } from "../../src/shell/WindowOverlay.js";
import { AdoptedElement } from "../../src/shell/AdoptedElement.js";
import { SectionsPanel, type PanelSection } from "../../src/shell/SectionsPanel.js";
import { browserOverlayGeometry, browserOverlayLayout } from "../../src/browser/overlay.js";
import { GAME_LOG_SIZE_EVENT, type GameLogSizeChange } from "../../src/log/createGameLog.js";
import type { WindowTabDefinition } from "../../src/windowing/core/types.js";
type BuiltIn = "location" | "controls" | "interface" | "settings" | "map" | "renderer" | "sky" | "time" | "scenes" | "about" | "bug-report" | "panorama" | "panorama-settings";
export type FixtureOverlayHandle<T extends string = never> = WindowOverlayHandle<BuiltIn | T>;
export interface SphereTabsSnapshot { title: string | null; onScreen: boolean }
export interface SphereTabs { sphere: HTMLElement; settings: HTMLElement; getSnapshot(): SphereTabsSnapshot; subscribe(listener: () => void): () => void; leave(): void; destroy(): void }
interface Props<T extends string> {
  getViewState(): unknown; setViewState(value: unknown): void;
  additionalTabs?: readonly WindowTabDefinition<T>[];
  renderAdditionalTab?(id: T): ReactNode;
  controlsSections?: readonly PanelSection[]; interfaceSections?: readonly PanelSection[]; settingsSections?: readonly PanelSection[];
  mapTab?: HTMLElement; rendererTab?: HTMLElement; skyTab?: HTMLElement; timeTab?: HTMLElement; scenesTab?: HTMLElement; aboutTab?: HTMLElement; bugReportTab?: HTMLElement;
  onBugReportShow?(): void; sphereTabs?: SphereTabs;
  overlayApiRef?: { current: FixtureOverlayHandle<T> | null };
  onBeforeCloseTab?(tab: BuiltIn | T): boolean | void;
}
const OUTSIDE: SphereTabsSnapshot = { title: null, onScreen: false };
/** Exact default Earth tab policy belongs in this host fixture, never in UI runtime. */
export function FixtureOverlay<T extends string = never>(props: Props<T>) {
  const subscribe = useCallback((listener: () => void) => props.sphereTabs?.subscribe(listener) ?? (() => {}), [props.sphereTabs]);
  const read = useCallback(() => props.sphereTabs?.getSnapshot() ?? OUTSIDE, [props.sphereTabs]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const elements: Partial<Record<BuiltIn, HTMLElement>> = { map: props.mapTab, renderer: props.rendererTab, sky: props.skyTab, time: props.timeTab, scenes: props.scenesTab, about: props.aboutTab, "bug-report": props.bugReportTab, "panorama": props.sphereTabs?.sphere, "panorama-settings": props.sphereTabs?.settings };
  const sections: Partial<Record<BuiltIn, readonly PanelSection[]>> = { controls: props.controlsSections, interface: props.interfaceSections, settings: props.settingsSections };
  const labels: Record<BuiltIn, string> = { location: "Location", controls: "Controls", interface: "Interface", settings: "Settings", map: "Map", renderer: "Renderer", sky: "Sky", time: "Date and time", scenes: "Scenes", about: "About", "bug-report": "Bug report", "panorama": snapshot.title ?? "360", "panorama-settings": "360 image settings" };
  const builtIn = (Object.keys(labels) as BuiltIn[]).filter(id => id === "location" || elements[id] || sections[id]);
  const definitions: WindowTabDefinition<BuiltIn | T>[] = [...builtIn.map(id => ({ id, label: labels[id] })), ...(props.additionalTabs ?? []).filter(tab => !builtIn.includes(tab.id as BuiltIn))];
  const ports = useMemo(() => ({
    geometry: browserOverlayGeometry(window, () => { const bar = document.querySelector(".hud-bar")?.getBoundingClientRect(); return bar && bar.height > 0 ? bar.top : null; }),
    layoutPort: browserOverlayLayout(document.documentElement),
    logSize: { getWidth: () => null, subscribe: (listener: (change: GameLogSizeChange) => void) => { const heard = (event: Event): void => listener((event as CustomEvent<GameLogSizeChange>).detail); window.addEventListener(GAME_LOG_SIZE_EVENT, heard); return () => window.removeEventListener(GAME_LOG_SIZE_EVENT, heard); } },
  }), []);
  const visible = useCallback((id: BuiltIn | T, shown: boolean) => { if (id === "bug-report" && shown) props.onBugReportShow?.(); }, [props.onBugReportShow]);
  return <WindowOverlay<BuiltIn | T> {...ports} storage={localStorage} restorableTabs={new Set(definitions.filter(tab => tab.id !== "panorama" && tab.id !== "panorama-settings").map(tab => tab.id))}
    tabDefinitions={definitions} context={{ active: snapshot.title !== null, ready: snapshot.onScreen, baseOnlyTabs: new Set(["location", "map", "sky", "time"]), contextOnlyTabs: new Set(["panorama", "panorama-settings"]), entryTabId: "panorama" }} overlayApiRef={props.overlayApiRef}
    onTabVisibility={visible} onBeforeCloseTab={id => { if (props.onBeforeCloseTab?.(id) === false) return false; if (id === "panorama") props.sphereTabs?.leave(); }}
    renderTabContent={id => sections[id as BuiltIn] ? <SectionsPanel sections={sections[id as BuiltIn]!} storage={null} /> : elements[id as BuiltIn] ? <AdoptedElement element={elements[id as BuiltIn]!} className="foss-earth-element-tab" /> : id === "location" ? <p>Host location content</p> : props.renderAdditionalTab?.(id as T)} />;
}
