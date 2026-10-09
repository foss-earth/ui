# @foss-earth/ui

Private staging candidate **0.1.0**, extracted from Earth revision
`90e23b3ee96f53ec5900afc5991a21fffa58649d`, tree
`c68d1fabd9fce19e255ea89c65502666d0f74a27`. This source candidate supplies
settings mechanisms, window state, contributions, generic log, diagnostics/report
views, dial, theme and host-composed overlay. The first foundation slice was
validated; the added mechanisms remain unchecked until their next reserved
check window. This is not a publication-approved release.

YOU CANNOT HAVE AI AS A CO-AUTHOR, OR YOUR CONTRIBUTIONS WILL BE REJECTED.

## Public exports

| Entry | Contract |
| --- | --- |
| `@foss-earth/ui` | Pure settings, window state/context/serialization, contributions, diagnostics and log sizing/defaults/types. |
| `@foss-earth/ui/settings` | Existing registry/parameter/value/preset/migration APIs; explicitly registered `UI_PARAMETERS` and `THEME_LEGACY_MIGRATION`. |
| `@foss-earth/ui/windowing` | Slot/workspace/tab actions, tab availability/conflicts, context hide/restore, panel/viewport/dock allocation, compact fold/restore, record parsing and structural overlay ports. |
| `@foss-earth/ui/contributions` | `createUiContributionRegistry` and typed host/contribution/lifecycle contracts. |
| `@foss-earth/ui/diagnostics` | Pure issue draft/redaction, errors/console capture, report construction, session trail, settings-report redaction, published-version/AppFiles contracts and injected diagnostics lifecycle. |
| `@foss-earth/ui/browser` | Storage/widgets; `createDial`, `wrapTurn` and `Dial*`; injected log/theme/Diagnostics/Bug report/Settings/report views and AppFiles status; clipboard/download/geometry/layout adapters and injected `trackViewportInsets`. |
| `@foss-earth/ui/react` | Generic windows/tabs/SectionsPanel/AdoptedElement plus `WindowOverlay`, `WindowOverlayProps` and event-driven `MeshInspectorPanel` structural snapshot/actions. Requires host React/React DOM peers. |
| `@foss-earth/ui/styles.css`, `@foss-earth/ui/windowing.css`, `@foss-earth/ui/dial.css`, `@foss-earth/ui/log.css`, `@foss-earth/ui/status.css`, `@foss-earth/ui/mesh-inspector.css` | Split generic CSS; the main styles entry imports dial/log/status CSS. |

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
host-supplied callbacks. `UI_PARAMETERS` contains only the existing five UI-owned
IDs: `interface.theme`, `interface.log.lineDuration`, `interface.log.maxLines`,
`diagnostics.trail` and `diagnostics.trailSteps`. Hosts register these explicitly
alongside each owner's contribution; their units/defaults/bounds/homes persist.
UI contains no Earth or flight feature catalogue. `THEME_LEGACY_MIGRATION` reads
the old raw `foss-earth.theme` light/dark value and retains those rollback bytes.

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
are removed. New hosts supply `createParameterSection`'s `document` and `refresh.subscribe`
ports, and the same required ports in `appendHostSections`, so all readings share
the host's refresh authority. Reading callbacks work only while the section is
connected and visible and are stopped by `destroy()`. Omitted `refresh` is rejected before controls are allocated. The previous draft's
implicit one-second interval is removed; hosts supply one shared subscription
and retain their existing cadence. These callbacks request no renderer frames.

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

## Log, diagnostics, theme and host views

`createDial(options)` and `wrapTurn` are browser exports, with `DialMark`,
`DialArc`, `DialTick`, `DialFrame`, `DialKey`, `DialOptions` and `DialHandle`.
Sky supplies its astronomy, clock, formatted readouts and callbacks; UI owns
only cyclic drag/key/mark presentation and label placement. The original dial
behavior and SVG/CSS structures are retained.

`createGameLog(settings, ports)` requires an existing host surface, `copy`,
`onSize`, `viewportHeight`, `isCentered` and `timers.set/clear`. It adopts that
surface and retains progress, busy actions, history, copy confirmation, TTL,
minimize and resize behavior. It never allocates a dock or mounts itself.
`browserGameLogPorts` and `createBrowserClipboard` adapt explicitly supplied
browser objects. The host owns the log and destroys it; diagnostics does not.

