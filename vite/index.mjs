/** Node-only Vite helpers. No Git roots, stamps, network, or work at import time. */
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
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
/** Whether a build's worker may isolate its pages (ui/src/browser/isolation.ts): "off", the default, "report-only" or "enforce". */
const ISOLATION_MODES = ["off", "report-only", "enforce"];
function isolationMode(value) {
  const mode = value ?? "off";
  if (!ISOLATION_MODES.includes(mode)) throw new TypeError(`Worker isolation must be one of ${ISOLATION_MODES.join(", ")}.`);
  return mode;
}
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
  const isolation = isolationMode(options.isolation);
  const keepFiles = options.keepFiles ?? true;
  if (typeof keepFiles !== "boolean") throw new TypeError("keepFiles must be true or false.");
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
    retention, isolation, keepFiles, files: [...seen.values()].sort((a,b) => a.url.localeCompare(b.url)), retainedFiles: [...retained.values()].sort((a,b) => a.url.localeCompare(b.url)) };
  const template = readFileSync(new URL("./appFilesWorker.js", import.meta.url), "utf8");
  const source = `"use strict";\n${template}\ninstall(self, ${JSON.stringify(manifest)});\n`;
  const manifestBytes = JSON.stringify(manifest) + "\n";
  return { source, kept, unhashed, manifest, receipt: { state: "PRODUCED_NOT_QUALIFIED", schemaVersion: 1,
    templateSha256: digest(template), manifestSha256: digest(manifestBytes), workerSha256: digest(source), workerSizeBytes: Buffer.byteLength(source) } };
}
export function appFiles(options = {}) {
  let base = options.base ?? "/", stamps = {}, building = false;
  const isolation = isolationMode(options.isolation);
  return {
    name: "foss-earth-ui-app-files",
    config(config, env) {
      base = options.base ?? config.base ?? "/";
      stamps = env.command === "build" ? (typeof options.stamps === "function" ? options.stamps(config, env) : options.stamps ?? {}) : {};
      building = env.command === "build";
      return { define: { __FOSS_EARTH_APP_FILES__: JSON.stringify(building ? options.workerFile ?? APP_FILES_WORKER : ""),
        __FOSS_EARTH_ISOLATION__: JSON.stringify(building ? isolation : "off") } };
    },
    transformIndexHtml() {
      const tags = Object.entries(stamps).filter(([,value]) => value).map(([name, content]) => ({ tag: "meta", attrs: { name, content }, injectTo: "head" }));
      // A build whose worker may isolate starts each page with the script that asks it to (ui/src/browser/isolation.ts).
      if (building && isolation !== "off") tags.unshift(isolationScript({ worker: posix.join(basePath(base), options.workerFile ?? APP_FILES_WORKER), scope: basePath(options.scope ?? base), mode: isolation,
        ...(options.keepFiles === false ? { keep: false } : {}) }));
      return tags;
    },
    generateBundle(_output, bundle) {
      const result = appFilesWorker(Object.keys(bundle), { ...options, base });
      if (result.manifest.keepFiles && result.unhashed.length) this.warn(`${result.unhashed.length} built file(s) have no content hash in their names, so the app's worker does not keep them: ${result.unhashed.slice(0,5).join(", ")}`);
      this.emitFile({ type: "asset", fileName: options.workerFile ?? APP_FILES_WORKER, source: result.source });
      if (options.manifestFile) this.emitFile({ type: "asset", fileName: options.manifestFile, source: JSON.stringify(result.manifest) + "\n" });
      options.onProduced?.(result);
    },
  };
}
const browserSource = join(dirname(fileURLToPath(import.meta.url)), "../src/browser");
const inlineCache = new Map();
/** A file of src/browser as script for inline HTML: transpiled, with its exports plain declarations. */
function inlineRuntime(file, purpose) {
  const source = join(browserSource, file);
  const mtimeMs = statSync(source).mtimeMs;
  const cached = inlineCache.get(source);
  if (cached?.mtimeMs === mtimeMs) return cached.script;
  const transpiled = typescript.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { target: typescript.ScriptTarget.ES2023, module: typescript.ModuleKind.ES2022, isolatedModules: true, removeComments: true },
    fileName: file,
  }).outputText.replace(/^export /gm, "");
  if (/^import\s/m.test(transpiled)) throw new Error(`${purpose} must stay free of imports so it can run from inline HTML.`);
  inlineCache.set(source, { mtimeMs, script: transpiled });
  return transpiled;
}
const recoveryRuntime = () => inlineRuntime("browserData.ts", "Browser recovery runtime");
/** The first script of a page whose worker may isolate it: before browser recovery's and the app's. */
function isolationScript(options) {
  const runtime = `"use strict";\n${inlineRuntime("isolation.ts", "Isolation script")}\ninstallIsolation(document, ${JSON.stringify(options)});\n`;
  const jsonText = JSON.stringify(runtime).replace(/</g, "\\u003c");
  return { tag: "script", attrs: { "data-foss-earth-isolation": options.mode }, children: `eval(JSON.parse(${JSON.stringify(jsonText)}))\n`, injectTo: "head-prepend" };
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
      // A page without the boot terminal marks here when its HTML began to run (docs/proposals/startup-loading.md).
      const children = `self.performance?.getEntriesByName?.("boot:html").length || self.performance?.mark?.("boot:html")\neval(JSON.parse(${JSON.stringify(jsonText)}))\n`;
      // In the body, after the boot terminal's markup, so its 37 KB do not hold back the page's first paint.
      return [{ tag: "script", attrs: { "data-foss-earth-browser-recovery": appId }, children, injectTo: "body-prepend" }];
    },
  };
}

