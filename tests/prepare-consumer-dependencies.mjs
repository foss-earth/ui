// INPUT-ONLY tooling: source-packs the reviewed 45-package peer/tool plan.
// No automatic ancestor lookup, compiler/UI packing or consumer qualification.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const planFile = path.join(root, "fixtures/consumer/dependency-plan.json");
const planBytes = readFileSync(planFile), plan = JSON.parse(planBytes);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
let inputName = process.env.UI_CONSUMER_DEPENDENCY_INPUTS;
for (const argument of process.argv.slice(2)) {
  assert.ok(argument.startsWith("--inputs="), "Use --inputs=<reviewed-source-inputs.json>.");
  inputName = argument.slice("--inputs=".length);
}
assert.ok(inputName, "Supply --inputs=<JSON> or UI_CONSUMER_DEPENDENCY_INPUTS. Installed ancestors are never searched implicitly.");
const inputFile = realpathSync(path.resolve(inputName));
const inputBytes = readFileSync(inputFile), inputs = JSON.parse(inputBytes);
assert.equal(inputs.schemaVersion, 1);
assert.equal(inputs.planSha256, hash(planBytes), "Reviewed roots must bind the unchanged current dependency plan.");
assert.ok(Array.isArray(inputs.nodeModulesRoots) && inputs.nodeModulesRoots.length > 0);
assert.ok(inputs.packageSources === undefined || inputs.packageSources && typeof inputs.packageSources === "object" && !Array.isArray(inputs.packageSources));
for (const key of Object.keys(inputs)) assert.ok(["schemaVersion", "planSha256", "nodeModulesRoots", "packageSources"].includes(key), "Unknown source-input field: " + key);

const expected = new Map();
for (const item of plan.packages) {
  assert.ok(!expected.has(item.name), "Dependency plan must contain one exact version per name.");
  expected.set(item.name, item.version);
}
assert.equal(expected.size, 45);
const inputRoots = inputs.nodeModulesRoots.map(directory => {
  assert.equal(typeof directory, "string");
  const declared = path.resolve(path.dirname(inputFile), directory);
  assert.equal(realpathSync(declared), declared, "Reviewed node_modules root must be a physical canonical path.");
  assert.equal(path.basename(declared), "node_modules");
  assert.ok(lstatSync(declared).isDirectory());
  return declared;
});
assert.equal(new Set(inputRoots).size, inputRoots.length, "Duplicate reviewed root.");
const insideRoots = filename => inputRoots.some(directory => filename.startsWith(directory + path.sep));
const inventory = [], skipped = [], visited = new Set();
function inspectNodeModules(directory, scope = "") {
  assert.ok(inputRoots.includes(directory) || insideRoots(directory), "Nested inventory escaped reviewed roots.");
  if (visited.has(directory)) return;
  visited.add(directory);
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const location = path.join(directory, entry.name);
    const requestedName = scope ? `${scope}/${entry.name}` : entry.name;
    // In unrelated packages, record links without following them into another
    // owner. A planned package must come from a physical reviewed directory.
    if (entry.isSymbolicLink()) {
      assert.ok(!expected.has(requestedName), "Planned source package cannot be a link: " + requestedName);
      skipped.push({ path: location, reason: "symbolic link not followed" }); continue;
    }
    if (!entry.isDirectory()) continue;
    assert.equal(realpathSync(location), location, "Package/scope path cannot redirect.");
    if (entry.name.startsWith("@") && !scope) { inspectNodeModules(location, entry.name); continue; }
    const manifestFile = path.join(location, "package.json");
    if (!existsSync(manifestFile)) { skipped.push({ path: location, reason: "no package manifest" }); continue; }
    assert.ok(lstatSync(manifestFile).isFile() && !lstatSync(manifestFile).isSymbolicLink(), "Package manifest must be a physical file.");
    const manifestBytes = readFileSync(manifestFile), metadata = JSON.parse(manifestBytes);
    assert.equal(metadata.name, requestedName, "Physical package identity must match its requested directory.");
    inventory.push({ name: metadata.name, version: metadata.version, path: location, manifestSha256: hash(manifestBytes) });
    const nested = path.join(location, "node_modules");
    if (existsSync(nested)) {
      assert.ok(lstatSync(nested).isDirectory() && !lstatSync(nested).isSymbolicLink(), "Nested node_modules must be physical.");
      assert.equal(realpathSync(nested), nested); inspectNodeModules(nested);
    }
  }
}
for (const directory of inputRoots) inspectNodeModules(directory);
const overrides = new Map();
for (const [name, source] of Object.entries(inputs.packageSources ?? {})) {
  assert.ok(expected.has(name), "Only planned package sources may be selected: " + name);
  assert.equal(typeof source, "string");
  const declared = path.resolve(path.dirname(inputFile), source);
  assert.equal(realpathSync(declared), declared, "Selected package root must be physical and canonical.");
  assert.ok(insideRoots(declared), "Selected package source is outside reviewed roots.");
  overrides.set(name, declared);
}
const selected = [], rejectedVersions = [];
for (const [name, version] of expected) {
  const candidates = inventory.filter(item => item.name === name);
  rejectedVersions.push(...candidates.filter(item => item.version !== version).map(item => ({ ...item, requiredVersion: version })));
  const matches = candidates.filter(item => item.version === version && (!overrides.has(name) || item.path === overrides.get(name)));
  assert.equal(matches.length, 1, `Need one reviewed physical ${name}@${version}; missing/ambiguous exact matches require reviewed roots or packageSources.`);
  selected.push(matches[0]);
}

