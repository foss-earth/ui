import { afterEach, expect, it, vi } from "vitest";
import { createPublishedVersionWatcher } from "../src/browser/publishedVersionWatch.js";
function fixture() {
  let enabled = true, change = () => {}, reads = 0;
  const pending: { signal: AbortSignal; resolve(html: string): void }[] = [];
  const reload = vi.fn();
  const watch = createPublishedVersionWatcher({ environment: { build: "1", parseStamp: html => html, compareStamps: (a,b) => a === b ? "same" : b > a ? "newer" : "older",
    readPage: signal => { reads++; return new Promise(resolve => pending.push({ signal, resolve })); }, createAbortController: () => new AbortController(), now: () => 10,
    setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>), shown: () => true, onReturn: () => () => {}, reload },
    policy: { enabled: () => enabled, intervalMs: () => 100, watchEnabled(listener) { change = listener; return () => {}; }, watchInterval: () => () => {} } });
  return { watch, pending, reload, reads: () => reads, setEnabled(value: boolean) { enabled = value; change(); } };
}
afterEach(() => vi.useRealTimers());
it("reports an older page, deduplicates pending reads, and reloads only for an explicit caller action", async () => {
  vi.useFakeTimers(); const f = fixture(); const first = f.watch.ask(), second = f.watch.ask(); expect(f.reads()).toBe(1);
  f.pending[0].resolve("2"); await first; await second; expect(f.watch.state()).toMatchObject({ kind: "older", published: "2" });
  expect(f.reload).not.toHaveBeenCalled(); f.watch.reload(); expect(f.reload).toHaveBeenCalledOnce(); f.watch.dispose(); await f.watch.whenSettled(); expect(vi.getTimerCount()).toBe(0);
});
it("rejects stale answers across disable/reenable while retaining the actual pending read", async () => {
  vi.useFakeTimers(); const f = fixture(); f.setEnabled(false); expect(f.pending[0].signal.aborted).toBe(true); f.setEnabled(true);
  f.pending[0].resolve("9"); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(f.watch.state().kind).not.toBe("older"); expect(f.reads()).toBe(2);
  f.pending[1].resolve("1"); await f.watch.whenSettled(); expect(f.watch.state().kind).toBe("published"); f.watch.dispose();
});
it("waits the actual aborted transport through disposal and ignores its late result", async () => {
  vi.useFakeTimers(); const f = fixture(); f.watch.dispose(); expect(f.pending[0].signal.aborted).toBe(true);
  let done = false; const drain = f.watch.whenSettled().then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
  f.pending[0].resolve("3"); await drain; expect(f.watch.state().kind).toBe("not-asked"); expect(f.reload).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