/**
 * Runs first in <head>: marks when the HTML began to run, and gives the
 * terminal the theme the app will start in (ui/src/browser/theme.ts), where
 * the visitor chose one. Without a choice it follows the device.
 */
const BOOT_HEAD_SCRIPT = `(()=>{try{performance.getEntriesByName("boot:html").length||performance.mark("boot:html")}catch{}let t=null;try{const s=localStorage,v=s.getItem("foss-earth.theme");if(v!=="auto"){t=v==="light"||v==="dark"?v:null;if(!t){const r=JSON.parse(s.getItem("foss-earth.settings.v1")??"null"),w=r?.version===1?r.values?.["interface.theme"]:null;t=w==="light"||w==="dark"?w:null}}}catch{}if(t)document.documentElement.setAttribute("data-boot-theme",t)})()`;
const BOOT_LIGHT_MARKER = "/* LIGHT:";
const bootStyleCache = new Map();
/** The terminal's style, without its comments and line breaks; a page that is always dark leaves out the light palettes. */
function bootStyle(theme) {
  const source = join(browserSource, "bootTerminal.css");
  const mtimeMs = statSync(source).mtimeMs;
  const key = `${source} ${theme}`;
  const cached = bootStyleCache.get(key);
  if (cached?.mtimeMs === mtimeMs) return cached.style;
  let css = readFileSync(source, "utf8");
  if (theme === "dark") css = css.slice(0, css.indexOf(BOOT_LIGHT_MARKER));
  const style = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "").trim();
  if (/<\/style/i.test(style)) throw new Error("The boot terminal's style cannot hold </style.");
  bootStyleCache.set(key, { mtimeMs, style });
  return style;
}
const escapeHtml = text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Compressed sizes, once per build however many pages ask. */
const gzipSizes = new WeakMap();
function gzipSize(bundle, fileName) {
  let sizes = gzipSizes.get(bundle);
  if (!sizes) gzipSizes.set(bundle, sizes = new Map());
  let size = sizes.get(fileName);
  if (size === undefined) {
    const output = bundle[fileName];
    size = gzipSync(output.type === "chunk" ? output.code : output.source).length;
    sizes.set(fileName, size);
  }
  return size;
}
/**
 * What a page waits for before its first module runs: its entry, the entry's
 * static imports and their styles, and the lazy modules named by `waitFor`
 * with theirs.
 */
