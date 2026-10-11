import { createKeptFilesClient, createPublishedVersionWatcher, askPublishedVersion, type KeptFilesClientOptions, type PublishedVersionWatchOptions, type PublishedVersionReadPorts } from "@foss-earth/ui/browser";
import { appFiles, appFilesWorker, type KeptFilesProducerOptions, type KeptFilesWorkerResult } from "@foss-earth/ui/vite";
import type { PublishedVersion, AppFilesStatus } from "@foss-earth/ui/diagnostics";
export function keeperContract(input: KeptFilesClientOptions) {
  const client = createKeptFilesClient(input);
  const status: Promise<AppFilesStatus> = client.status();
  return { status, whenSettled: client.whenSettled, dispose: client.dispose };
}
export function reportOnlyContract(input: PublishedVersionWatchOptions) {
  const watcher = createPublishedVersionWatcher(input);
  const current: PublishedVersion = watcher.state();
  return { current, ask: watcher.ask, explicitReload: watcher.reload, whenSettled: watcher.whenSettled, dispose: watcher.dispose };
}
export const readContract = (input: PublishedVersionReadPorts): Promise<PublishedVersion> => askPublishedVersion(input);
export function buildContract(names: readonly string[], input: KeptFilesProducerOptions): KeptFilesWorkerResult { return appFilesWorker(names, input); }
export const plugin = appFiles({ stamps: { "host-build-stamp": "supplied-by-about-or-host" }, retention: "retain-older" });
