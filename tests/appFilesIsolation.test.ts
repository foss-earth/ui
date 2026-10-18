import { expect, it, vi } from "vitest";
import { appFilesWorker } from "../vite/index.mjs";

const ORIGIN = "https://host.test";
const SCRIPT = "/app/assets/main-12345678.js";
const WORKER_SCRIPT = "/app/assets/sky.worker-ABCDEFGH.js";
const ISOLATED = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "cross-origin" };

function basic(text: string | null, status = 200): Response {
  const response = new Response(text, { status, headers: { "content-type": "text/javascript" } });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

/** The worker a build writes, at `address`, against a stand-in for a service worker's global. */
function worker(address: string, isolation?: "off" | "report-only" | "enforce", keepFiles?: boolean) {
  const location = new URL(address, ORIGIN);
  const cache = new Map<string, Response>(), listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const fetch = vi.fn(async (input: string | Request) => basic(`network ${typeof input === "string" ? input : input.url}`));
  const storage = { match: async (request: string | Request) => cache.get(new URL(typeof request === "string" ? request : request.url, location).pathname)?.clone(),
    put: async (path: string, response: Response) => { cache.set(new URL(path, location).pathname, response); }, keys: async () => [], delete: async () => true };
  const caches = { open: vi.fn(async () => storage), delete: vi.fn(async () => { cache.clear(); return true; }) };
  const self = { location, caches, fetch, skipWaiting: async () => {}, clients: { claim: async () => {} }, registration: {},
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener) };
  const produced = appFilesWorker(["assets/main-12345678.js", "assets/sky.worker-ABCDEFGH.js", "index.html"], { base: "/app/", isolation, retention: "current-only", ...(keepFiles === undefined ? {} : { keepFiles }) });
  new Function("self", produced.source)(self);
  const dispatch = async (type: string, fields: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = []; let response: Promise<Response> | undefined;
    listeners.get(type)?.({ ...fields, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => { response = p; } });
    const result = response ? await response : null; for (let i = 0; i < waits.length; i++) await waits[i]; return result;
  };
  const request = (path: string, fields: Record<string, string> = {}) => ({ url: new URL(path, ORIGIN).href, method: "GET", mode: "cors", destination: "", ...fields });
  return { produced, cache, caches, fetch, dispatch, request };
}
const headersOf = (response: Response | null) => Object.fromEntries([...(response?.headers ?? new Headers())].filter(([name]) => name.startsWith("cross-origin")));

it("isolates the page, its workers and the files it keeps where the build may and the page asks", async () => {
  const w = worker("/app/foss-earth-sw.js?keep=1&isolate=1", "enforce");
  expect(w.produced.manifest.isolation).toBe("enforce");
  await w.dispatch("activate");
  expect(w.caches.delete).not.toHaveBeenCalled();
  const preloaded = await w.dispatch("fetch", { request: w.request("/app/", { mode: "navigate" }), preloadResponse: Promise.resolve(basic("the page")) });
  expect(headersOf(preloaded)).toEqual(ISOLATED);
  expect(await preloaded!.text()).toBe("the page");
  const fetchedPage = await w.dispatch("fetch", { request: w.request("/app/", { mode: "navigate" }), preloadResponse: Promise.resolve(undefined) });
  expect(headersOf(fetchedPage)).toEqual(ISOLATED);
  // A kept file is served with the headers, and kept as the server sent it.
  const script = await w.dispatch("fetch", { request: w.request(SCRIPT, { destination: "script" }) });
  expect(headersOf(script)).toEqual(ISOLATED);
  expect(headersOf(w.cache.get(SCRIPT)!)).toEqual({});
  // A worker the build does not list still gets them, so it is isolated too; other unlisted files pass by.
  expect(headersOf(await w.dispatch("fetch", { request: w.request("/app/dev/helper.js", { destination: "worker" }) }))).toEqual(ISOLATED);
  expect(await w.dispatch("fetch", { request: w.request("/app/scene/tile.jpg", { destination: "image" }) })).toBeNull();
  // Other sites' files are theirs: CORS lets them in, and the worker does not touch them.
  expect(await w.dispatch("fetch", { request: w.request("https://tile.test/worker.js", { destination: "worker" }) })).toBeNull();
  expect(await w.dispatch("fetch", { request: w.request("https://tile.test/1.png", { cache: "only-if-cached", mode: "no-cors" }) })).toBeNull();
});