function physicalDirectory(directory) {
  if (!existsSync(directory)) mkdirSync(directory);
  assert.equal(realpathSync(directory), directory, "Owner output cannot redirect.");
}
const build = path.join(root, "build"); physicalDirectory(build);
const parent = path.join(build, "consumer-dependencies"); physicalDirectory(parent);
const output = path.join(parent, new Date().toISOString().replace(/[:.]/g, "-")); mkdirSync(output);
const temporary = path.join(output, "tmp"), cache = path.join(output, "npm-cache"); mkdirSync(temporary); mkdirSync(cache);
const write = (filename, value) => writeFileSync(path.join(output, filename), value, { flag: "wx" });
write("reviewed-source-inputs.json", inputBytes); write("dependency-plan.json", planBytes);
write("source-inventory.json", JSON.stringify({ inputRoots, inventory, skipped, rejectedVersions, selected }, null, 2) + "\n");
write("empty-user.npmrc", ""); write("empty-global.npmrc", "");
const env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary };
for (const key of Object.keys(env)) if (/^npm_config_/i.test(key) || /^npm_package_/i.test(key) || /^(NODE_PATH|NODE_OPTIONS|npm_execpath|npm_node_execpath|INIT_CWD)$/.test(key)) delete env[key];
const records = [];
for (const source of selected) {
  const metadataFile = path.join(source.path, "package.json");
  assert.equal(realpathSync(source.path), source.path, "Selected source cannot redirect before packing.");
  assert.ok(lstatSync(source.path).isDirectory() && !lstatSync(source.path).isSymbolicLink());
  assert.ok(lstatSync(metadataFile).isFile() && !lstatSync(metadataFile).isSymbolicLink());
  const actualBytes = readFileSync(metadataFile), actual = JSON.parse(actualBytes);
  assert.equal(hash(actualBytes), source.manifestSha256, "Selected package manifest changed before packing.");
  assert.equal(actual.name, source.name); assert.equal(actual.version, source.version);
  assert.ok(![actual.bundleDependencies, actual.bundledDependencies].some(value => value === true || Array.isArray(value) && value.length), "Bundled sources cannot provide the flat archive inputs.");
  let stdout;
  try {
    stdout = execFileSync("npm", ["pack", source.path, "--offline", "--ignore-scripts", "--json", "--pack-destination", output, "--cache", cache, "--userconfig", path.join(output, "empty-user.npmrc"), "--globalconfig", path.join(output, "empty-global.npmrc")], { cwd: root, env, encoding: "utf8" });
  } catch (error) {
    write("failure.log", String(error.stdout ?? "") + String(error.stderr ?? error)); throw error;
  }
  write(source.name.replaceAll("/", "_") + ".log", stdout);
  assert.equal(realpathSync(source.path), source.path, "Selected source redirected during packing.");
  assert.ok(lstatSync(metadataFile).isFile() && !lstatSync(metadataFile).isSymbolicLink());
  assert.equal(hash(readFileSync(metadataFile)), source.manifestSha256, "Selected package manifest changed during packing.");
  const packed = JSON.parse(stdout); assert.equal(packed.length, 1);
  assert.equal(path.basename(packed[0].filename), packed[0].filename, "Packed output cannot leave its retained owner folder.");
  const archive = path.join(output, packed[0].filename), bytes = readFileSync(archive);
  const metadata = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { cwd: root, env, encoding: "utf8" }));
  assert.equal(metadata.name, source.name); assert.equal(metadata.version, source.version);
  records.push({ name: source.name, version: source.version, archive, sha256: hash(bytes), bytes: bytes.length, source: { path: source.path, manifestSha256: source.manifestSha256 } });
}
const receipt = path.join(output, "dependencies.json");
write("dependencies.json", JSON.stringify({ schemaVersion: 1, packages: records, planSha256: hash(planBytes), sourceInputsSha256: hash(inputBytes), inputOnly: true, completeClosure: false,
  missingRequiredPackages: [{ name: "@foss-earth/ui", version: "0.1.0" }, plan.compiler],
  qualification: "partial source-packed archive input preparation only; no admitted source/release lineage, complete closure or installed consumer result",
  limitations: ["Package identity/version and manifest stability are recorded; arbitrary source-file mutation during packing remains unqualified.", "The independent 47-package qualifier must validate exact archives, installed closure and public contracts."] }, null, 2) + "\n");
process.stdout.write("Partial input-only consumer dependency manifest: " + receipt + "\n");
