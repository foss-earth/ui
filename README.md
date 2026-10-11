# @foss-earth/ui

Settings, window state, feature contributions, diagnostics and generic UI pieces
for FOSS Earth hosts. The package is host-driven: a host injects its settings
registry, storage, DOM document, timers and ports. UI contains no Earth or flight
feature catalogue, no renderer and no application singleton.

It provides the settings registry and parameter widgets, window and tab workspace
state, a contribution registry with context-based mounting, the game log,
diagnostics and bug-report views, a cyclic dial, theme control, a window overlay
and a mesh inspector panel.

## Public exports

| Entry | Contents |
| --- | --- |
| `@foss-earth/ui` | Pure settings, window state/context/serialization, contributions, diagnostics, and log sizing/defaults/types. |
| `@foss-earth/ui/settings` | Registry, parameter, value, preset and migration APIs; `UI_PARAMETERS` and `THEME_LEGACY_MIGRATION`. |
| `@foss-earth/ui/windowing` | Slot, workspace and tab actions, tab availability and conflicts, context hide/restore, panel/viewport/dock allocation, compact fold/restore, record parsing and structural overlay ports. |
| `@foss-earth/ui/contributions` | `createUiContributionRegistry` and the typed host, contribution and lifecycle contracts. |
| `@foss-earth/ui/diagnostics` | Issue drafts and redaction, error and console capture, report construction, session trail, settings-report redaction, published-version and AppFiles contracts, and the injected diagnostics lifecycle. |
| `@foss-earth/ui/browser` | Storage and widgets; `createDial`, `wrapTurn` and the `Dial*` types; log, theme, Diagnostics, Bug report, Settings and report views; AppFiles status; clipboard, download, geometry and layout adapters; `trackViewportInsets`. |
| `@foss-earth/ui/react` | Generic windows, tabs, `SectionsPanel`, `AdoptedElement`, `WindowOverlay`, `WindowOverlayProps` and the event-driven `MeshInspectorPanel`. Needs the host's React and React DOM. |
| `@foss-earth/ui/styles.css`, `windowing.css`, `dial.css`, `log.css`, `status.css`, `mesh-inspector.css` | Generic CSS. `styles.css` imports the dial, log, status and cache-section styles. |
| `@foss-earth/ui/vite` | Vite helper. |

All entries ship ESM JavaScript and TypeScript declarations under `dist/`. The
core entries have no runtime dependencies and no React, renderer or DOM
initialization. `URLSearchParams` is only a type in the settings API; callers pass
the query explicitly. The browser entry reads browser storage only when an adapter
is called without an explicit storage argument, and it can be imported without
browser globals. React is an optional peer, needed only for the `react` entry.

## Host settings

```ts
import { createSettingsRegistry } from "@foss-earth/ui";
import { createBrowserSettingsRegistry } from "@foss-earth/ui/browser";

// Pick one constructor for the host, then inject that same object everywhere.
const settings = createBrowserSettingsRegistry({
  searchParams: new URLSearchParams(location.search),
});
settings.register(hostParameters);
settings.migrateLegacy(hostMigrations);
settings.registerPresets(hostPresets);

// A non-browser host supplies storage or keeps values in memory.
const memoryOnly = createSettingsRegistry({ storage: null });
```

`SettingsRegistry` supports saved values, aliases, device-derived bounds, host
defaults and forced values, presets, dynamic choices, source links, readings,
session values and secret exclusion on export. The storage key is
`foss-earth.settings.v1`; the persisted record and the import/export format
(`foss-earth.settings`) are version 1. Migrations are host-supplied callbacks.

`UI_PARAMETERS` holds the five UI-owned parameters: `interface.theme`,
`interface.log.lineDuration`, `interface.log.maxLines`, `diagnostics.trail` and
`diagnostics.trailSteps`. Hosts register them explicitly. `THEME_LEGACY_MIGRATION`
reads the old raw `foss-earth.theme` light/dark value.

The core `createSettingsRegistry()` defaults to memory storage. Browser hosts
should use `createBrowserSettingsRegistry()` or pass storage explicitly to keep
saved values. Host URL rewriting, catalogue construction, app presets and
storage-event wiring are host composition and are not exported.

