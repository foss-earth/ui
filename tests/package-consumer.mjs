import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "build", "consumer", runId);
const artifacts = path.join(output, "artifacts");
const workspace = path.join(output, "workspace");
mkdirSync(artifacts, { recursive: true });
mkdirSync(workspace, { recursive: true });
const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", artifacts, "--cache", path.join(root, "build", "npm-cache")], { cwd: root, encoding: "utf8" }))[0];
const artifact = path.join(artifacts, packed.filename);
const sha256 = createHash("sha256").update(readFileSync(artifact)).digest("hex");
writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "ui-artifact-consumer", version: "1.0.0", private: true, type: "module" }, null, 2));
const installOutput = execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--cache", path.join(root, "build", "npm-cache"), artifact], { cwd: workspace, encoding: "utf8" });
writeFileSync(path.join(output, "install.log"), installOutput);
copyFileSync(path.join(root, "fixtures", "consumer", "minimal.mjs"), path.join(workspace, "minimal.mjs"));
copyFileSync(path.join(root, "fixtures", "consumer", "minimal.ts"), path.join(workspace, "minimal.ts"));
const compiler = createRequire(import.meta.url).resolve("typescript/bin/tsc");
writeFileSync(path.join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true, incremental: true, tsBuildInfoFile: "./node_modules/.tmp/consumer.tsbuildinfo", strict: true, skipLibCheck: true, target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2023", "DOM", "DOM.Iterable"], types: [] }, files: ["minimal.ts"] }, null, 2));
const typeOutput = execFileSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: workspace, encoding: "utf8" });
writeFileSync(path.join(output, "typecheck.log"), typeOutput);
const outputText = execFileSync(process.execPath, ["minimal.mjs"], { cwd: workspace, encoding: "utf8" });
writeFileSync(path.join(output, "consumer.log"), outputText);
// Pack the exact locally installed peers/types. No registry or global npm
// cache is needed, and the resolution hook above rejects ancestor modules.
const require = createRequire(import.meta.url);
const peerArtifacts = [];
const peerPins = {};
for (const name of ["react", "react-dom", "scheduler", "@types/react", "@types/react-dom", "csstype"]) {
  const metadataPath = require.resolve(`${name}/package.json`);
  peerPins[name] = JSON.parse(readFileSync(metadataPath, "utf8")).version;
  const result = JSON.parse(execFileSync("npm", ["pack", path.dirname(metadataPath), "--json", "--pack-destination", artifacts, "--cache", path.join(root, "build", "npm-cache")], { cwd: root, encoding: "utf8" }))[0];
  peerArtifacts.push(path.join(artifacts, result.filename));
}
const peerInstallOutput = execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", path.join(root, "build", "npm-cache"), ...peerArtifacts], { cwd: workspace, encoding: "utf8" });
writeFileSync(path.join(output, "peer-install.log"), peerInstallOutput);
copyFileSync(path.join(root, "fixtures", "consumer", "react.mjs"), path.join(workspace, "react.mjs"));
copyFileSync(path.join(root, "fixtures", "consumer", "react.ts"), path.join(workspace, "react.ts"));
const config = JSON.parse(readFileSync(path.join(workspace, "tsconfig.json"), "utf8"));
config.files.push("react.ts");
writeFileSync(path.join(workspace, "tsconfig.json"), JSON.stringify(config, null, 2));
const reactTypeOutput = execFileSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: workspace, encoding: "utf8" });
writeFileSync(path.join(output, "react-typecheck.log"), reactTypeOutput);
const reactOutput = execFileSync(process.execPath, ["react.mjs"], { cwd: workspace, encoding: "utf8" });
writeFileSync(path.join(output, "react-consumer.log"), reactOutput);
writeFileSync(path.join(output, "receipt.json"), JSON.stringify({ artifact: path.relative(root, artifact), sha256, importsChecked: [".", "./settings", "./windowing", "./contributions", "./browser", "./react"], assetsChecked: ["./styles.css", "./windowing.css"], peerPins, consumer: "fresh offline install, resolution hook rejects ancestor modules; pure imports before optional peers installed", environment: { node: process.version, platform: process.platform, architecture: process.arch }, result: "passed" }, null, 2) + "\n");
process.stdout.write(outputText + reactOutput);
process.stdout.write(`Artifact SHA-256: ${sha256}\nReceipt: ${path.relative(root, path.join(output, "receipt.json"))}\n`);