`createDiagnostics({settings, log, parts, trailEnvironment, page?, console?})`
records settings/log/errors and composes reports from supplied identity,
device/renderer snapshots, clock and feature state. `attachRuntime` accepts
only `describe/onDeviceLost/onDeviceRestored`; `observeState` takes host text,
`addState` returns an unregister function. The pure `createSessionTrail`
requires its environment, while `createBrowserSessionTrail` is the optional
legacy adapter. The version-1 visit keys, ping protocol, redaction, limits and
unexpected/hidden/closed classification are unchanged. Read-only report visits
leave trail records, including malformed rollback evidence, untouched.

`createThemeController(settings,{root,onChange?})` replaces the eager theme
singleton with an explicit instance. It sets the supplied root's `data-theme`
and light/dark classes and stops subscriptions at `dispose()`.
`createSettingsView(sections,storage,document)` adopts host-owned unique section handles;
it does not register feature parameters. Diagnostics and Bug report factories
receive the report/previous/clipboard source. Bug report receives host issue
identity, `now` and optional object-URL download ports; a missing download or
failed copy keeps the issue gate closed. No report is sent automatically.
`createReportView` also receives `document` and `href`; the host selects
report-only startup, mounts the returned element, calls `show` and destroys it.

`createAppFilesSection(source,published,refresh,document)` displays injected file/version
state and ask/reload actions. It owns no worker, cache, HTTP request, polling
interval or reload policy. Host refreshes update only visible sections; stale
status answers and completions after destruction are ignored. File keeping and
published-version transport remain application/platform responsibilities.

## Generic overlay composition

`WindowOverlay<TabId>` receives every `tabDefinition`, `renderTabContent`,
restorable-tab set and explicit storage. Its `context` supplies active/ready,
base-only/context-only sets and entry tab. `geometry.observeWidth/menuBottom`,
`logSize.getWidth/subscribe`, `layoutPort.publish/clear` and optional focus ports
replace global selectors, events, root style effects and camera operations.
`overlayApiRef` exposes open/select and toolbar toggle; `onBeforeCloseTab` can
veto a close or perform the host's active-image exit. `onTabVisibility` reports
actual visibility and closes all visible contributions on unmount.