Widgets take the registry as their first argument: `createParameterControl`,
`createParameterList`, `createSettingsTransfer`, `createParameterSection`,
`createPresetsSection` and `createSavedSettingsSection`. `createParameterSection`
and `appendHostSections` require the host's `document` and a `refresh.subscribe`
port, so all readings share one refresh source. Reading callbacks run only while
the section is connected and visible, and stop on `destroy()`. They request no
renderer frames.

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
remove();                  // unmounts, then disposes once
ui.dispose();              // disposes all remaining instances
```

`create` receives the host settings registry and the host's typed ports. It runs
lazily on the first available mount. Each instance supplies `mount({ context,
target })`, `unmount()` and `dispose()`. Contributions can share a tab through
`tabId` and `sectionId`; contribution IDs stay unique. Changing context remounts
the requested instances that are available and remembers their targets while
hidden; an explicit unmount cancels the request. Unregistering a contribution
never unregisters parameters or discards saved values. Failed partial mounts are
unmounted and disposed, and `dispose()` attempts every contribution even if one
cleanup fails.

Hosts register their own tab IDs and context rules. `fixtures/current-tabs.json`
records the Earth host's tab availability (the globe and panorama contexts) for
contract tests. The host keeps the active-image close action, panorama entry
readiness, labels, saved-context policy and the concrete panels.

## Workspace persistence

`WindowSlotId`, `WindowTabDefinition`, `WindowSlotState`, `WindowWorkspaceState`
and the workspace state actions describe window layout. `hideWorkspaceTabs` and
`restoreWorkspaceTabs` keep tab positions across context changes.
`parseSavedWorkspace(raw, restorable)` and `serializeWorkspace(state)` work without
storage. The browser entry adds `loadSavedWorkspace(restorable, storage?)` and
`saveWorkspace(state, storage?)`; omitting storage uses browser storage.

Records are stored under `foss-earth.workspace` in a primary/secondary shape. The
parser removes duplicate tab IDs within a slot and across slots, and rejects
array-shaped records. Valid records keep tab order, active tab, collapsed state
and dimensions.

Section-open state is stored under `foss-earth.panelSectionsOpen` as a boolean
record. Pass explicit storage to `loadPanelSectionsOpen` and `savePanelSectionsOpen`,
`SectionsPanel.storage`, `createParameterSection`'s `panelStorage`,
`createSectionsElement`'s `storage` option, or the fifth `panelStorage` argument
of `appendHostSections`. Omitting it uses the document origin's browser storage;
an explicit `null` keeps the state in memory only.

The generic CSS has no location, airport or result rules. The host or toolbar
supplies the `--foss-hud-*` positioning variables; `--globe-accent` is optional.

## Log, diagnostics, theme and host views

- `createDial(options)` and `wrapTurn` (browser entry) build a cyclic dial with
  drag, keyboard, marks and label placement. The host supplies the readouts and
  callbacks, for example Sky's astronomy and clock.
- `createGameLog(settings, ports)` adopts an existing host surface and needs
  `copy`, `onSize`, `viewportHeight`, `isCentered` and `timers.set/clear` ports;
  an optional `resizesWidth` returns false while its grip may change only the
  height, as in the phone layout. It handles progress, busy actions, history, copy confirmation, line lifetime,
  minimize and resize. It never allocates a dock or mounts itself; the host
  destroys it. `browserGameLogPorts` and `createBrowserClipboard` adapt browser
  objects.
- `createDiagnostics({ settings, log, parts, trailEnvironment, page?, console? })`
  records settings, log lines and errors, and builds reports from the supplied
  identity, device and renderer snapshots, clock and feature state.
  `attachRuntime` accepts `describe`, `onDeviceLost` and `onDeviceRestored`;
  `observeState` takes host text; `addState` returns an unregister function.
  `createSessionTrail` needs its environment passed in; `createBrowserSessionTrail`
  is the browser adapter. Read-only report visits leave stored trail records alone.
- `createThemeController(settings, { root, onChange? })` sets the root's
  `data-theme` and light/dark classes and stops listening on `dispose()`.
- `createSettingsView(sections, storage, document)` adopts host-owned section
  handles; it registers no parameters.
- Diagnostics and Bug report views take the report, previous report and clipboard
  source. Bug report also takes the host's issue identity, `now`, and optional
  object-URL download ports. If a download is missing or the copy fails, the issue
  step stays closed. No report is sent automatically.
- `createReportView` takes `document` and `href`. The host chooses report-only
  startup, mounts the element, calls `show` and destroys it. `destroy()` is
  idempotent and reports cleanup failures together in an `AggregateError`.
- `createAppFilesSection(source, published, refresh, document)` shows injected
  file and version state with ask and reload actions. It owns no worker, cache,
  request, polling or reload policy; those stay with the application.
- `trackViewportInsets(target, view, policy?)` publishes `--foss-inset-bottom`
  from DOM and view events, with no timers. The default policy caps the inset at
  200 CSS pixels and 25% of the target height, and ignores pinch scale changes
  below 0.05.
- `MeshInspectorPanel` (React) shows a host-supplied snapshot with native
  checkboxes, mixed selection, group expansion and all/none. The host keeps the
  snapshot reference stable until it changes and supplies a change subscription
  and selection actions. Highlighting and device ownership stay with the host
  renderer.

More detail: [diagnostics](docs/diagnostics.md), [bug reporting](docs/bug-reporting.md),
[the app's own files](docs/app-files.md), [kept files and published updates](docs/kept-files-and-updates.md)
and [host DOM contracts](docs/document-ports.md).

## Window overlay

`WindowOverlay<TabId>` takes every `tabDefinition`, `renderTabContent`, the
restorable-tab set and explicit storage. Its `context` gives the active and ready
state, the base-only and context-only tab sets, and the entry tab.
`geometry.observeWidth` and `menuBottom`, `logSize.getWidth` and `subscribe`,
`layoutPort.publish` and `clear`, and optional focus ports replace global
selectors, events and camera operations. `overlayApiRef` exposes open, select and
toolbar toggle. `onBeforeCloseTab` can veto a close or run the host's active-image
exit, and `onTabVisibility` reports visibility changes and closes every visible
contribution on unmount.

The overlay handles dock and compact allocation, resizing, context-hidden tab
memory, delayed entry expansion and base/wide workspace persistence. It installs
no feature tabs; the host supplies tab policy and stable port objects for the
overlay's lifetime, and releases its content handles after unmount. Camera input
the overlay does not use passes through. Structural overlay port types are
exported from the windowing entry, so browser declarations do not need React.

Below 516 CSS pixels, the phone layout puts a full-width tab window above the
full-width log. Their grips sit mid-bottom and change only the height. The
window uses at most half the viewport height, and
`geometry.observeHeight` keeps the log below its current height when resized,
minimized or restored; the browser geometry adapter supplies this observer.
Custom geometry ports can omit it to use the window element's browser observer.
Wider screens retain the log beside one window, or centered between two windows
when they fit. Windows keep the widths they are given: widening one of two past
the room for both keeps it on its side with the other's tabs and the log beside
it, against the other edge, and widening it further puts the log under it, as
wide as it. A resized log does not shrink that window to bring the other back.
Tabs return to their saved windows when there is room for both again.

## Development

UI has no `@foss-earth/*` dependencies, so its own scripts work from a plain
checkout. Libraries are usually developed through the app, which uses them from
their checkouts (see [app, Local source](https://github.com/foss-earth/app#local-source)).

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run build` compiles with `tsc` into `dist/` and copies the CSS assets. The
code targets ES2023 and Node ESM tooling. Tests use Vitest with jsdom. No test
needs a browser, server, GPU or native build.

Source licensing and notices are in [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Project policies

- [Code of conduct](https://github.com/foss-earth/.github/blob/main/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/foss-earth/.github/blob/main/CONTRIBUTING.md)
- [AGPL-3.0 license](LICENSE)
- [Security](https://github.com/foss-earth/.github/blob/main/SECURITY.md)
