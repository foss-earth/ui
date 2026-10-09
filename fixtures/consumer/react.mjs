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
