import { expect, it, vi } from "vitest";
import { createKeptFilesClient, type KeptFilesEnvironment } from "../src/browser/keptFiles.js";
function worker(scriptURL: string, state: ServiceWorkerState = "activated") {
  const value = Object.assign(new EventTarget(), { scriptURL, state, postMessage: vi.fn() });
  const removeListener = vi.spyOn(value, "removeEventListener");
  return { value, removeListener, setState(next: ServiceWorkerState) { value.state = next; value.dispatchEvent(new Event("statechange")); } };
}
function fixture(workerUrl = "https://host.test/foss-earth-sw.js", scope = "/") {
  let enabled = true, change = () => {}, loaded = () => {};
  let ready!: (value: ServiceWorkerRegistration) => void;
  const unregister = vi.fn(async () => true), remove = vi.fn(async () => true);
  const activeWorker = worker(workerUrl), active = activeWorker.value, postMessage = active.postMessage;
  const registration = { active, unregister } as unknown as ServiceWorkerRegistration;
  const register = vi.fn(async () => registration), stopLoaded = vi.fn(), stopController = vi.fn(), onError = vi.fn();
  const env: KeptFilesEnvironment = { worker: { url: active.scriptURL }, scope,
    container: { register, getRegistration: async () => registration, controller: active as ServiceWorker,
      ready: new Promise(resolve => { ready = resolve; }) },
    caches: { open: vi.fn(), has: async () => false, delete: remove },
    observeLoaded: () => stopLoaded, onControllerChange: () => stopController, afterLoad: work => { loaded = work; } };
  const keeper = createKeptFilesClient({ environment: env, cacheNamespace: "host-files", messageIdentity: "build-1",
    policy: { enabled: () => enabled, subscribe(listener) { change = listener; return () => {}; } }, onError });
  return { keeper, env, register, registration, ready: () => ready(registration), load: () => loaded(),
    optOut() { enabled = false; change(); }, activeWorker, postMessage, unregister, remove, stopLoaded, stopController, onError };
}
it("waits until after page load and cancels only activation observation on opt-out", async () => {
  const f = fixture(); f.activeWorker.setState("activating");
  expect(f.register).not.toHaveBeenCalled(); f.load(); await Promise.resolve(); await Promise.resolve();
  expect(f.register).toHaveBeenCalledWith("https://host.test/foss-earth-sw.js", { scope: "/", updateViaCache: "none" });
  f.optOut(); await f.keeper.whenSettled(); expect(f.unregister).toHaveBeenCalledOnce();
  expect(f.remove).toHaveBeenCalledWith("host-files /foss-earth-sw.js");
  expect(f.postMessage).toHaveBeenCalledWith({ type: "foss-earth-forget", identity: "build-1" });
  expect(f.activeWorker.removeListener).toHaveBeenCalledOnce(); f.keeper.dispose();
});
it("waits for the registered narrower-scope worker when ready already belongs to the root worker", async () => {
  const f = fixture("https://host.test/tour/foss-earth-sw.js", "/tour/"), tour = f.activeWorker;
  tour.setState("installing");
  const rootWorker = worker("https://host.test/foss-earth-sw.js");
  const rootUnregister = vi.fn(), root = { active: rootWorker.value, unregister: rootUnregister } as unknown as ServiceWorkerRegistration;
  Object.assign(f.registration, { active: null, waiting: null, installing: tour.value });
  f.env.container!.ready = Promise.resolve(root); f.env.container!.controller = rootWorker.value as ServiceWorker;
  const observe = vi.fn((listener: (urls: string[]) => void) => {
    listener(["https://host.test/tour/assets/app-Abc12345.js"]); return f.stopLoaded;
  });
  f.env.observeLoaded = observe;
  f.load(); await Promise.resolve(); await Promise.resolve();
  expect(f.register).toHaveBeenCalledWith(tour.value.scriptURL, { scope: "/tour/", updateViaCache: "none" });
  let settled = false; const drain = f.keeper.whenSettled().then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false); expect(observe).not.toHaveBeenCalled();
  Object.assign(f.registration, { installing: null, waiting: tour.value }); tour.setState("installed");
  expect(observe).not.toHaveBeenCalled();
  Object.assign(f.registration, { waiting: null, active: tour.value }); tour.setState("activated");
  await drain;
  expect(observe).toHaveBeenCalledOnce(); expect(tour.value.postMessage).toHaveBeenCalledWith({
    type: "foss-earth-keep", identity: "build-1", urls: ["https://host.test/tour/assets/app-Abc12345.js"],
  });
  expect(rootWorker.value.postMessage).not.toHaveBeenCalled(); expect(f.onError).not.toHaveBeenCalled();
  expect(tour.removeListener).toHaveBeenCalledOnce(); expect(rootUnregister).not.toHaveBeenCalled();
  f.optOut(); await f.keeper.whenSettled();
  expect(f.unregister).toHaveBeenCalledOnce(); expect(rootUnregister).not.toHaveBeenCalled();
  expect(f.remove).toHaveBeenCalledWith("host-files /tour/foss-earth-sw.js"); f.keeper.dispose();
});
it("does not unregister or delete another deployment on opt-out", async () => {
  const f = fixture(); f.env.container!.getRegistration = async () => ({ ...f.registration,
    active: { scriptURL: "https://host.test/foreign.js" } } as ServiceWorkerRegistration);
  f.load(); f.optOut(); await f.keeper.whenSettled(); expect(f.unregister).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); f.keeper.dispose();
});
it("waits actual registration through disposal rather than pretending an abort completed it", async () => {
  const f = fixture(); let registerDone!: (value: ServiceWorkerRegistration) => void;
  f.register.mockImplementation(() => new Promise(done => { registerDone = done; })); f.load(); await Promise.resolve(); f.keeper.dispose();
  let settled = false; const drain = f.keeper.whenSettled().then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
  registerDone(f.registration); await drain; expect(f.stopLoaded).not.toHaveBeenCalled();
});
it("cancels activation observation on disposal without unregistering the worker", async () => {
  const f = fixture(); f.activeWorker.setState("activating");
  f.load(); await Promise.resolve(); await Promise.resolve(); f.keeper.dispose();
  await f.keeper.whenSettled(); expect(f.activeWorker.removeListener).toHaveBeenCalledOnce();
  expect(f.unregister).not.toHaveBeenCalled(); expect(f.stopLoaded).not.toHaveBeenCalled();
  f.activeWorker.setState("activated"); expect(f.postMessage).not.toHaveBeenCalled();
});
it("reports a worker becoming redundant before activation and removes its listener", async () => {
  const f = fixture(); f.activeWorker.setState("activating");
  f.load(); await Promise.resolve(); await Promise.resolve(); f.activeWorker.setState("redundant");
  await expect(f.keeper.whenSettled()).rejects.toThrow("operations");
  expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "The app's worker became redundant before activation." }));
  expect(f.activeWorker.removeListener).toHaveBeenCalledOnce(); expect(f.stopLoaded).not.toHaveBeenCalled(); f.keeper.dispose();
});
it("attempts cache deletion after unregister failure and reports terminal cleanup errors", async () => {
  const f = fixture(); f.load(); f.optOut(); f.unregister.mockRejectedValue(new Error("unregister failure"));
  await expect(f.keeper.whenSettled()).rejects.toThrow("operations"); expect(f.remove).toHaveBeenCalledOnce(); expect(f.onError).toHaveBeenCalledOnce(); f.keeper.dispose();
});
it("carries keeping and isolation in the worker's address, and keeps the worker while either is on", async () => {
  const plain = "https://host.test/app/foss-earth-sw.js";
  let keep = true, isolate = true, change = () => {}, loaded = () => {};
  const registration = { active: null as ServiceWorker | null, unregister: vi.fn(async () => true) };
  const register = vi.fn(async (url: string) => {
    registration.active = worker(url).value as unknown as ServiceWorker; return registration as unknown as ServiceWorkerRegistration;
  });
  const remove = vi.fn(async () => true), postMessage = vi.fn();
  const env: KeptFilesEnvironment = { worker: { url: plain }, scope: "/app/",
    container: { register, getRegistration: async () => registration as unknown as ServiceWorkerRegistration, controller: null, ready: new Promise(() => {}) },
    caches: { open: vi.fn(), has: vi.fn(async () => false), delete: remove },
    observeLoaded: listener => { listener([`${plain.replace("foss-earth-sw.js", "assets/app-Abc12345.js")}`]); return () => {}; },
    onControllerChange: () => () => {}, afterLoad: work => { loaded = work; } };
  const keeper = createKeptFilesClient({ environment: env, cacheNamespace: "host-files", onError: vi.fn(),
    policy: { enabled: () => keep, isolate: () => isolate, subscribe(listener) { change = listener; return () => {}; } } });
  loaded(); await keeper.whenSettled();
  expect(register).toHaveBeenLastCalledWith(`${plain}?keep=1&isolate=1`, { scope: "/app/", updateViaCache: "none" });
  expect((registration.active as unknown as { postMessage: typeof postMessage }).postMessage).toHaveBeenCalledOnce();
  // The worker of another policy is still this deployment's.
  expect(await keeper.status()).toMatchObject({ installed: true });
  // Keeping off, isolation on: the worker stays, keeps nothing more, and what it kept goes.
  keep = false; change(); await keeper.whenSettled();
  expect(register).toHaveBeenLastCalledWith(`${plain}?keep=0&isolate=1`, { scope: "/app/", updateViaCache: "none" });
  expect((registration.active as unknown as { postMessage: typeof postMessage }).postMessage).not.toHaveBeenCalled();
  expect(registration.unregister).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith("host-files /app/foss-earth-sw.js");
  // Its status keeps nothing, and does not read the store, which opening it would make again after the deletion.
  const reads = vi.mocked(env.caches!.has).mock.calls.length;
  expect(await keeper.status()).toMatchObject({ installed: false, files: 0, bytes: 0 });
  expect(vi.mocked(env.caches!.has).mock.calls.length).toBe(reads);
  expect(env.caches!.open).not.toHaveBeenCalled();
  // Neither: the worker goes.
  isolate = false; change(); await keeper.whenSettled();
  expect(registration.unregister).toHaveBeenCalledOnce();
  expect(register).toHaveBeenCalledTimes(2);
  keeper.dispose();
});
