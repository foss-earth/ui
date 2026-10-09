# @foss-earth/ui

Private staging candidate **0.1.0**, extracted from Earth revision
`90e23b3ee96f53ec5900afc5991a21fffa58649d`, tree
`c68d1fabd9fce19e255ea89c65502666d0f74a27`. This foundation slice supplies
settings mechanisms, window state and explicit contribution lifecycle. It is
not the completed UI extraction or a publication-approved release.

YOU CANNOT HAVE AI AS A CO-AUTHOR, OR YOUR CONTRIBUTIONS WILL BE REJECTED.

## Public exports

| Entry | Contract |
| --- | --- |
| `@foss-earth/ui` | Pure union of settings, window state/context/serialization and contributions. |
| `@foss-earth/ui/settings` | Existing `SettingsRegistry`, `SettingsRegistryOptions`, parameter/value/preset/migration types, `createSettingsRegistry`, `linkParameterGroup`, parsing/formatting and validation. |
| `@foss-earth/ui/windowing` | Existing slot/workspace/tab types and state actions, tab availability/conflicts, context hide/restore, pure panel/viewport layout, plus storage-free workspace parsing/serialization. |
| `@foss-earth/ui/contributions` | `createUiContributionRegistry` and typed host/contribution/lifecycle contracts. |
| `@foss-earth/ui/browser` | Optional storage adapters, imperative parameter/section/preset/transfer/saved-settings widgets, choices/tracks/help and section-open persistence. |
| `@foss-earth/ui/react` | Optional generic DockPanel, FloatingWindow, PanelLauncher, TabStrip, WorkspaceDockSlot, useWindowWorkspace, SectionsPanel and AdoptedElement. Requires host-supplied React/React DOM peers. |
| `@foss-earth/ui/styles.css`, `@foss-earth/ui/windowing.css` | Split generic widget/window CSS; feature styles remain with their owners. |

All entries publish ESM JavaScript and TypeScript declarations under `dist/`.
Core entries have no runtime dependency and no React, feature catalogue,
application singleton, renderer or DOM initialization. `URLSearchParams` is a
type accepted by the settings API; callers supply the query explicitly.
The browser entry reads browser storage only when an adapter is called without
an explicit storage argument. It can be imported without browser globals.
React is absent from core/browser imports and is an optional peer for the
separate React entry. The package does not install or initialize React for a
core-only consumer.

## One host settings record

```ts
import { createSettingsRegistry } from "@foss-earth/ui";
import { createBrowserSettingsRegistry } from "@foss-earth/ui/browser";

// Select exactly one constructor for the host, then inject this same object.
const settings = createBrowserSettingsRegistry({
  searchParams: new URLSearchParams(location.search),
});
settings.register(hostParameters);
settings.migrateLegacy(hostMigrations);
settings.registerPresets(hostPresets);

// A non-browser host supplies storage or keeps values in memory.
const memoryOnly = createSettingsRegistry({ storage: null });
```

The source's `SettingsRegistry` identifiers and behavior are retained: saved
values, aliases, device-derived bounds, host defaults/forces, presets, dynamic
choices, source links, readings, session values and secret export exclusion.
The key remains `foss-earth.settings.v1`, the persisted record remains version 1,
and import/export remains `foss-earth.settings` version 1. Migrations remain
host-supplied callbacks; UI owns no Earth or flight parameter catalogue.

**Constructor transition:** the old umbrella `createSettingsRegistry()` chose
browser localStorage when storage was omitted. The new pure core constructor
defaults to memory. Browser consumers must use `createBrowserSettingsRegistry()`
or supply the original storage explicitly to retain saved values. The browser
adapter preserves the old unavailable-storage message. No record conversion or
key change is needed. The transition test writes through the browser adapter
and reloads those exact bytes through the explicitly injected core registry.
`getAppSettings`, host URL rewriting, catalogue construction, app presets and
storage-event wiring are intentionally host composition and are not exports.

Imperative widgets require the same registry as their first argument:
`createParameterControl`, `createParameterList`, `createSettingsTransfer`,
`createParameterSection`, `createPresetsSection` and
`createSavedSettingsSection`. The former singleton defaults on the last three
are removed. The parameter section's existing reading refresh runs only when
the section is connected and visible and is cleared by `destroy()`; extraction
adds no renderer frame requests or separate world timer.

## Contributions and contexts

```ts
import { createUiContributionRegistry } from "@foss-earth/ui";

const ui = createUiContributionRegistry({
  settings,
  ports: { toggleTab, diagnostics },
  context: "globe",
});
const remove = ui.register({
  id: "engine.location",
  tabId: "location",
  label: "Location",
  isAvailable: context => context === "globe",
  create: host => createHostLocationPanel(host),
});
ui.mount("engine.location", panelTarget);
ui.setContext("panorama"); // unmounts without destroying the instance
ui.setContext("globe");    // remounts the same instance at its requested target
remove();                 // unmounts, then disposes once
ui.dispose();             // disposes all remaining instances
```

