# Kept files and published updates

Status: implemented shared source; new tests/consumers/builds are UNRUN.

`@foss-earth/ui/browser` exports `createKeptFilesClient(KeptFilesClientOptions)`,
`askPublishedVersion(PublishedVersionReadPorts, options?)` and
`createPublishedVersionWatcher(PublishedVersionWatchOptions)`. Core/browser
imports construct no globe, viewer, scheduler, device or Dev session. UI borrows
host browser/storage/transport/timer/settings observers; it infers no app identity.

The kept-file client takes worker URL, scope, service-worker/cache ports,
loaded-file/controller/load observers, enabled policy, cache namespace and optional
message identity/abort signal. It supplies `status`, legacy `settled`, truthful
`whenSettled` and `dispose`. Registration is actually awaited even during disposal;
activation observation may be abandoned without pretending registration ended.
Opt-out attempts worker notification, unregister and this deployment's cache
removal, retaining every error. Foreign worker/cache ownership is not adopted.
Disposing the page client removes its observers; it does not automatically opt
out of a visitor's persistent worker choice.

The published watcher supplies `state`, `subscribe`, `ask`, `now`, explicit
`reload`, `dispose`, `whenSettled`. Checking, return-to-page and cadence never
reload. Stamps, comparison and read-page behavior are injected; About retains
build/source stamp ownership. Disable/reenable prevents a stale transport response
from changing the new state. Cancellation/deadline aborts the actual transport;
settlement waits its real completion. A host chooses when to offer/call reload.
Earth's existing untouched-user automatic reload logic stays in App's explicit
policy; Campus uses an explicit reload action.

## Optional Node/Vite producer

`@foss-earth/ui/vite` exports `APP_FILES_WORKER`,
`appFilesWorker(names, KeptFilesProducerOptions)` and `appFiles(KeptFilesPlugin)`.
This Node-only entry uses `node:fs`/`node:crypto`; it starts no worker/transport and
imports no Vite runtime, Git checkout, About implementation or application roots.
The host injects deployment base/scope, emitted worker filename, cache namespace,
message identity, stamps and exact current/retained resource pins. Optional Vite
hooks are structural and consume the host's actual bundle.

The default is `retention: "retain-older"`. Activation preserves older cached
resources; explicitly pinned legacy resources stay usable. Only the explicit
Earth `"current-only"` policy prunes old files. Page/navigation responses remain
network-first; missing current/retained files fetch on demand. Unknown same-origin
files are not acquired or retained as new resources. Opt-out and deployment
identity are honored. No eager content/media download is introduced.

A produced result contains `source`, `kept`, `unhashed`, `manifest` and
`receipt`. The receipt binds template SHA256, manifest SHA256, worker SHA256 and
worker byte size, with **`state: "PRODUCED_NOT_QUALIFIED"`**. Static/retained pins
require SHA256 and size and reject conflicting paths. This is an exact build
receipt, not an executable seal or acceptance claim. The runtime worker does not
verify network response bytes against those hashes; the host's immutable content
transport/qualification must establish those pins. A later qualifier must bind
its result to these same output bytes rather than relabel production as checked.

```ts
import { appFiles } from "@foss-earth/ui/vite";
const worker = appFiles({ base: "/", scope: "/", workerFile: "foss-earth-sw.js",
  cacheNamespace: deploymentCacheNamespace, identity: deploymentIdentity,
  retention: "retain-older", extraFiles: threeCurrentSceneArtifactPins,
  retainedFiles: measuredLegacyResourcePins,
  stamps: suppliedAboutBuildStamps,
  onProduced: recordUnqualifiedBuildReceipt });
```

Campus supplies its `/foss-earth-sw.js`, root scope, three scene artifacts and
legacy resource retention from Campus-owned manifests. It pairs the same cache
namespace/identity with its keeper and supplies an explicit reload action. Its
`CampusNativeHostFactory.report` can use this client/watcher plus UI diagnostics
without preparing a globe or viewer. Earth App forwards keep its existing
namespace/current-only cache compatibility and app-specific stamp/reload policy.
There is no deployment identity or Campus content in the shared implementation.

## Provenance and verification

The reusable behavior comes from Earth App `src/app/appFiles.ts`,
`src/app/publishedVersion.ts`, `vite/appFiles.ts` and `vite/appFilesWorker.js`;
original bytes/modes and existing human lineage are preserved in before maps.
App retains browser-environment/stamp/root compatibility assembly. Engine's
imagery-decode worker is separate and does not become this deployment worker.

Source fixtures cover retained-old/current/legacy resources, unknown-file refusal,
current-only opt-in, exact pin/path negatives, deployment identity, opt-out,
registration/cleanup failure, report-only checks, explicit reload, stale response
and real transport retirement. `fixtures/native-bindings` consumes public
browser/core/build exports and strict declarations. All tests are UNRUN; package
pins, worker qualification, exact archive install, App/Campus adoption, real
service-worker/browser behavior and remote admission remain future checks.
