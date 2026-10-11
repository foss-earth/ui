import type { PublishedVersion } from "../diagnostics/publishedVersion.js";

/** Stamps belong to About/host provenance. No HTML/build/Git assumptions here. */
export interface PublishedVersionReadPorts {
  build: string | null;
  readPage(signal: AbortSignal): Promise<string>;
  parseStamp(html: string): string | null;
  compareStamps(mine: string, other: string): "same" | "newer" | "older";
  createAbortController(): AbortController;
  now(): number;
  setTimer(work: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}
export interface PublishedVersionWatchOptions {
  environment: PublishedVersionReadPorts & {
    shown(): boolean;
    onReturn(listener: () => void): () => void;
    reload(): void;
  };
  policy: {
    enabled(): boolean;
    intervalMs(): number;
    watchEnabled(listener: () => void): () => void;
    watchInterval(listener: () => void): () => void;
  };
  signal?: AbortSignal;
  timeoutMs?: number;
  onError?(error: unknown): void;
}
export interface ReportOnlyPublishedVersionWatch {
  state(): PublishedVersion;
  subscribe(listener: (state: PublishedVersion) => void): () => void;
  ask(): Promise<PublishedVersion>;
  /** Only this explicit caller action reloads; checking/return/timers never do. */
  reload(): void;
  now(): number;
  whenSettled(): Promise<void>;
  dispose(): void;
}
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/, "") || "the request failed";

export async function askPublishedVersion(ports: PublishedVersionReadPorts, options: {
  timeoutMs?: number; signal?: AbortSignal; controller?: AbortController;
} = {}): Promise<PublishedVersion> {
  const { build } = ports;
  if (!build) return { kind: "unstamped" };
  const timeout = options.timeoutMs ?? 20_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError("Published-version deadline must be positive finite milliseconds.");
  const controller = options.controller ?? ports.createAbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let timedOut = false;
  let timer: unknown;
  let hasTimer = false;
  let result: PublishedVersion;
  const failures: unknown[] = [];
  try {
    timer = ports.setTimer(() => { timedOut = true; controller.abort(new Error("Published-version request timed out.")); }, timeout);
    hasTimer = true;
    controller.signal.throwIfAborted();
    const published = ports.parseStamp(await ports.readPage(controller.signal));
    controller.signal.throwIfAborted();
    const at = ports.now();
    if (!published) result = { kind: "unanswered", build, why: "the page it answered with does not say which build it is", at };
    else {
      const order = ports.compareStamps(build, published);
      result = order === "same" ? { kind: "published", build, at } : order === "newer" ? { kind: "older", build, published, at } : { kind: "ahead", build, published, at };
    }
  } catch (error) { result = { kind: "unanswered", build, why: timedOut ? "it did not answer in time" : reasonOf(error), at: ports.now() }; }
  finally {
    for (const release of [() => { if (hasTimer) ports.clearTimer(timer); }, () => options.signal?.removeEventListener("abort", abort)]) {
      try { release(); } catch (error) { failures.push(error); }
    }
  }
  if (failures.length) throw new AggregateError(failures, "Published-version transport cleanup failed.");
  return result;
}

/** Faithful cadence/deduplication from App/publishedVersion; report-only by construction. */
export function createPublishedVersionWatcher(options: PublishedVersionWatchOptions): ReportOnlyPublishedVersionWatch {
  const { environment: env, policy } = options, build = env.build;
  let state: PublishedVersion = !build ? { kind: "unstamped" } : policy.enabled() ? { kind: "not-asked", build } : { kind: "off", build };
  let disposed = false, askedAt: number | null = null, timer: unknown = null, generation = 0;
  let asking: Promise<PublishedVersion> | null = null, controller: AbortController | null = null;
  const listeners = new Set<(state: PublishedVersion) => void>(), stops: (() => void)[] = [], errors: unknown[] = [];
  const report = (error: unknown): void => { try { options.onError?.(error); } catch (reporting) { errors.push(reporting); } };
  const set = (next: PublishedVersion): void => {
    state = next;
    for (const listener of [...listeners]) { try { listener(next); } catch (error) { errors.push(error); report(error); } }
  };
  const fire = (): void => { void ask().catch(error => { errors.push(error); report(error); }); };
  const interval = (): number => {
    const ms = policy.intervalMs(); if (!Number.isFinite(ms) || ms <= 0) throw new RangeError("Version-check interval must be positive finite milliseconds."); return ms;
  };
  const schedule = (): void => {
    if (timer !== null) env.clearTimer(timer); timer = null;
    if (!build || disposed || !policy.enabled()) return;
    timer = env.setTimer(() => { timer = null; if (env.shown()) fire(); }, interval());
  };
  const ask = async (): Promise<PublishedVersion> => {
    if (!build || disposed || !policy.enabled()) return state;
    if (asking) return asking;
    controller = env.createAbortController(); askedAt = env.now();
    const current = controller, currentGeneration = generation;
    const work = askPublishedVersion(env, { timeoutMs: options.timeoutMs, controller: current, signal: options.signal }).then(next => {
      if (disposed || !policy.enabled() || generation !== currentGeneration) return state;
      set(next); schedule(); return state;
    }).finally(() => {
      if (controller === current) controller = null;
      if (asking === work) asking = null;
      if (!disposed && policy.enabled() && generation !== currentGeneration) fire();
    });
    asking = work;
    return work;
  };
  const dispose = (): void => {
    if (disposed) return; disposed = true; generation += 1;
    for (const action of [() => controller?.abort(new Error("Version watcher disposed.")),
      () => { if (timer !== null) env.clearTimer(timer); timer = null; }, ...stops.splice(0),
      () => listeners.clear(), () => options.signal?.removeEventListener("abort", abort)]) {
      try { action(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Published-version watcher cleanup failed.");
  };
  const abort = (): void => { try { dispose(); } catch (error) { report(error); } };
  try {
    if (build) {
      stops.push(env.onReturn(() => { if (policy.enabled() && env.shown() && (askedAt === null || state.kind === "unanswered" || env.now() - askedAt >= interval())) fire(); }));
      stops.push(policy.watchEnabled(() => {
        if (policy.enabled()) { if (state.kind === "off") set({ kind: "not-asked", build }); fire(); }
        else { generation += 1; controller?.abort(new Error("Version checks disabled.")); set({ kind: "off", build }); schedule(); }
      }));
      stops.push(policy.watchInterval(schedule));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort(); else if (policy.enabled()) fire();
    }
  } catch (error) { try { dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Version watcher setup failed."); } throw error; }
  return {
    state: () => state, ask, now: () => env.now(),
    subscribe(listener) { if (!disposed) listeners.add(listener); return () => listeners.delete(listener); },
    reload() { if (!disposed) env.reload(); },
    dispose,
    async whenSettled() { while (asking) await asking; if (errors.length) throw new AggregateError(errors, "Version watcher retirement failed."); },
  };
}
