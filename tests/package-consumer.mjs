import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Qualification consumes externally prepared archives. It never packs this
// checkout or resolves a compiler/dependency from an ancestor installation.
const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const owner = "@foss-earth/ui", ownerVersion = "0.1.0";
const args = process.argv.slice(2);
let closureName = process.env.UI_CONSUMER_ARCHIVES;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--archives") closureName = args[++index];
  else if (argument.startsWith("--archives=")) closureName = argument.slice("--archives=".length);
  else throw new Error(`Unknown consumer argument: ${argument}; supply --archives=<complete exact archive closure>.`);
}
assert.ok(closureName, "UI_CONSUMER_ARCHIVES or --archives=<JSON> must supply UI, TypeScript and every exact dependency archive. No source-packing fallback exists.");
const closureFile = realpathSync(path.resolve(closureName));
const closureBytes = readFileSync(closureFile), closure = JSON.parse(closureBytes);
const planBytes = readFileSync(path.join(root, "fixtures", "consumer", "dependency-plan.json"));
const plan = JSON.parse(planBytes), sourceManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(plan.schemaVersion, 1); assert.equal(closure.schemaVersion, 1);
assert.equal(closure.planSha256, hash(planBytes), "Closure must bind the current exact dependency plan.");
assert.equal(plan.compiler.name, "typescript"); assert.equal(plan.compiler.version, "5.9.3");
assert.equal(sourceManifest.name, owner); assert.equal(sourceManifest.version, ownerVersion);
const expected = new Map([[owner, ownerVersion], [plan.compiler.name, plan.compiler.version]]);
for (const item of plan.packages) {
  assert.ok(!expected.has(item.name), `Duplicate dependency-plan package: ${item.name}`);
  expected.set(item.name, item.version);
}
assert.ok(Array.isArray(closure.packages));
assert.equal(closure.packages.length, expected.size, "Supply exactly UI, TypeScript and the complete 45-package non-native peer/tool closure.");

