/** Structural Vite hook contract; importing the optional entry needs only Node. */
export interface KeptFilePin { url: string; sha256: string; sizeBytes: number }
export interface KeptFilesProducerOptions {
  base?: string; scope?: string; workerFile?: string; cacheNamespace?: string; identity?: string;
  retention?: "retain-older" | "current-only";
  /** Whether the worker may isolate its pages, when they ask in its address (ui/src/browser/isolation.ts). Default "off". */
  isolation?: "off" | "report-only" | "enforce";
  /** False for a worker that only isolates, for an app that keeps none of its files on the device. Default true. */
  keepFiles?: boolean;
  extraFiles?: readonly KeptFilePin[]; retainedFiles?: readonly KeptFilePin[];
}
export interface KeptFilesWorkerResult {
  source: string; kept: string[]; unhashed: string[];
  manifest: { schemaVersion: 1; base: string; scope: string; workerFile: string; cacheNamespace: string; identity: string | null;
    retention: "retain-older" | "current-only"; isolation: "off" | "report-only" | "enforce"; keepFiles: boolean; files: readonly { url: string; sha256?: string; sizeBytes?: number }[]; retainedFiles: readonly KeptFilePin[] };
  receipt: { state: "PRODUCED_NOT_QUALIFIED"; schemaVersion: 1; templateSha256: string; manifestSha256: string; workerSha256: string; workerSizeBytes: number };
}
export const APP_FILES_WORKER: "foss-earth-sw.js";
export function appFilesWorker(fileNames: readonly string[], options?: KeptFilesProducerOptions): KeptFilesWorkerResult;
export interface KeptFilesPluginConfig { base?: string; define?: Record<string, unknown>; root?: string }
export interface KeptFilesPlugin extends KeptFilesProducerOptions {
  manifestFile?: string;
  stamps?: Readonly<Record<string, string | null>> | ((config: KeptFilesPluginConfig, env: { command: "build" | "serve" }) => Readonly<Record<string, string | null>>);
  onProduced?(result: KeptFilesWorkerResult): void;
}
export interface AppFilesPlugin {
  name: string;
  config(config: KeptFilesPluginConfig, env: { command: "build" | "serve" }): { define: Record<string, string> };
  transformIndexHtml(): ({ tag: "meta"; attrs: { name: string; content: string }; injectTo: "head" }
    | { tag: "script"; attrs: { "data-foss-earth-isolation": string }; children: string; injectTo: "head-prepend" })[];
  generateBundle(this: { warn(message: string): void; emitFile(file: { type: "asset"; fileName: string; source: string }): unknown }, output: unknown, bundle: Record<string, unknown>): void;
}
export function appFiles(options?: KeptFilesPlugin): AppFilesPlugin;
export interface BrowserRecoveryPluginOptions { appId: string }
export interface BrowserRecoveryPlugin {
  name: string;
  transformIndexHtml(): { tag: string; attrs: { "data-foss-earth-browser-recovery": string }; children: string; injectTo: "body-prepend" }[];
}
export function browserRecovery(options: BrowserRecoveryPluginOptions): BrowserRecoveryPlugin;
export interface BootTerminalPluginOptions {
  /** The terminal's first line. Default: the page's <title>. */
  title?: string;
  /** "dark" keeps the terminal dark whatever the device's or the visitor's theme. Default "auto". */
  theme?: "auto" | "dark";
  /** Which pages get the terminal, by their path in the build, such as "/minneapolis/index.html". Default: every page. */
  pages?: (path: string) => boolean;
  /** Modules, relative to the root, that a page imports lazily and needs before its first frame: their files count as its download, and the page fetches them at once. */
  waitFor?: readonly string[];
}
export interface BootTerminalPlugin {
  name: string;
  configResolved(config: { base?: string; root?: string }): void;
  transformIndexHtml: {
    order: "post";
    handler(html: string, ctx: { path: string; bundle?: Record<string, unknown>; chunk?: { fileName: string } }): string;
  };
}
export function bootTerminal(options?: BootTerminalPluginOptions): BootTerminalPlugin;
export interface WarmPagesPluginOptions {
  /** The page that warms the others, as its build path: "/index.html". */
  from: string;
  /** The pages it warms, as build paths: "/minneapolis/index.html". */
  pages: readonly string[];
}
export interface WarmPagesPlugin {
  name: string;
  apply: "build";
  configResolved(config: { base?: string; root?: string }): void;
  transformIndexHtml: {
    order: "post";
    handler(html: string, ctx: { path: string; bundle?: Record<string, unknown> }): string;
  };
}
export function warmPages(options: WarmPagesPluginOptions): WarmPagesPlugin;
