# Installed UI consumer contract

YOU CANNOT HAVE AI AS A CO-AUTHOR, OR YOUR CONTRIBUTIONS WILL BE REJECTED.

This harness is prepared source, not an executed consumer receipt. Campus holds
its current shared heavy-check slot. Invoke these commands only after the
coordinator grants the Earth owner/consumer check turn and exact inputs exist.
No new source/archive/consumer acceptance pin has been produced here.

`tests/package-consumer.mjs` qualifies supplied artifacts only. It does not run
`npm pack`, import checkout sources, prepare dependencies or resolve a compiler
from an ancestor installation. Its input is a complete JSON archive closure:

| Field | Required value |
| --- | --- |
| `schemaVersion` | `1` |
| `planSha256` | SHA256 of the exact current `fixtures/consumer/dependency-plan.json` bytes |
| `packages` | Exactly 47 unique records: UI 0.1.0, TypeScript 5.9.3 and the 45 package/version records in that plan |
| Each `name`, `version` | Exact reviewed plan or required UI/compiler identity |
| Each `archive` | Existing externally prepared archive path, relative to the closure JSON or explicitly absolute |
| Each `sha256` | Lowercase 64-digit SHA256 of that archive |
| Each `bytes` | Positive safe integer byte length of that archive |

React/React DOM 19.2.6, scheduler 0.27.0, jsdom 29.1.1,
`@types/react` 19.2.14, `@types/react-dom` 19.2.3, csstype 3.2.3 and their
reviewed transitive versions remain unchanged in the plan. TypeScript stays
5.9.3. No lock/dependency version update was performed by this source increment.
The native optional `canvas` peer is excluded, and supplied optional packages
in the plan are explicit installed dependencies. A single flat version per
package is required; bundled/nested or external/aliased dependency sources
cannot establish this qualifier's closure.

```sh
node tests/package-consumer.mjs --archives=build/consumer-inputs/<release>/archives.json
UI_CONSUMER_ARCHIVES=build/consumer-inputs/<release>/archives.json npm run test:consumer
UI_CONSUMER_ARCHIVES=build/consumer-inputs/<release>/archives.json npm run check:implementation
```

`typecheck:consumer` is another entry to that complete installed harness, not
an owner-compiler shortcut. `check:implementation` runs owner typecheck/lint/
Vitest/build and the installed qualifier once; `ci` first runs the actual shared
conformance component, which needs its own installed immutable CI pin and
trusted release descriptor. Full intended publication refs and remote admission
remain primary/coordinator gates. Metadata cannot skip documentation-only work.

Before npm runs, the qualifier validates every archive's digest/size and tar
manifest name/version. It retains those exact bytes in fresh owner output,
then installs only these archives offline with package scripts disabled,
sanitary npm/module environment and a new owner cache/tmp/workspace. Fresh
output is never reused. Realpath checks reject redirected owner directories.
Every installed physical package directory and manifest must identify its
requested exact package; undeclared, nonempty bundle metadata or nested
`node_modules` is rejected. Both UI and compiler identities are explicit inputs.

The runtime resolver permits Node builtins and physical files within that
workspace only. Pure-root/browser import checks additionally reject React,
React DOM, scheduler, Babylon and other FOSS Earth packages despite installed
peers. Browser-global getters throw. Causal negative controls import an
outside file, an actual ancestor package and existing React/feature probes;
the same peer probes first succeed with poison disabled. This checks the
resolver itself rather than treating a missing package as proof of rejection.

The installed TypeScript entry runs under the same resolver. Strict public
fixtures consume every module subpath, including optional React. Resolution
traces and all `createProgram().getSourceFiles()` paths must remain inside the
workspace, including compiler standard libraries, ambient/reference and
transitive declarations. Outside-file and ancestor-package type controls must
fail specifically at the closure guard. There is no ancestor-library exception.

Original mechanism/SSR/DOM lifecycle assertions are retained. All six public
CSS exports are resolved/read through public keys, and every current advertised
module/declaration/asset target must exist, remain physically within UI, be
nonempty and match the current package's export map. Exact target byte hashes,
archive hashes and installed identities are recorded only after actual success.

`tests/prepare-consumer-dependencies.mjs` is older, separately granted input-only
tooling. It packs installed versions of the 45 peer/tool plan packages and emits
a partial receipt; that producer may use its documented owner installation
resolution to obtain inputs. It omits current UI/compiler archives and cannot
qualify a consumer. A coordinator/external producer must supply the complete
47-record closure and genuine candidate archive pins. The qualifier never calls
that producer or fabricates missing archive records.

Prepared evidence is limited to Node, jsdom and React SSR on a future actual
host run. It does not qualify Chrome/browser/mobile layout, GPU/native devices,
application adoption, shared conformance, lineage or remote/public admission.
The resolver controls module/declaration locations, not arbitrary package
filesystem/process/network capabilities. No tests, imports, compiler, build,
install, pack or browser execution ran while preparing this source increment.

## Reviewed partial source input producer

`prepare:consumer-dependencies` is separate INPUT-ONLY tooling. Its
`--inputs=<JSON>` or `UI_CONSUMER_DEPENDENCY_INPUTS` contract, exact nested-package
selection and retained source inventory are specified in
[consumer dependency inputs](consumer-dependency-inputs.md). It emits 45 inputs
and cannot qualify the mandatory 47-record installed closure. Source preparation
and manifest metadata do not establish admitted artifacts or a passing check.