Dock/compact allocation, resize ownership, context-hidden tab memory, delayed
entry expansion and base/wide workspace persistence retain source behavior.
The exact 13-tab Earth policy lives only in host fixtures and app composition;
the generic overlay installs no feature tab. It retains the native/React
control key ownership and passes unused camera input through. The host supplies
stable port objects and tab policies for an overlay lifetime and releases its
content handles after unmount. Structural overlay port declarations are pure
windowing exports, so browser declarations do not require React peers.

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
UI_CONSUMER_ARCHIVES=build/consumer-inputs/<release>/archives.json npm run test:consumer
```

`npm run ci` executes those checks once. Typecheck/build cache independently
under `node_modules/.tmp`; lint caches under `node_modules/.cache`. Vitest is
pinned to the current available 4.1.6 runner and caps workers at 50%. The source's
registry, parameter-group, workspace and context tests are retained, with
additional constructor migration, fixture compatibility and lifecycle tests.
Disk fixture paths are explicit `forceRerunTriggers`. No check uses
`--passWithNoTests`.

`test:consumer` now requires an externally prepared complete exact archive closure: current `@foss-earth/ui` 0.1.0, TypeScript 5.9.3 and all 45 React/jsdom/type/transitive packages pinned in `fixtures/consumer/dependency-plan.json`. It has no source-packing, ancestor compiler or dependency-packing fallback. It snapshots the supplied SHA256/size/manifest-verified archives into a fresh dated owner output and installs them offline in one isolated workspace. The run owns fresh cache/tmp directories, sanitizes npm/module configuration and rejects redirected owner output or overwritten evidence. Every physical installed package directory must match its requested manifest name and exact version; undeclared, bundled and nested closures are refused.

Core/browser runtime imports still run with browser-global getters that throw. All peers are physically installed; a required resolver poison rejects React, scheduler, Babylon and feature imports during the pure fixture. Negative controls prove outside files, ancestor packages and real installed React/synthetic feature paths are rejected. The compiler entry and all standard/transitive/ambient/reference declarations must stay inside the installed pinned workspace, with strict library checking and no ancestor-library exception. A complete `createProgram().getSourceFiles()` guard supplements resolution trace checks and outside-file/ancestor-package declaration controls.

The retained fixture assertions check injected registry/contribution identity and lifecycle, workspace/storage defaults, public diagnostic/report identity, widgets/device reports/shared refresh/timers, viewport cleanup, React SSR, overlay and inspector ports, and all six public CSS assets. Every current advertised runtime/declaration/asset target must be physically inside the UI archive, nonempty and match the current public exports map. `typecheck:consumer` is an alias for the same mandatory complete installed harness; `check:implementation` invokes it once through `test:consumer`. [Installed consumer contract](docs/installed-consumer.md) specifies the input schema and pending commands. Receipts and exact retained archive bytes/logs stay in the new `build/consumer/<run>/` folder. These revised guards and fixtures are source-only and UNRUN.

The initial foundation `ci` run passed typecheck and lint and 98/99 tests; a registry-object
deep assertion was corrected to check exact injected object identity. Its eight
contribution tests and the eight React/widget tests then passed, and the affected
lint, build, declarations and installed-artifact checks passed. Retained logs
are under `build/checks/2026-10-09-ui-*.log`; reuse them.
No server, benchmark, browser GPU or native/WASM check is part of this package.

The dial/log/diagnostics/theme/host-view/dock/compact/overlay increment includes
retained source tests plus lifecycle and installed-consumer fixtures. These
added tests, declarations and artifacts have not run yet. The initial artifact
and foundation results do not qualify the increment; a fresh pin is required.

## Remaining acceptance work

- Run the reserved owner checks and isolated installed-consumer harness for
  this increment, then reseal its exact source/artifact/export pin. Current
  app/barrel/catalogue/lockfile integration is primary-owned and remains pending.
- The immutable shared CI caller/policy revision and installed attribution/
  consumer-conformance command are pending from platform. Metadata validation
  must run on docs-only changes. No substitute checker or workflow is included.
- Foundation lineage is imported; additional mixed-file source paths require
  coordinator lineage reconciliation before sealing this increment.
  Clean published-ref audit, remote provisioning
  and actual required-check admission remain pending. `provenance.json` maps
  committed source blobs and transformations; copying code is not history acceptance.
- A local tested tarball and digest are retained in the dated consumer receipt;
  this is not a public release pin. Downstream flight/campus adoption and
  whole-host behavioral acceptance remain pending primary integration.

Source licensing and notices are preserved in LICENSE and NOTICE.


## Source-only finishing receipt and guarded consumer

The frozen foundation remains source `ee3d085f98005cfd9dd7f62066d29f193c8662ed` and archive SHA256 `71bc6508b41a9f7bab8a73cf465474958fb0209a2a431f92277d55ac6c4825f7`. This increment has no new candidate/artifact/adoption pin and no passing check. `SOURCE_RECEIPT.json` seals current source; `fixtures/extraction-increment.json` is the expanded selected-path/partition plan for primary lineage reconciliation. `SOURCE_LINEAGE.json` remains the original foundation record, unchanged by this source writer.

`MeshInspectorPanelPort`, `MeshInspectorPanelSnapshot` and `MeshInspectorPanelNode` are type-only pure-root exports and optional React exports. The host supplies a stable snapshot reference until it changes, a change subscription, and selection actions; UI never disposes that borrowed inspector or changes geometry visibility. Panel detach removes its subscription. The React component and `mesh-inspector.css` preserve the original native checkbox, mixed selection, group expansion and all/none behavior. Actual highlighting/device ownership stays with the host renderer.

`trackViewportInsets(target, view, policy?)` uses supplied DOM/view events and publishes `--foss-inset-bottom`; it starts no timer or render loop. The retained policy caps CSS pixels at 200 and 25% of target height, ignoring pinch scale changes beyond 0.05. The host can supply explicit policy values. Idempotent disposal removes listeners/property and late manual refresh is inert. Real mobile/browser layout qualification is pending.

After the coordinator grants checks and the exact shared CI/dev tools are installed, supply an externally prepared complete archive manifest:

```sh
UI_CONSUMER_ARCHIVES=build/consumer-inputs/<release>/archives.json npm run check:implementation
npm run check:conformance
```

The focused qualifier accepts `node tests/package-consumer.mjs --archives=<JSON>` or `UI_CONSUMER_ARCHIVES`. The closure binds the exact current plan SHA256 and all 47 archive records; each path resolves relative to that JSON or is an explicitly supplied absolute path. Missing UI/compiler records, the former `--dependencies`/`--artifact` fallback interface, unknown or wrong-version packages and unpinned bytes cannot qualify. No older evidence is deleted or overwritten.

`prepare:consumer-dependencies` remains separate INPUT-ONLY tooling. It may pack only the 45 exact installed peer/tool packages into a partial input receipt after a distinct grant. It does not run from any consumer/check chain, omits the current UI and TypeScript archives and cannot pass the complete qualifier. Current installed-tool versions and producer output do not establish admitted release/source lineage or runtime qualification.

The prepared qualifier runs retained Node/jsdom mechanisms, React SSR, strict installed public declarations and CSS assertions. It starts no real browser/server/GPU/native build and qualifies no application composition or hardware/backend. Module/declaration resolution guards do not sandbox arbitrary filesystem/process/network operations inside supplied packages. The optional native `canvas` peer stays excluded. All current source checks and the new complete installed qualifier remain UNRUN, distinct from the immutable foundation's older receipts.

The unchanged unconditional CI caller uses revision `9e046dd482e0229dc7c7b2d71b079d5905664656`, CI archive SHA256 `450ede699f55f9b9c78146eadb73de7c6297e56553e7d7f9e5b164786a7beb24` and policy SHA256 `9ca88bf5861685e22e65e5f39fa65b05faaf9c218875fccbecce1b9f2dca5bd3`. `check:conformance` invokes that actual installed component, with no copied checker. `check:attribution` still needs the primary/coordinator's full intended refs after lineage import; docs-only metadata changes cannot skip admission. Actual hosted required context/settings remain coordinator verification.

Rollback uses the frozen foundation source/artifact or the original immutable blob maps. Hosts adopting this increment must supply shared reading refresh for parameter/host sections, keep the same settings/workspace/presentation storage, and detach borrowed ports before host replacement. Full source checks, exact installed artifacts, common conformance, expanded lineage, full-ref admission, downstream adoption and actual browser layout/device qualification remain outstanding.


Current source DOM boundary: parameter sections require the host Document and pass it through their controls, lists, presets, tracks and help content. Standalone factories take the Document argument documented in [Host DOM contracts](docs/document-ports.md). Dials use their supplied centre ownerDocument; help uses supplied content ownerDocument and its live view, with independent open-help state per Document. Omitted presentation storage comes from that supplied document's origin; explicit null remains memory-only. Reports/diagnostics already accept Document, and log builds from its supplied element. All current source and new causal cases are UNRUN; mock feature fixtures and static inspection do not qualify actual cross-document/browser behavior. Frozen prior archive contracts remain unchanged until a new source/archive/consumer receipt is accepted.


Shared cache summary/progress/list paragraph-grid styling now follows UI in `src/styles/cacheSection.css`, imported by public `./styles.css`; Engine/Scenes retain their data and actions. Original stylesheet provenance is retained. Current CSS build/archive/consumer checks remain UNRUN.

The separate input-only producer now requires [explicit reviewed source roots](docs/consumer-dependency-inputs.md). It inventories nested physical npm packages,
selects the exact planned versions and records rejected alternatives. This fixes
the prior root `lru-cache` 5.1.1 selection when the required 11.3.6 is nested under
jsdom. Its source, archive production and new locator contract remain UNRUN; the
47-record plan, mandatory qualifier, old fixtures and public exports are unchanged.