// Every run owns a new physical output/cache/tmp/workspace. Existing evidence
// cannot be overwritten and a symlink cannot redirect output into another tree.
function existingOrCreate(directory) {
  if (!existsSync(directory)) mkdirSync(directory);
  assert.equal(realpathSync(directory), directory, `Owner directory cannot redirect: ${directory}`);
}
const build = path.join(root, "build"); existingOrCreate(build);
const parent = path.join(build, "consumer"); existingOrCreate(parent);
const output = path.join(parent, new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(output); assert.equal(realpathSync(output), output);
const artifacts = path.join(output, "artifacts"), workspace = path.join(output, "workspace"), cache = path.join(output, "npm-cache"), temporary = path.join(output, "tmp");
for (const directory of [artifacts, workspace, cache, temporary]) { mkdirSync(directory); assert.equal(realpathSync(directory), directory); }
const write = (filename, contents) => writeFileSync(filename, contents, { flag: "wx" });
write(path.join(output, "input-closure.json"), closureBytes);
write(path.join(output, "dependency-plan.json"), planBytes);
function run(label, command, argv, extraEnv = {}, expectedError = null) {
  const env = { ...process.env, TMPDIR: temporary };
  delete env.NODE_PATH; delete env.NODE_OPTIONS; delete env.CONSUMER_FORBID_PEERS;
  for (const name of Object.keys(env)) if (/^npm_config_/i.test(name)) delete env[name];
  Object.assign(env, extraEnv);
  const filename = path.join(output, label + ".log"), fd = openSync(filename, "wx");
  let result;
  try { result = spawnSync(command, argv, { cwd: workspace, env, stdio: ["ignore", fd, fd] }); }
  finally { closeSync(fd); }
  if (result.error) throw result.error;
  const log = readFileSync(filename, "utf8");
  if (expectedError) {
    assert.equal(result.signal, null, `${label} must not pass through process termination.`);
    assert.equal(result.status, 1, `${label} must reject its causal negative control with the Node guard exception.`);
    assert.match(log, expectedError, `${label} failed for the wrong reason; inspect ${filename}`);
  } else assert.equal(result.status, 0, `${label} failed; inspect ${filename}`);
  return log;
}
const supplied = new Map(), dependencies = Object.create(null), archives = [];
for (const [index, record] of closure.packages.entries()) {
  assert.equal(typeof record.name, "string"); assert.match(record.name, /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/);
  assert.equal(expected.get(record.name), record.version, `Undeclared archive/version: ${record.name}`);
  assert.ok(!supplied.has(record.name), `Duplicate archive: ${record.name}`);
  assert.match(record.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(record.bytes) && record.bytes > 0);
  assert.equal(typeof record.archive, "string"); assert.ok(record.archive.length > 0);
  const suppliedArchive = realpathSync(path.resolve(path.dirname(closureFile), record.archive));
  const bytes = readFileSync(suppliedArchive);
  assert.equal(bytes.length, record.bytes, `Archive byte count: ${record.name}`);
  assert.equal(hash(bytes), record.sha256, `Archive SHA256: ${record.name}`);
  // Install the retained bytes just checked, not a mutable external source path.
  const snapshot = path.join(artifacts, String(index).padStart(2, "0") + ".tgz"); write(snapshot, bytes);
  const metadata = JSON.parse(run(`archive-${String(index).padStart(2, "0")}`, "tar", ["-xOf", snapshot, "package/package.json"]));
  assert.equal(metadata.name, record.name, `Archive manifest identity: ${record.name}`);
  assert.equal(metadata.version, record.version, `Archive manifest version: ${record.name}`);
  assert.ok(![metadata.bundleDependencies, metadata.bundledDependencies].some(value => value === true || Array.isArray(value) && value.length > 0), `Bundled archive closure is unqualified: ${record.name}`);
  for (const group of [metadata.dependencies, metadata.optionalDependencies, metadata.peerDependencies]) {
    for (const [name, version] of Object.entries(group ?? {})) {
      assert.equal(typeof version, "string", `Dependency declaration: ${record.name}/${name}`);
      assert.ok(!/^(?:file:|link:|workspace:|npm:|git(?:\+|:)|https?:|ssh:|\/|\.\.?[/\\])/.test(version), `External/aliased dependency source is unqualified: ${record.name}/${name}`);
    }
  }
  supplied.set(record.name, record);
  dependencies[record.name] = "file:" + snapshot;
  archives.push({ name: record.name, version: record.version, sha256: record.sha256, bytes: record.bytes, archive: path.relative(output, snapshot) });
}
for (const name of expected.keys()) assert.ok(supplied.has(name), `Missing exact archive: ${name}`);
write(path.join(workspace, "package.json"), JSON.stringify({ name: "ui-artifact-consumer", version: "1.0.0", private: true, type: "module", dependencies }, null, 2) + "\n");
run("install", "npm", ["install", "--offline", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund", "--cache", cache, "--prefix", workspace], {
  npm_config_userconfig: path.join(temporary, "absent-user-npmrc"),
  npm_config_globalconfig: path.join(temporary, "absent-global-npmrc"),
});
const workspaceRoot = realpathSync(workspace) + path.sep, installed = [];
function inventory(directory, scope = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const location = path.join(directory, entry.name);
    assert.ok(realpathSync(location).startsWith(workspaceRoot), "Installed location cannot follow an outside symlink.");
    if (entry.name.startsWith("@")) { inventory(location, entry.name); continue; }
    const metadataFile = path.join(location, "package.json");
    assert.ok(realpathSync(metadataFile).startsWith(workspaceRoot), "Installed manifest cannot follow an outside symlink.");
    const metadata = JSON.parse(readFileSync(metadataFile, "utf8"));
    const requestedName = scope ? `${scope}/${entry.name}` : entry.name;
    assert.equal(metadata.name, requestedName, `Archive identity must match its physical requested directory: ${requestedName}`);
    assert.equal(metadata.version, expected.get(requestedName), `Undeclared installed name/version: ${requestedName}`);
    assert.ok(supplied.has(requestedName), `Installed dependency has no supplied archive: ${requestedName}`);
    assert.ok(![metadata.bundleDependencies, metadata.bundledDependencies].some(value => value === true || Array.isArray(value) && value.length > 0), `Bundled package closure is unqualified: ${requestedName}`);
    assert.ok(!existsSync(path.join(location, "node_modules")), `Nested package closure is unqualified: ${requestedName}; supply one flat exact version per name.`);
    installed.push({ name: requestedName, version: metadata.version });
  }
}
inventory(path.join(workspace, "node_modules"));
assert.equal(installed.length, expected.size);
for (const name of expected.keys()) assert.equal(installed.filter(item => item.name === name).length, 1, `Required installed archive identity: ${name}`);
for (const fixture of ["minimal.mjs", "minimal.ts", "react.mjs", "react.ts", "browser.mjs", "guard.mjs", "guard-negative.mjs", "pure-guard-negative.mjs", "declaration-guard.mjs"]) write(path.join(workspace, fixture), readFileSync(path.join(root, "fixtures", "consumer", fixture)));
write(path.join(output, "outside.mjs"), "export const unexpected = true;\n");
write(path.join(output, "outside.d.ts"), "export interface Unexpected { outside: true }\n");
const ancestor = path.join(output, "node_modules", "@foss-earth", "forbidden-owner-fixture"); mkdirSync(ancestor, { recursive: true });
write(path.join(ancestor, "package.json"), JSON.stringify({ name: "@foss-earth/forbidden-owner-fixture", version: "0.0.0", type: "module", exports: { ".": { types: "./index.d.ts", import: "./index.mjs" } } }));
write(path.join(ancestor, "index.mjs"), "export const unexpected = true;\n");
write(path.join(ancestor, "index.d.ts"), "export interface Unexpected { outside: true }\n");
const featureControl = path.join(workspace, "control", "node_modules", "@foss-earth", "engine"); mkdirSync(featureControl, { recursive: true });
write(path.join(featureControl, "probe.mjs"), "export const control = true;\n");
write(path.join(workspace, "peer-controls-exist.mjs"), 'import assert from "node:assert/strict";assert.equal(typeof (await import("react")).createElement,"function");assert.equal((await import("./control/node_modules/@foss-earth/engine/probe.mjs")).control,true);\n');
run("peer-controls-exist", process.execPath, ["--import", "./guard.mjs", "peer-controls-exist.mjs"]);
run("runtime-guard-negative", process.execPath, ["--import", "./guard.mjs", "guard-negative.mjs"]);
run("pure-peer-negative", process.execPath, ["--import", "./guard.mjs", "pure-guard-negative.mjs"], { CONSUMER_FORBID_PEERS: "1" });
run("pure-browser-import", process.execPath, ["--import", "./guard.mjs", "minimal.mjs"], { CONSUMER_FORBID_PEERS: "1" });
const config = { compilerOptions: { noEmit: true, incremental: true, tsBuildInfoFile: "./node_modules/.tmp/consumer.tsbuildinfo", strict: true, skipLibCheck: false, target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2023", "DOM", "DOM.Iterable"], types: [] }, files: ["minimal.ts", "react.ts"] };
write(path.join(workspace, "tsconfig.json"), JSON.stringify(config, null, 2) + "\n");
const compiler = path.join(workspace, "node_modules", "typescript", "bin", "tsc");
assert.ok(realpathSync(compiler).startsWith(workspaceRoot));
const trace = run("public-typecheck", process.execPath, ["--import", "./guard.mjs", compiler, "-p", "tsconfig.json", "--traceResolution"]);
for (const match of trace.matchAll(/successfully resolved to '([^']+)'/g)) assert.ok(realpathSync(match[1]).startsWith(workspaceRoot), `Declaration resolution escaped: ${match[1]}`);
run("complete-declaration-closure", process.execPath, ["--import", "./guard.mjs", "declaration-guard.mjs", "tsconfig.json"]);
write(path.join(workspace, "negative.ts"), 'import type { Unexpected } from "../outside.js"; export type Check = Unexpected;\n');
write(path.join(workspace, "negative-ancestor.ts"), 'import type { Unexpected } from "@foss-earth/forbidden-owner-fixture"; export type Check = Unexpected;\n');
for (const [label, filename] of [["outside-file", "negative.ts"], ["ancestor-package", "negative-ancestor.ts"]]) {
  const configFile = `negative-${label}.json`;
  write(path.join(workspace, configFile), JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, incremental: false, tsBuildInfoFile: undefined }, files: [filename] }, null, 2));
  run(`declaration-${label}-negative`, process.execPath, ["--import", "./guard.mjs", "declaration-guard.mjs", configFile], {}, /DECLARATION_OUTSIDE_WORKSPACE/);
}
run("react-ssr", process.execPath, ["--import", "./guard.mjs", "react.mjs"]);
run("browser-mechanisms", process.execPath, ["--import", "./guard.mjs", "browser.mjs"]);
const packageRoot = path.join(workspace, "node_modules", "@foss-earth", "ui"), packageRootReal = realpathSync(packageRoot) + path.sep;
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
assert.equal(manifest.name, owner); assert.equal(manifest.version, ownerVersion);
assert.deepEqual(manifest.exports, sourceManifest.exports, "Qualify the current advertised public module/asset map, not an older export subset.");
const exportTargets = [];
function exportFiles(value, key) {
  if (typeof value === "string") {
    assert.ok(value.startsWith("./") && !value.split(/[\\/]/).includes(".."), `Invalid public export target: ${key}`);
    const filename = path.join(packageRoot, value);
    assert.ok(realpathSync(filename).startsWith(packageRootReal), `Public export target must remain inside the installed UI artifact: ${key}`);
    const bytes = readFileSync(filename);
    assert.ok(bytes.length > 0, `Empty advertised target: ${key}`);
    exportTargets.push({ publicExport: key, target: value, sha256: hash(bytes), bytes: bytes.length });
  } else { assert.ok(value && typeof value === "object" && !Array.isArray(value), `Unsupported advertised export: ${key}`); for (const [condition, target] of Object.entries(value)) exportFiles(target, `${key}:${condition}`); }
}
for (const [key, value] of Object.entries(manifest.exports)) exportFiles(value, key);
const uiArchive = archives.find(item => item.name === owner);
const receipt = {
  result: "passed", status: "isolated-installed-consumer-passed", package: owner, version: ownerVersion,
  artifact: path.relative(root, path.join(output, uiArchive.archive)), sha256: uiArchive.sha256, bytes: uiArchive.bytes,
  inputClosureSha256: hash(closureBytes), dependencyPlanSha256: hash(planBytes), archives, installed, exportTargets,
  importsChecked: [".", "./settings", "./windowing", "./contributions", "./diagnostics", "./browser", "./react"],
  assetsChecked: Object.keys(manifest.exports).filter(key => key.endsWith(".css")),
  guards: ["supplied complete exact archive digest/size/name/version and physical directory identity", "fresh offline owner workspace/cache/tmp with no source packing", "installed pinned compiler including standard libraries", "runtime realpath containment and unsupported protocol rejection", "complete strict public declaration closure", "outside runtime/declaration/ancestor-package negative controls", "pure-root React/feature rejection despite physically installed peers", "all current advertised public target bytes and asset assertions"],
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  runtimeQualification: "Node/jsdom/SSR only; no actual browser/GPU/device/host-app acceptance",
  limitations: ["Shared conformance/full-ref lineage/public transport/actual app adoption/remote admission remain separate", "Optional native canvas excluded; exact one-version flat closure required", "Runtime module hooks do not sandbox package filesystem/network/process capabilities"],
};
write(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
process.stdout.write("UI artifact SHA256: " + uiArchive.sha256 + "\nReceipt: " + path.join(output, "receipt.json") + "\n");
