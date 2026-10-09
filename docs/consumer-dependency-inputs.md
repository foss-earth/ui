# Partial consumer archive input preparation

Status: source prepared, unrun. Execution requires a coordinator-granted
archive-preparation slot. This tool prepares source-packed inputs only; it runs
no consumer, installs no package and qualifies no source lineage or release.

`tests/prepare-consumer-dependencies.mjs` requires `--inputs=<JSON>` or
`UI_CONSUMER_DEPENDENCY_INPUTS=<JSON>`. No automatic ancestor lookup remains.
The JSON has this shape:

```json
{
  "schemaVersion": 1,
  "planSha256": "a30f6b6ea4445947ce321ac97db4b64b6bea70f5b6b91dc524bb56f0bb2e4dc1",
  "nodeModulesRoots": ["<reviewed-install>/node_modules"],
  "packageSources": {
    "lru-cache": "<reviewed-install>/node_modules/jsdom/node_modules/lru-cache"
  }
}
```

Replace the path placeholders with inspected physical paths. Relative paths
resolve against the input JSON, never an ambient working directory. The digest
binds the exact unchanged `fixtures/consumer/dependency-plan.json`; a changed
plan requires a newly reviewed input JSON. `packageSources` is optional.

Only explicitly supplied conventional npm `node_modules` roots are inventoried,
including each physical package's nested `node_modules`. Package names must
match the requested directory (including scopes). Roots, selected packages,
manifests and nested installations cannot redirect through symlinks. Unrelated
package links are recorded and never followed into another owner. The selected
manifest identity/version is recorded before packing and rechecked afterwards;
source file mutation during packing remains unqualified.

Selection requires exactly one physical match for each of the 45 planned
name/version pairs. Other versions are recorded as rejected, never substituted.
If multiple exact copies exist, explicitly choose one through `packageSources`
or narrow the reviewed roots. Overrides must refer to an inventoried physical
package inside those roots; they cannot supply another name or version.

In the current Earth installation, the root `lru-cache` is 5.1.1 and the planned
11.3.6 lives under `jsdom/node_modules/lru-cache`. The producer selects that
nested exact version (or its explicit reviewed override), without changing the
installed root package or the dependency plan. These observations are metadata,
not proof that the producer or complete consumer succeeds.

After a grant, from this owner:

```sh
node tests/prepare-consumer-dependencies.mjs --inputs=build/consumer-inputs/<run>/reviewed-source-inputs.json
```

The tool source-packs only the selected 45 packages, sequentially and offline
with scripts disabled. It retains the reviewed roots/config/plan, complete
metadata inventory, rejected versions, selected paths, source manifest hashes,
pack logs, exact archive bytes and partial `dependencies.json` under a fresh
`build/consumer-dependencies/<run>/`. Existing evidence is never overwritten.
Packed archive name/version must match its selected source metadata; bundled
sources are refused. Node/npm configuration is sanitized and cache/tmp folders
belong to that retained output.

The partial receipt has `inputOnly: true` and `completeClosure: false`. It
omits the current UI candidate and TypeScript archive. A separate reviewed
manifest must combine those two exact records with the 45 input archives into
all 47 records expected by `tests/package-consumer.mjs`. That mandatory qualifier
is unchanged: it consumes SHA256/size/name/version pinned archives, has no
source-packing/ancestor-compiler fallback and owns the actual installed closure,
public contract and negative-control checks. The producer is not invoked by
`ci`, `check:implementation` or `test:consumer`.

YOU CANNOT HAVE AI AS A CO-AUTHOR, OR YOUR CONTRIBUTIONS WILL BE REJECTED.
