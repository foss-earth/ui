import { expect, it, vi } from "vitest";
import { createKeptFilesClient, type KeptFilesEnvironment } from "../src/browser/keptFiles.js";
function fixture() {
  let enabled = true, change = () => {}, loaded = () => {};
  let ready!: (value: ServiceWorkerRegistration) => void;
  const postMessage = vi.fn(), unregister = vi.fn(async () => true), remove = vi.fn(async () => true);
  const active = { scriptURL: "https://host.test/foss-earth-sw.js", postMessage };
  const registration = { active, unregister } as unknown as ServiceWorkerRegistration;
  const register = vi.fn(async () => registration), stopLoaded = vi.fn(), stopController = vi.fn(), onError = vi.fn();
  const env: KeptFilesEnvironment = { worker: { url: active.scriptURL }, scope: "/",
    container: { register, getRegistration: async () => registration, controller: active as ServiceWorker,
      ready: new Promise(resolve => { ready = resolve; }) },
    caches: { open: vi.fn(), has: async () => false, delete: remove },
    observeLoaded: () => stopLoaded, onControllerChange: () => stopController, afterLoad: work => { loaded = work; } };
  const keeper = createKeptFilesClient({ environment: env, cacheNamespace: "host-files", messageIdentity: "build-1",
    policy: { enabled: () => enabled, subscribe(listener) { change = listener; return () => {}; } }, onError });
  return { keeper, env, register, registration, ready: () => ready(registration), load: () => loaded(),
    optOut() { enabled = false; change(); }, postMessage, unregister, remove, stopLoaded, stopController, onError };
}
it("waits until after page load and cancels only activation observation on opt-out", async () => {
  const f = fixture(); expect(f.register).not.toHaveBeenCalled(); f.load(); await Promise.resolve(); await Promise.resolve();
  expect(f.register).toHaveBeenCalledWith("https://host.test/foss-earth-sw.js", { scope: "/", updateViaCache: "none" });
  f.optOut(); await f.keeper.whenSettled(); expect(f.unregister).toHaveBeenCalledOnce();
  expect(f.remove).toHaveBeenCalledWith("host-files /foss-earth-sw.js");
  expect(f.postMessage).toHaveBeenCalledWith({ type: "foss-earth-forget", identity: "build-1" }); f.keeper.dispose();
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
it("attempts cache deletion after unregister failure and reports terminal cleanup errors", async () => {
  const f = fixture(); f.load(); f.optOut(); f.unregister.mockRejectedValue(new Error("unregister failure"));
  await expect(f.keeper.whenSettled()).rejects.toThrow("operations"); expect(f.remove).toHaveBeenCalledOnce(); expect(f.onError).toHaveBeenCalledOnce(); f.keeper.dispose();
});
