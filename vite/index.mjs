/** Node-only Vite helpers. No Git roots, stamps, network, or work at import time. */
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import typescript from "typescript";
export const APP_FILES_WORKER = "foss-earth-sw.js";
const HASHED = /-[\w-]{8}\.[a-z0-9]+$/i;
const digest = value => createHash("sha256").update(value).digest("hex");
const basePath = value => {
  if (typeof value !== "string" || !value.startsWith("/") || !value.endsWith("/") || value.includes("..") || value.includes("//") || /%(?:2f|5c|2e)/i.test(value) || value.includes("\\") || value.includes("?") || value.includes("#")) throw new TypeError("A normalized absolute deployment base ending in / is required.");
  return value;
};
const filePath = (value, base) => {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("?") || value.includes("#") || value.split("/").includes("..") || /%(?:2f|5c|2e)/i.test(value)) throw new TypeError("Kept files require normalized same-deployment paths.");
  const url = new URL(value, "https://worker-build.invalid" + base);
  if (url.origin !== "https://worker-build.invalid" || !url.pathname.startsWith(base) || url.pathname.endsWith(".html")) throw new TypeError("Kept file escapes deployment or names a page.");
  return url.pathname;
};
const pinned = (files, base) => files.map(file => {
  if (!file || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) throw new TypeError("An extra/retained file needs an exact SHA-256 and byte length.");
  return { url: filePath(file.url, base), sha256: file.sha256, sizeBytes: file.sizeBytes };
});
export function appFilesWorker(fileNames, options = {}) {
  if (!Array.isArray(fileNames) || fileNames.length > 32768) throw new RangeError("Worker file manifest must be a finite array of at most 32768 files.");
  if (fileNames.some(name => typeof name !== "string" || !name)) throw new TypeError("Every worker bundle filename must be a nonempty string.");
  const base = basePath(options.base ?? "/"), scope = basePath(options.scope ?? base);
  if (!base.startsWith(scope)) throw new TypeError("Worker scope must cover the deployment base.");
  const workerFile = options.workerFile ?? APP_FILES_WORKER;
  if (typeof workerFile !== "string" || workerFile.startsWith("/")) throw new TypeError("Emitted worker filename must be relative to the deployment base.");
  const workerPath = filePath(workerFile, base);
  const cacheNamespace = options.cacheNamespace ?? "foss-earth-app-files";
  if (typeof cacheNamespace !== "string" || !cacheNamespace.trim()) throw new TypeError("Worker cache namespace is required.");
  const retention = options.retention ?? "retain-older";
  if (!["retain-older", "current-only"].includes(retention)) throw new TypeError("Unknown kept-file retention policy.");
  const candidates = fileNames.filter(name => typeof name === "string" && !name.endsWith(".html") && !name.endsWith(".map") && filePath(name, base) !== workerPath);
  const kept = [...new Set(candidates.filter(name => HASHED.test(name)))].sort();
  const unhashed = [...new Set(candidates.filter(name => !HASHED.test(name)))].sort();
  const files = kept.map(name => ({ url: filePath(name, base) }));
  const extra = pinned(options.extraFiles ?? [], base), retainedFiles = pinned(options.retainedFiles ?? [], base);
  if (files.length + extra.length + retainedFiles.length > 32768) throw new RangeError("Worker file manifest exceeds its finite file bound.");
  const seen = new Map(files.map(file => [file.url, file]));
  for (const file of extra) {
    const old = seen.get(file.url);
    if (old?.sha256 && (old.sha256 !== file.sha256 || old.sizeBytes !== file.sizeBytes)) throw new TypeError("Conflicting kept-file pins.");
    seen.set(file.url, file);
  }
  const retained = new Map();
  for (const file of retainedFiles) {
    const old = seen.get(file.url) ?? retained.get(file.url);
    if (old?.sha256 && (old.sha256 !== file.sha256 || old.sizeBytes !== file.sizeBytes)) throw new TypeError("Conflicting retained-file pins.");
    if (old && !old.sha256) seen.set(file.url, file);
    else if (!seen.has(file.url)) retained.set(file.url, file);
  }
  if (options.identity != null && (typeof options.identity !== "string" || !options.identity.trim())) throw new TypeError("Deployment identity must be a nonempty string.");
  const manifest = { schemaVersion: 1, base, scope, workerFile, cacheNamespace, identity: options.identity ?? null,
    retention, files: [...seen.values()].sort((a,b) => a.url.localeCompare(b.url)), retainedFiles: [...retained.values()].sort((a,b) => a.url.localeCompare(b.url)) };
  const template = readFileSync(new URL("./appFilesWorker.js", import.meta.url), "utf8");
  const source = `"use strict";\n${template}\ninstall(self, ${JSON.stringify(manifest)});\n`;
  const manifestBytes = JSON.stringify(manifest) + "\n";
  return { source, kept, unhashed, manifest, receipt: { state: "PRODUCED_NOT_QUALIFIED", schemaVersion: 1,
    templateSha256: digest(template), manifestSha256: digest(manifestBytes), workerSha256: digest(source), workerSizeBytes: Buffer.byteLength(source) } };
}
export function appFiles(options = {}) {
  let base = options.base ?? "/", stamps = {};
  return {
    name: "foss-earth-ui-app-files",
    config(config, env) {
      base = options.base ?? config.base ?? "/";
      stamps = env.command === "build" ? (typeof options.stamps === "function" ? options.stamps(config, env) : options.stamps ?? {}) : {};
      return { define: { __FOSS_EARTH_APP_FILES__: JSON.stringify(env.command === "build" ? options.workerFile ?? APP_FILES_WORKER : "") } };
    },
    transformIndexHtml: () => Object.entries(stamps).filter(([,value]) => value).map(([name, content]) => ({ tag: "meta", attrs: { name, content }, injectTo: "head" })),
    generateBundle(_output, bundle) {
      const result = appFilesWorker(Object.keys(bundle), { ...options, base });
      if (result.unhashed.length) this.warn(`${result.unhashed.length} built file(s) have no content hash in their names, so the app's worker does not keep them: ${result.unhashed.slice(0,5).join(", ")}`);
      this.emitFile({ type: "asset", fileName: options.workerFile ?? APP_FILES_WORKER, source: result.source });
      if (options.manifestFile) this.emitFile({ type: "asset", fileName: options.manifestFile, source: JSON.stringify(result.manifest) + "\n" });
      options.onProduced?.(result);
    },
  };
}
const recoverySource = join(dirname(fileURLToPath(import.meta.url)), "../src/browser/browserData.ts");
let recoveryCache = { mtimeMs: -1, script: "" };
function recoveryRuntime() {
  const mtimeMs = statSync(recoverySource).mtimeMs;
  if (mtimeMs === recoveryCache.mtimeMs) return recoveryCache.script;
  const transpiled = typescript.transpileModule(readFileSync(recoverySource, "utf8"), {
    compilerOptions: { target: typescript.ScriptTarget.ES2023, module: typescript.ModuleKind.ES2022, isolatedModules: true, removeComments: true },
    fileName: "browserData.ts",
  }).outputText.replace(/^export /gm, "");
  if (/^import\s/m.test(transpiled)) throw new Error("Browser recovery runtime must stay free of imports so it can run from inline HTML.");
  recoveryCache = { mtimeMs, script: transpiled };
  return transpiled;
}
/** Inlines the review so a failed application bundle can still offer it. */
export function browserRecovery(options = {}) {
  const appId = options.appId;
  if (typeof appId !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(appId)) throw new TypeError("browserRecovery appId must be a short lowercase identifier.");
  return {
    name: "foss-earth-browser-recovery",
    transformIndexHtml() {
      const runtime = `"use strict";\n${recoveryRuntime()}\ninstallBrowserRecovery(document, ${JSON.stringify({ appId })});\n`;
      const jsonText = JSON.stringify(runtime).replace(/</g, "\\u003c");
      // The first script in the page marks when its HTML started to run (docs/proposals/startup-loading.md).
      const children = `self.performance?.mark?.("boot:html")\neval(JSON.parse(${JSON.stringify(jsonText)}))\n`;
      return [{ tag: "script", attrs: { "data-foss-earth-browser-recovery": appId }, children, injectTo: "head-prepend" }];
    },
  };
}
