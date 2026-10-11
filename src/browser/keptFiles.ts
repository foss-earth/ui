/** Shared keeper extracted from Earth App/appFiles; deployment and policy are injected. */
import type { AppFilesStatus } from "../diagnostics/appFiles.js";
export interface KeptFilesEnvironment {
  worker: { url: string } | { unavailable: string };
  scope: string;
  container: Pick<ServiceWorkerContainer, "register" | "getRegistration" | "ready" | "controller"> | null;
  caches: Pick<CacheStorage, "open" | "has" | "delete"> | null;
  observeLoaded(listener: (urls: string[]) => void): () => void;
  onControllerChange(listener: () => void): () => void;
  afterLoad(work: () => void): void | (() => void);
}
export interface KeptFilesClientOptions {
  environment: KeptFilesEnvironment;
  policy: { enabled(): boolean; subscribe(listener: () => void): () => void };
  /** Shared across this deployment's exact worker and client; no app identity inference. */
  cacheNamespace: string;
  messageIdentity?: string;
  onError(error: unknown): void;
  signal?: AbortSignal;
}
export interface KeptFilesClient {
  status(): Promise<AppFilesStatus>;
  settled(): Promise<void>;
  whenSettled(): Promise<void>;
  dispose(): void;
}
export function keptFilesCacheName(workerUrl: string, namespace: string): string {
  if (!namespace.trim()) throw new TypeError("A deployment cache namespace is required.");
  return `${namespace} ${new URL(workerUrl).pathname}`;
}
export function createKeptFilesClient(options: KeptFilesClientOptions): KeptFilesClient {
  const { environment, policy } = options;
  const { container, caches: storage, scope } = environment;
  const workerUrl = "url" in environment.worker ? environment.worker.url : null;
  const unavailable = "unavailable" in environment.worker ? environment.worker.unavailable : null;
  const cacheName = workerUrl ? keptFilesCacheName(workerUrl, options.cacheNamespace) : null;
  let disposed = false, started = false;
  let stopObserving = (): void => {}, stopLoaded = (): void => {};
  let offLoad: void | (() => void), offWatch = (): void => {};
  const errors: unknown[] = [];
  const report = (error: unknown): void => { try { options.onError(error); } catch (reporting) { errors.push(reporting); } };
  const cancelReady = new Set<() => void>();
  let queue: Promise<void> = Promise.resolve();
  const ours = (registration: ServiceWorkerRegistration | undefined): registration is ServiceWorkerRegistration => {
    const script = registration?.active ?? registration?.waiting ?? registration?.installing;
    return Boolean(registration) && (!script || script.scriptURL === workerUrl);
  };
  const message = (type: string, urls?: string[]) => ({ type, ...(urls ? { urls } : {}),
    ...(options.messageIdentity ? { identity: options.messageIdentity } : {}) });
  async function keep(): Promise<void> {
    await container!.register(workerUrl!, { scope, updateViaCache: "none" });
    if (disposed || !policy.enabled()) return;
    // Registration itself is awaited. `ready` only observes activation and can
    // be abandoned on opt-out/disposal without claiming native retirement.
    const ready = await new Promise<ServiceWorkerRegistration | null>((resolve, reject) => {
      const cancel = () => { cancelReady.delete(cancel); resolve(null); };
      cancelReady.add(cancel);
      void container!.ready.then(value => { cancelReady.delete(cancel); resolve(value); }, error => { cancelReady.delete(cancel); reject(error); });
      if (disposed || !policy.enabled()) cancel();
    });
    if (disposed || !policy.enabled()) return;
    if (!ready) return;
    if (!ours(ready)) throw new Error("The ready worker belongs to another deployment.");
    stopObserving();
    const observe = (): void => {
      stopLoaded();
      const controller = container!.controller;
      const active = controller?.scriptURL === workerUrl ? controller : ready.active;
      stopLoaded = environment.observeLoaded(urls => active?.postMessage(message("foss-earth-keep", urls)));
    };
    let stopChanges = (): void => {};
    stopObserving = () => {
      const failures: unknown[] = [];
      for (const stop of [stopLoaded, stopChanges]) { try { stop(); } catch (error) { failures.push(error); } }
      stopLoaded = () => {};
      if (failures.length) throw new AggregateError(failures, "Kept-file observers cleanup failed.");
    };
    observe(); stopChanges = environment.onControllerChange(observe);
  }
  async function forget(): Promise<void> {
    const failures: unknown[] = [];
    try { stopObserving(); } catch (error) { failures.push(error); } stopObserving = () => {};
    const registration = await container!.getRegistration(scope);
    if (!ours(registration)) {
      if (failures.length) throw new AggregateError(failures, "Kept-file opt-out failed.");
      return;
    }
    for (const action of [() => registration.active?.postMessage(message("foss-earth-forget")),
      () => registration.unregister(), () => storage!.delete(cacheName!)]) {
      try { await action(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Kept-file opt-out failed.");
  }
  const apply = (): void => {
    if (!started || disposed || !workerUrl || !container || !storage) return;
    const wanted = policy.enabled();
    if (!wanted) for (const cancel of [...cancelReady]) cancel();
    queue = queue.then(async () => { if (!disposed) await (wanted ? keep() : forget()); }).catch(error => {
      errors.push(error); report(error);
    });
  };
  const dispose = (): void => {
    if (disposed) return; disposed = true;
    const failures: unknown[] = [];
    for (const stop of [...cancelReady, offWatch, stopObserving, () => { if (typeof offLoad === "function") offLoad(); },
      () => options.signal?.removeEventListener("abort", abort)]) { try { stop(); } catch (error) { failures.push(error); } }
    errors.push(...failures);
    if (failures.length) throw new AggregateError(failures, "Kept-file client cleanup failed.");
  };
  const abort = (): void => { try { dispose(); } catch (error) { report(error); } };
  try {
    offLoad = environment.afterLoad(() => { started = true; apply(); });
    offWatch = policy.subscribe(apply);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  } catch (error) {
    try { dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Kept-file setup failed."); }
    throw error;
  }
  return {
    async status() {
      if (unavailable || !container || !storage || !cacheName) return {
        unavailable: unavailable ?? "This browser cannot keep the app's files for this page.", installed: false, controlling: false, files: 0, bytes: 0,
      };
      const registration = await container.getRegistration(scope);
      let files = 0, bytes = 0;
      if (await storage.has(cacheName)) {
        const cache = await storage.open(cacheName);
        for (const request of await cache.keys()) { const response = await cache.match(request); files += 1; bytes += response ? (await response.blob()).size : 0; }
      }
      return { unavailable: null, installed: ours(registration) && Boolean(registration.active),
        controlling: container.controller?.scriptURL === workerUrl, files, bytes };
    },
    settled: () => queue,
    async whenSettled() { await queue; if (errors.length) throw new AggregateError(errors, "Kept-file client operations failed."); },
    dispose,
  };
}