it("passes responses it cannot rebuild, and rebuilds bodiless ones without a body", async () => {
  const w = worker("/app/foss-earth-sw.js?keep=1&isolate=1", "enforce");
  const opaque = Response.error();
  expect(await w.dispatch("fetch", { request: w.request("/app/", { mode: "navigate" }), preloadResponse: Promise.resolve(opaque) })).toBe(opaque);
  const unchanged = basic(null, 304);
  const rebuilt = await w.dispatch("fetch", { request: w.request("/app/", { mode: "navigate" }), preloadResponse: Promise.resolve(unchanged) });
  expect(rebuilt!.status).toBe(304);
  expect(headersOf(rebuilt)).toEqual(ISOLATED);
});

it("adds nothing where the page did not ask, the build may not isolate, or the address is an older page's", async () => {
  for (const [address, isolation] of [
    ["/app/foss-earth-sw.js?keep=1&isolate=0", "enforce"],
    ["/app/foss-earth-sw.js?keep=1&isolate=1", "off"],
    ["/app/foss-earth-sw.js?keep=1&isolate=1", undefined],
    ["/app/foss-earth-sw.js", "enforce"],
  ] as const) {
    const w = worker(address, isolation);
    const page = basic("the page");
    expect(await w.dispatch("fetch", { request: w.request("/app/", { mode: "navigate" }), preloadResponse: Promise.resolve(page) }), address).toBe(page);
    expect(headersOf(await w.dispatch("fetch", { request: w.request(SCRIPT) }))).toEqual({});
    expect(await w.dispatch("fetch", { request: w.request("/app/dev/helper.js", { destination: "worker" }) })).toBeNull();
  }
});

it("sends only the report-only forms in a release that reports first", async () => {
  const w = worker("/app/foss-earth-sw.js?keep=1&isolate=1", "report-only");
  const page = await w.dispatch("fetch", { request: w.request("/app/", { mode: "navigate" }), preloadResponse: Promise.resolve(basic("the page")) });
  expect(headersOf(page)).toEqual({ "cross-origin-opener-policy-report-only": "same-origin",
    "cross-origin-embedder-policy-report-only": "require-corp", "cross-origin-resource-policy": "cross-origin" });
});

it("isolates without keeping where the page keeps nothing", async () => {
  const w = worker("/app/foss-earth-sw.js?keep=0&isolate=1", "enforce");
  // What an earlier worker kept goes when this one takes over, and no store is made for it.
  w.cache.set(SCRIPT, basic("kept before"));
  await w.dispatch("activate");
  expect(w.caches.delete).toHaveBeenCalledWith("foss-earth-app-files /app/foss-earth-sw.js");
  expect(w.caches.open).not.toHaveBeenCalled();
  expect(await w.dispatch("fetch", { request: w.request(SCRIPT, { destination: "script" }) })).toBeNull();
  expect(headersOf(await w.dispatch("fetch", { request: w.request(WORKER_SCRIPT, { destination: "worker" }) }))).toEqual(ISOLATED);
  await w.dispatch("message", { data: { type: "foss-earth-keep", urls: [`${ORIGIN}${SCRIPT}`] } });
  expect(w.cache.size).toBe(0);
  expect(w.fetch).toHaveBeenCalledOnce();
});

it("only isolates in a build that keeps no files, whatever the address asks", async () => {
  const w = worker("/app/foss-earth-sw.js?keep=1&isolate=1", "enforce", false);
  expect(w.produced.manifest.keepFiles).toBe(false);
  expect(headersOf(await w.dispatch("fetch", { request: w.request("/app/", { mode: "navigate" }), preloadResponse: Promise.resolve(basic("the page")) }))).toEqual(ISOLATED);
  expect(await w.dispatch("fetch", { request: w.request(SCRIPT, { destination: "script" }) })).toBeNull();
  expect(headersOf(await w.dispatch("fetch", { request: w.request(WORKER_SCRIPT, { destination: "worker" }) }))).toEqual(ISOLATED);
  expect(w.cache.size).toBe(0);
});

it("refuses an unknown isolation mode", () => {
  expect(() => appFilesWorker([], { isolation: "on" as "enforce" })).toThrow("isolation");
});
