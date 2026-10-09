import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const workspaceRoot = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
registerHooks({ resolve(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context);
  if (resolved.url.startsWith("file:") && !fileURLToPath(resolved.url).startsWith(workspaceRoot)) throw new Error(`Dependency escaped consumer: ${specifier}`);
  return resolved;
} });
for (const name of ["window", "document", "navigator", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error(`Unexpected browser access: ${name}`); } });
}
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const ui = await import("@foss-earth/ui/react");
const html = renderToStaticMarkup(createElement(ui.SectionsPanel, { sections: [{ id: "host-section", title: "Host", defaultOpen: true, render: () => "Host contribution" }], storage: null }));
assert.match(html, /Host/);
assert.equal(typeof ui.DockPanel, "function");
assert.equal(typeof ui.WorkspaceDockSlot, "function");
assert.equal(typeof ui.TabStrip, "function");
process.stdout.write("UI installed-artifact React entry and server rendering passed with local peers.\n");

const overlay = renderToStaticMarkup(createElement(ui.WindowOverlay, { tabDefinitions: [{ id: "host", label: "Host" }], renderTabContent: () => "Host content", context: { active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "host" }, restorableTabs: new Set(["host"]), storage: null, geometry: { observeWidth: () => { throw new Error("SSR must not observe browser width"); }, menuBottom: () => null }, logSize: { getWidth: () => null, subscribe: () => { throw new Error("SSR must not subscribe"); } }, layoutPort: { publish() { throw new Error("SSR must not publish layout"); }, clear() {} } }));
assert.match(overlay, /foss-earth-window-overlay/);
process.stdout.write("UI host-driven overlay server rendering passed without browser globals.\n");

const snapshot = { roots: [{ id: 1, name: "Host mesh", mesh: true, selected: false, mixed: false, children: [] }], enabled: true, error: null };
const inspector = { getSnapshot: () => snapshot, subscribe() { throw new Error("SSR must not subscribe to the host inspector"); }, setSelected() { throw new Error("SSR must not select meshes"); }, selectAll() { throw new Error("SSR must not select meshes"); } };
const mesh = renderToStaticMarkup(createElement(ui.MeshInspectorPanel, { inspector }));
assert.match(mesh, /Host mesh/); assert.match(mesh, /Selection does not hide geometry/);
process.stdout.write("UI public MeshInspectorPanel SSR uses supplied snapshot without renderer or subscription.\n");
