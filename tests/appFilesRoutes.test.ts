import { expect, it, vi } from "vitest";
import { appFilesWorker } from "../vite/index.mjs";

const ORIGIN = "https://host.test";
const HOSTS = ["tiles.example", "imagery.example", "host.test"];

class Pattern { constructor(readonly init: Record<string, string>) {} }

/** The worker a build writes, against a stand-in for a service worker's global; `features` says what the browser has. */
function worker(options: { address?: string; networkHosts?: string[]; isolation?: "off" | "report-only" | "enforce"; keepFiles?: boolean; urlPattern?: boolean } = {}) {
  const location = new URL(options.address ?? "/app/foss-earth-sw.js?keep=1&isolate=1", ORIGIN);
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const storage = { match: async () => undefined, put: async () => {}, keys: async () => [], delete: async () => true };
  const skipWaiting = vi.fn(async () => {});
  const self = { location, caches: { open: async () => storage, delete: async () => true }, fetch: vi.fn(async () => new Response("network")), skipWaiting,
    clients: { claim: async () => {} }, registration: {}, ...(options.urlPattern === false ? {} : { URLPattern: Pattern }),
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => listeners.set(type, listener) };
  const produced = appFilesWorker(["assets/main-12345678.js", "index.html"], { base: "/app/", retention: "current-only",
    ...(options.networkHosts ? { networkHosts: options.networkHosts } : {}), ...(options.isolation ? { isolation: options.isolation } : {}),
    ...(options.keepFiles === undefined ? {} : { keepFiles: options.keepFiles }) });
  new Function("self", produced.source)(self);
  const dispatch = async (type: string, fields: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = []; let response: Promise<Response> | undefined; let answered = false;
    listeners.get(type)?.({ ...fields, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => { answered = true; response = p; } });
    if (response) await response;
    for (let i = 0; i < waits.length; i++) await waits[i];
    return { answered, waits: waits.length };
  };
  return { produced, dispatch, skipWaiting };
}

it("lists the hosts in the manifest once each, and refuses anything but lowercase hostnames", () => {
  expect(appFilesWorker([]).manifest.networkHosts).toEqual([]);
  expect(appFilesWorker([], { networkHosts: ["a.example", "b.example", "a.example"] }).manifest.networkHosts).toEqual(["a.example", "b.example"]);
  for (const bad of ["https://a.example", "A.example", "a.example:443", "a.example/tiles", "", "-a.example", "a..example", "*.example"]) {
    expect(() => appFilesWorker([], { networkHosts: [bad] }), bad).toThrow("networkHosts");
  }
  expect(() => appFilesWorker([], { networkHosts: Array.from({ length: 65 }, (_, i) => `h${i}.example`) })).toThrow("networkHosts");
  expect(() => appFilesWorker([], { networkHosts: "a.example" as unknown as string[] })).toThrow("networkHosts");
});

it("routes the build's other hosts to the network at install, never its own, and still takes over at once", async () => {
  const w = worker({ networkHosts: HOSTS });
  const addRoutes = vi.fn(async () => {});
  await w.dispatch("install", { addRoutes });
  expect(addRoutes).toHaveBeenCalledOnce();
  const rules = addRoutes.mock.calls[0]![0] as { condition: { urlPattern: Pattern }; source: string }[];
  expect(rules.map(rule => [rule.condition.urlPattern instanceof Pattern, rule.condition.urlPattern.init, rule.source])).toEqual([
    [true, { hostname: "tiles.example" }, "network"],
    [true, { hostname: "imagery.example" }, "network"],
  ]);
  expect(w.skipWaiting).toHaveBeenCalledOnce();
});

it("installs as before where the browser has no static routing, refuses the rules, or the build names no host", async () => {
  for (const [name, w, event] of [
    ["no addRoutes", worker({ networkHosts: HOSTS }), {}],
    ["no URLPattern", worker({ networkHosts: HOSTS, urlPattern: false }), { addRoutes: vi.fn(async () => {}) }],
    ["rejected", worker({ networkHosts: HOSTS }), { addRoutes: vi.fn(async () => { throw new TypeError("unsupported condition"); }) }],
    ["thrown", worker({ networkHosts: HOSTS }), { addRoutes: vi.fn(() => { throw new TypeError("not in install"); }) }],
    ["no hosts", worker(), { addRoutes: vi.fn(async () => {}) }],
    ["only its own host", worker({ networkHosts: ["host.test"] }), { addRoutes: vi.fn(async () => {}) }],
  ] as const) {
    await expect(w.dispatch("install", event), name).resolves.toMatchObject({ answered: false });
    expect(w.skipWaiting, name).toHaveBeenCalledOnce();
    if (name === "no URLPattern" || name === "no hosts" || name === "only its own host") expect((event as { addRoutes: ReturnType<typeof vi.fn> }).addRoutes, name).not.toHaveBeenCalled();
  }
});

it("answers no request to another host, whatever the build, the page or the request, so routing them past it is exact", async () => {
  const requests: Record<string, string>[] = [];
  for (const host of ["tiles.example", "imagery.example"]) {
    for (const mode of ["cors", "no-cors", "same-origin", "navigate"]) {
      for (const destination of ["", "image", "worker", "script", "document"]) {
        for (const cache of ["default", "only-if-cached", "force-cache"]) {
          requests.push({ url: `https://${host}/12/654/1583.webp?key=k`, method: "GET", mode, destination, cache });
        }
      }
    }
  }
  let checked = 0;
  for (const address of ["/app/foss-earth-sw.js?keep=1&isolate=1", "/app/foss-earth-sw.js?keep=0&isolate=1", "/app/foss-earth-sw.js"]) {
    for (const isolation of ["off", "report-only", "enforce"] as const) {
      for (const keepFiles of [true, false]) {
        const w = worker({ address, isolation, keepFiles, networkHosts: HOSTS });
        await w.dispatch("install", { addRoutes: vi.fn(async () => {}) });
        await w.dispatch("activate");
        for (const forget of [false, true]) {
          if (forget) await w.dispatch("message", { data: { type: "foss-earth-forget" } });
          for (const request of requests) {
            // A navigation to another site is never this worker's: it is out of the worker's scope.
            if (request.mode === "navigate") continue;
            const { answered } = await w.dispatch("fetch", { request, preloadResponse: Promise.resolve(undefined) });
            expect(answered, JSON.stringify({ address, isolation, keepFiles, forget, request })).toBe(false);
            checked++;
          }
        }
      }
    }
  }
  expect(checked).toBe(3 * 3 * 2 * 2 * 2 * 3 * 5 * 3);
});
