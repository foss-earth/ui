/** Structural Vite hook contract; importing the optional entry needs only Node. */
export interface KeptFilePin { url: string; sha256: string; sizeBytes: number }
export interface KeptFilesProducerOptions {
  base?: string; scope?: string; workerFile?: string; cacheNamespace?: string; identity?: string;
  retention?: "retain-older" | "current-only";
  extraFiles?: readonly KeptFilePin[]; retainedFiles?: readonly KeptFilePin[];
}
export interface KeptFilesWorkerResult {
  source: string; kept: string[]; unhashed: string[];
  manifest: { schemaVersion: 1; base: string; scope: string; workerFile: string; cacheNamespace: string; identity: string | null;
    retention: "retain-older" | "current-only"; files: readonly { url: string; sha256?: string; sizeBytes?: number }[]; retainedFiles: readonly KeptFilePin[] };
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
  transformIndexHtml(): { tag: string; attrs: { name: string; content: string }; injectTo: "head" }[];
  generateBundle(this: { warn(message: string): void; emitFile(file: { type: "asset"; fileName: string; source: string }): unknown }, output: unknown, bundle: Record<string, unknown>): void;
}
export function appFiles(options?: KeptFilesPlugin): AppFilesPlugin;
export interface BrowserRecoveryPluginOptions { appId: string }
export interface BrowserRecoveryPlugin {
  name: string;
  transformIndexHtml(): { tag: string; attrs: { "data-foss-earth-browser-recovery": string }; children: string; injectTo: "head-prepend" }[];
}
export function browserRecovery(options: BrowserRecoveryPluginOptions): BrowserRecoveryPlugin;