function bootGraph(bundle, entry, waitFor, root) {
  const files = new Set();
  const visit = fileName => {
    const output = bundle[fileName];
    if (!output || files.has(fileName)) return;
    files.add(fileName);
    if (output.type !== "chunk") return;
    for (const imported of output.imports ?? []) visit(imported);
    for (const css of output.viteMetadata?.importedCss ?? []) visit(css);
  };
  visit(entry.fileName);
  for (const id of waitFor) {
    const file = posix.normalize(join(root, id).split("\\").join("/"));
    const chunk = Object.values(bundle).find(output => output.type === "chunk" && output.facadeModuleId?.split("?")[0] === file);
    if (!chunk) throw new Error(`bootTerminal waitFor names ${id}, which no chunk of this build starts from.`);
    visit(chunk.fileName);
  }
  return [...files].sort().map(file => [file, gzipSize(bundle, file)]);
}
/** Where a page's own URLs start: the base, or for a relative base, the way back from the page's folder. */
function bootBase(base, pagePath) {
  if (/^(?:[a-z][\w+.-]*:)?\//i.test(base)) return base.endsWith("/") ? base : `${base}/`;
  const depth = pagePath.split("/").filter(Boolean).length - 1;
  return "../".repeat(depth) || "./";
}

/**
 * The boot terminal (docs/proposals/startup-loading.md, The boot terminal):
 * a page paints a terminal from its first bytes, whose lines and bar follow
 * the app's download and start until its 3D scene's first frame
 * (src/browser/bootTerminal.ts). The page's stylesheets move to the end of its
 * body, so they no longer hold back that first paint; its modules still wait
 * for them.
 */
export function bootTerminal(options = {}) {
  const theme = options.theme ?? "auto";
  if (theme !== "auto" && theme !== "dark") throw new TypeError('bootTerminal theme must be "auto" or "dark".');
  if (options.title !== undefined && (typeof options.title !== "string" || !options.title.trim())) throw new TypeError("bootTerminal title must be a nonempty string.");
  const pages = options.pages ?? (() => true);
  const waitFor = options.waitFor ?? [];
  let base = "/", root = process.cwd();
  return {
    name: "foss-earth-boot-terminal",
    configResolved(config) {
      base = config.base ?? "/";
      root = config.root ?? root;
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!pages(ctx.path)) return html;
        const headOpen = html.match(/<head\b[^>]*>/i), bodyOpen = html.match(/<body\b[^>]*>/i);
        const headClose = html.search(/<\/head>/i), bodyClose = html.search(/<\/body>/i);
        if (!headOpen || !bodyOpen || headClose < 0 || bodyClose < 0) throw new Error(`bootTerminal needs <head> and <body> in ${ctx.path}.`);
        const title = options.title === undefined
          ? html.match(/<title>([^<]*)<\/title>/i)?.[1].trim() || "Loading"
          : escapeHtml(options.title);
        const graph = ctx.bundle && ctx.chunk ? { base: bootBase(base, ctx.path), files: bootGraph(ctx.bundle, ctx.chunk, waitFor, root) } : null;
        const runtime = `"use strict";(()=>{\n${inlineRuntime("bootTerminal.ts", "The boot terminal's runtime")}\ninstallBootTerminal(window, ${JSON.stringify(graph).replace(/</g, "\\u003c")});\n})();`;
        if (/<\/script|<!--/i.test(runtime)) throw new Error("The boot terminal's runtime cannot hold </script or <!--.");
        const markup = `<div id="foss-earth-boot"><p class="fe-boot__title">${title}</p>`
          + `<ol role="log" aria-label="Loading" aria-relevant="additions"><li data-id="download" data-tone="info">Downloading the app…</li></ol>`
          + `<div class="fe-boot__bar" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>`
          + `<noscript><p>This page needs JavaScript to start.</p></noscript></div>`;
        // The page's stylesheets move from <head> to the end of <body>.
        const head = html.slice(headOpen.index + headOpen[0].length, headClose);
        const sheets = [];
        const keptHead = head.replace(/[ \t]*<link\b[^>]*\brel=["']?stylesheet\b[^>]*>[ \t]*\n?/gi, tag => { sheets.push(tag.trim()); return ""; });
        // Right after <meta charset>, which must stay within the first 1024 bytes.
        const charset = keptHead.match(/<meta\s+charset=[^>]*>/i);
        const at = charset ? charset.index + charset[0].length : 0;
        const headStart = `<style id="foss-earth-boot-style">${bootStyle(theme)}</style><script>${BOOT_HEAD_SCRIPT}</script>`;
        const newHead = keptHead.slice(0, at) + headStart + keptHead.slice(at);
        const body = html.slice(bodyOpen.index + bodyOpen[0].length, bodyClose);
        return html.slice(0, headOpen.index + headOpen[0].length) + newHead + html.slice(headClose, bodyOpen.index + bodyOpen[0].length)
          + markup + `<script>${runtime}</script>` + body + sheets.map(tag => `${tag}\n`).join("") + html.slice(bodyClose);
      },
    },
  };
}

/** At most this many files of the pages to come are fetched at once while a page warms them. */
const WARM_AT_ONCE = 4;
/**
 * Warms other pages from this one (docs/proposals/startup-loading.md, Target
 * experience, T0). Speculation rules fetch a page's HTML when a link to it is
 * hovered or pressed. Once this page is loaded and idle, the files those pages
 * wait for before their first module runs go into the HTTP cache, largest
 * first, a few at a time, while the page is visible. Nothing is warmed under
 * Save-Data or on a 2G connection.
 */
export function warmPages(options) {
  const from = options?.from, pages = options?.pages;
  if (typeof from !== "string" || !Array.isArray(pages) || pages.length === 0 || pages.some(page => typeof page !== "string" || !page.endsWith(".html"))) {
    throw new TypeError("warmPages needs the page that warms and the .html pages it warms, as build paths such as \"/minneapolis/index.html\".");
  }
  let base = "/", root = process.cwd();
  return {
    name: "foss-earth-warm-pages",
    apply: "build",
    configResolved(config) {
      base = config.base ?? "/";
      root = config.root ?? root;
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (ctx.path !== from || !ctx.bundle) return html;
        const prefix = bootBase(base, ctx.path);
        const files = new Map();
        for (const page of pages) {
          const file = posix.normalize(join(root, page).split("\\").join("/"));
          const entry = Object.values(ctx.bundle).find(output => output.type === "chunk" && output.facadeModuleId?.split("?")[0] === file);
          if (!entry) throw new Error(`warmPages names ${page}, which is not a page of this build.`);
          for (const [name, bytes] of bootGraph(ctx.bundle, entry, [], root)) files.set(name, bytes);
        }
        const urls = [...files].sort((a, b) => b[1] - a[1]).map(([name]) => prefix + name);
        const hrefs = pages.map(page => prefix + page.replace(/^\//, "").replace(/(?:^|\/)index\.html$/, match => match.startsWith("/") ? "/" : ""));
        const rules = { prefetch: [{ source: "document", where: { or: hrefs.map(href => ({ href_matches: href })) }, eagerness: "moderate" }] };
        const warm = `(()=>{const c=navigator.connection;if(c&&(c.saveData||/2g$/.test(c.effectiveType||"")))return;`
          + `const files=${JSON.stringify(urls).replace(/</g, "\\u003c")};let next=0,active=0;`
          + `const pump=()=>{while(!document.hidden&&active<${WARM_AT_ONCE}&&next<files.length){const link=document.createElement("link");link.rel="prefetch";link.href=files[next++];active++;link.onload=link.onerror=()=>{active--;pump()};document.head.append(link)}};`
          + `const start=()=>{document.addEventListener("visibilitychange",pump);pump()};`
          + `const idle=()=>"requestIdleCallback"in window?requestIdleCallback(start,{timeout:5000}):setTimeout(start,1000);`
          + `document.readyState==="complete"?idle():addEventListener("load",idle,{once:true})})()`;
        const bodyClose = html.search(/<\/body>/i);
        if (bodyClose < 0) throw new Error(`warmPages needs <body> in ${ctx.path}.`);
        return html.slice(0, bodyClose)
          + `<script type="speculationrules">${JSON.stringify(rules).replace(/</g, "\\u003c")}</script>\n<script>${warm}</script>\n`
          + html.slice(bodyClose);
      },
    },
  };
}
