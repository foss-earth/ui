import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
// Nested retained evidence must never conceal an undeclared dependency by
// resolving it from an ancestor checkout. Every runtime file stays local.
registerHooks({ resolve(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context);
  if (resolved.url.startsWith("file:") && !fileURLToPath(resolved.url).startsWith(workspaceRoot)) {
    throw new Error(`Dependency escaped the installed consumer: ${specifier}`);
  }
  return resolved;
} });

for (const name of ["window", "document", "navigator", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error(`Unexpected browser access: ${name}`); } });
}
const ui = await import("@foss-earth/ui");
const settings = await import("@foss-earth/ui/settings");
const windowing = await import("@foss-earth/ui/windowing");
const contributions = await import("@foss-earth/ui/contributions");
const browser = await import("@foss-earth/ui/browser");
assert.match(readFileSync(new URL(import.meta.resolve("@foss-earth/ui/styles.css")), "utf8"), /foss-earth-parameter/);
assert.match(readFileSync(new URL(import.meta.resolve("@foss-earth/ui/windowing.css")), "utf8"), /foss-earth-dock-panel/);
assert.equal(ui.createSettingsRegistry, settings.createSettingsRegistry);
assert.equal(ui.createWindowWorkspaceState, windowing.createWindowWorkspaceState);
assert.equal(ui.createUiContributionRegistry, contributions.createUiContributionRegistry);
const registry = ui.createSettingsRegistry();
assert.equal(registry.getStorageError(), null);
const runtime = ui.createUiContributionRegistry({ settings: registry, ports: {}, context: "host" });
let mounted = 0;
let disposed = 0;
runtime.register({
  id: "host.about", tabId: "about", label: "About",
  create: host => {
    assert.equal(host.settings, registry);
    return { mount() { mounted += 1; }, unmount() {}, dispose() { disposed += 1; } };
  },
});
assert.equal(runtime.mount("host.about", {}), true);
assert.equal(mounted, 1);
runtime.dispose();
assert.equal(disposed, 1);
assert.equal(browser.loadSavedWorkspace(new Set(["about"]), null), null);
assert.equal(browser.createBrowserSettingsRegistry({ storage: null }).getStorageError(), null);
process.stdout.write("UI installed-artifact pure imports and injected lifecycle passed.\n");