`create` receives the exact host settings registry and arbitrary typed host
ports. It runs lazily on the first available mount. Each instance supplies
`mount({ context, target })`, `unmount()` and `dispose()`. Section contributions
can share a tab by setting `tabId`/`sectionId`; contribution IDs stay unique.
Changing contexts remounts requested available instances and retains requested
targets while hidden. Explicit unmount cancels that request. Unregistering UI
never unregisters parameters or discards saved values. Failed partial mounts
are unmounted/disposed; final disposal attempts every contribution even when
one host cleanup fails. There is no capture, benchmark, timer or renderer loop.

Hosts register the existing 13 tab IDs and context rules; UI does not redefine
feature ownership. `fixtures/current-tabs.json` captures the current 11-tab
globe and 9-tab panorama availability for contract tests. The host retains the
active-image close/exit action, panorama entry readiness, labels, saved-context
policy and concrete panels. Dev activation belongs to `foss-earth/dev`.

## Workspace persistence and rollback

`WindowSlotId`, `WindowTabDefinition`, `WindowSlotState`,
`WindowWorkspaceState` and every existing workspace state action retain their
identifiers. Generic `hideWorkspaceTabs`/`restoreWorkspaceTabs` retain tab
positions across context changes. `parseSavedWorkspace(raw, restorable)` and
`serializeWorkspace(state)` operate without storage. Optional browser
`loadSavedWorkspace(restorable, storage?)` and `saveWorkspace(state, storage?)`
accept injected storage; omitted storage keeps the old browser default.

The `foss-earth.workspace` key and primary/secondary record shape are unchanged.
One parser defect is corrected: duplicate IDs within the same saved slot are
now removed, as IDs already were across slots and as the old contract promised.
Array-shaped malformed records are rejected. Valid records preserve tab order,
active tab, collapsed state and dimensions. Older hosts can still read written
records. Legacy migration keys remain stored for rollback; this package does
not delete records, prior source or compatibility routes.

Section-open state retains `foss-earth.panelSectionsOpen` and its boolean
record. Hosts can pass explicit storage to `loadPanelSectionsOpen`/
`savePanelSectionsOpen`, `SectionsPanel.storage`,
`createParameterSection`'s `panelStorage`, and `createSectionsElement`'s
`storage` option. `appendHostSections` accepts a fifth `panelStorage` option
for its parameter-section contributions. All omitted presentation-storage
arguments retain the previous browser behavior.

Generic CSS preserves the existing class names and paragraph/grid behavior.
Location/airport/result rules are excluded from UI's window stylesheet. The
host/toolbar supplies its existing `--foss-hud-*` positioning variables;
optional `--globe-accent` uses its existing fallback.

## Build and checks

Install the exact development dependencies and use the coordinator's reserved
check window. The local candidate checks ran on macOS arm64, Node 26.9.0 and npm
11.19.1 with the exact installed development versions in package.json. Other
platforms and Node versions are unqualified; a destination development lock is
still pending. The source uses ES2023 and Node ESM tooling.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run typecheck:consumer
npm run test:consumer
```

`npm run ci` executes those checks once. Typecheck/build cache independently
under `node_modules/.tmp`; lint caches under `node_modules/.cache`. Vitest is
pinned to the current available 4.1.6 runner and caps workers at 50%. The source's
registry, parameter-group, workspace and context tests are retained, with
additional constructor migration, fixture compatibility and lifecycle tests.
Disk fixture paths are explicit `forceRerunTriggers`. No check uses
`--passWithNoTests`.

`test:consumer` packs the built package, installs the artifact offline in a new
workspace with no runtime dependencies, compiles the minimal TypeScript consumer,
and imports each core/browser export with browser-global getters that throw,
then verifies both CSS files exist in the artifact. A Node resolution hook
rejects dependencies outside that consumer directory even though evidence lives
under the owner checkout. Core/browser imports run before peers are installed.
The script then installs locally packed exact React, React DOM, scheduler and
type peers, compiles the React consumer and renders SectionsPanel with injected
storage using React DOM server rendering. It also checks registry identity
across root/subpath imports. Receipts, the tarball,
artifact SHA-256 and logs remain under a new dated `build/consumer/` folder.
The initial `ci` run passed typecheck and lint and 98/99 tests; a registry-object
deep assertion was corrected to check exact injected object identity. Its eight
contribution tests and the eight React/widget tests then passed, and the affected
lint, build, declarations and installed-artifact checks passed. Retained logs
are under `build/checks/2026-10-09-ui-*.log`; reuse them.
No server, benchmark, browser GPU or native/WASM check is part of this package.

## Remaining acceptance work

- The mixed WindowOverlay composition, log/diagnostic/report and Bug report
  presentation still need extraction against these ports. Generic window
  components, layout, Settings mechanisms and widgets are included here.
  No current app, public umbrella barrel, catalogue or lockfile is modified here.
- The immutable shared CI caller/policy revision and installed attribution/
  consumer-conformance command are pending from platform. Metadata validation
  must run on docs-only changes. No substitute checker or workflow is included.
- Coordinator extracted lineage, clean published-ref audit, remote provisioning
  and actual required-check admission remain pending. `provenance.json` maps
  committed source blobs and transformations; copying code is not history acceptance.
- A local tested tarball and digest are retained in the dated consumer receipt;
  this is not a public release pin. Downstream flight/campus adoption and
  whole-host behavioral acceptance remain pending primary integration.

Source licensing and notices are preserved in LICENSE and NOTICE.
