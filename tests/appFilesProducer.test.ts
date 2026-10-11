import { expect, it, vi } from "vitest";
import { appFilesWorker } from "../vite/index.mjs";
function harness(retention?: "retain-older" | "current-only") {
  const workerUrl = new URL("https://host.test/foss-earth-sw.js"), cache = new Map<string, Response>(), listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const fetch = vi.fn(async () => basic("network"));
  const storage = { match: async (request: string | Request) => cache.get(new URL(typeof request === "string" ? request : request.url, workerUrl).pathname)?.clone(),
    put: async (path: string, response: Response) => { cache.set(new URL(path, workerUrl).pathname, response); }, keys: async () => [...cache.keys()].map(path => new Request(new URL(path, workerUrl))),
    delete: async (request: Request) => cache.delete(new URL(request.url).pathname) };
  const self = { location: workerUrl, caches: { open: async () => storage }, fetch, skipWaiting: async () => {}, clients: { claim: async () => {} }, registration: {},
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener) };
  const produced = appFilesWorker(["assets/current-12345678.js", "index.html"], { retention, identity: "host-1",
    extraFiles: [{ url: "scene.json", sha256: "a".repeat(64), sizeBytes: 12 }], retainedFiles: [{ url: "legacy/scene.json", sha256: "b".repeat(64), sizeBytes: 14 }] });
  new Function("self", produced.source)(self);
  const dispatch = async (type: string, fields: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = []; let response: Promise<Response> | undefined;
    listeners.get(type)?.({ ...fields, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => { response = p; } });
    const result = response ? await response : null; for (let i = 0; i < waits.length; i++) await waits[i]; return result;
  };
  return { produced, cache, fetch, dispatch, request: (path: string) => ({ url: new URL(path, workerUrl).href, method: "GET", mode: "cors" }) };
}
function basic(text: string) { const response = new Response(text); Object.defineProperty(response, "type", { value: "basic" }); return response; }
it("retains older cached files and pinned legacy resources by default while serving current scene artifacts", async () => {
  const h = harness(); h.cache.set("/assets/old-87654321.js", basic("old")); h.cache.set("/legacy/scene.json", basic("legacy"));
  await h.dispatch("activate"); expect(h.cache.size).toBe(2);
  expect(await (await h.dispatch("fetch", { request: h.request("/assets/old-87654321.js") }))!.text()).toBe("old");
  expect(await (await h.dispatch("fetch", { request: h.request("/scene.json") }))!.text()).toBe("network"); expect(h.cache.has("/scene.json")).toBe(true);
  await h.dispatch("fetch", { request: h.request("/unknown-image.jpg") }); expect(h.cache.has("/unknown-image.jpg")).toBe(false);
});
it("only deletes older files under explicit current-only policy and preserves declared retained files", async () => {
  const h = harness("current-only"); h.cache.set("/assets/old-87654321.js", basic("old")); h.cache.set("/legacy/scene.json", basic("legacy"));
  await h.dispatch("activate"); expect([...h.cache.keys()]).toEqual(["/legacy/scene.json"]);
});
it("matches deployment message identity and permits opt-out without rewriting retention policy", async () => {
  const h = harness(); await h.dispatch("message", { data: { type: "foss-earth-forget", identity: "foreign" } });
  expect(await h.dispatch("fetch", { request: h.request("/scene.json") })).not.toBeNull();
  await h.dispatch("message", { data: { type: "foss-earth-forget", identity: "host-1" } });
  expect(await h.dispatch("fetch", { request: h.request("/scene.json") })).toBeNull();
});
it("produces deterministic receipts and rejects path escapes or conflicting exact pins", () => {
  const h = harness(), again = harness(); expect(h.produced.receipt).toEqual(again.produced.receipt);
  expect(h.produced.receipt.state).toBe("PRODUCED_NOT_QUALIFIED"); expect(h.produced.manifest.scope).toBe("/");
  expect(() => appFilesWorker(["../outside-12345678.js"])).toThrow("paths");
  expect(() => appFilesWorker([], { retainedFiles: [{ url: "old.json", sha256: "bad", sizeBytes: 1 }] })).toThrow("SHA-256");
  expect(() => appFilesWorker([], { extraFiles: [{ url: "same.json", sha256: "a".repeat(64), sizeBytes: 1 }],
    retainedFiles: [{ url: "same.json", sha256: "b".repeat(64), sizeBytes: 1 }] })).toThrow("Conflicting");
});
