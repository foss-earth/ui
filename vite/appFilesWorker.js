/** Extracted from Earth App/vite/appFilesWorker.js; host policy controls retention.
 * Pages are always network-first; no media cache or app/runtime is constructed.
 * Cross-origin isolation (docs/docs/proposals/webassembly.md, step 3): the build
 * says whether it may isolate (manifest.isolation), the page says whether it
 * wants to in the worker's own address, `?keep=1&isolate=1`, which survives the
 * worker being stopped; a page changes either by registering another address. */
function install(worker, manifest) {
  const policy = new URL(worker.location.href).searchParams;
  // An address without a policy is an older page's: it kept files and did not isolate. A build that keeps nothing never does.
  const keeping = manifest.keepFiles !== false && policy.get("keep") !== "0";
  const isolation = manifest.isolation ?? "off";
  const isolating = isolation !== "off" && policy.get("isolate") === "1";
  const suffix = isolation === "report-only" ? "-Report-Only" : "";
  // COEP require-corp, not credentialless, which Safari may lack; CORP so an isolated page elsewhere may load these files.
  const isolationHeaders = isolating ? [[`Cross-Origin-Opener-Policy${suffix}`, "same-origin"],
    [`Cross-Origin-Embedder-Policy${suffix}`, "require-corp"], ["Cross-Origin-Resource-Policy", "cross-origin"]] : [];
  // Bodiless statuses: a Response with one of these cannot be given a body, even an empty stream.
  const bodiless = new Set([101, 103, 204, 205, 304]);
  /** The response as served, with the isolation headers; stored responses keep what the server sent. Status 0 and opaque redirects cannot be rebuilt. */
  const served = response => {
    if (!isolationHeaders.length || !response || response.status === 0 || response.type === "opaqueredirect" || response.type === "opaque") return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of isolationHeaders) headers.set(name, value);
    return new Response(bodiless.has(response.status) ? null : response.body, { status: response.status, statusText: response.statusText, headers });
  };
  // Documents and workers carry the page's isolation; other same-origin loads need no headers, so they pass by unless kept.
  const needsHeaders = request => request.mode === "navigate" || request.destination === "worker" || request.destination === "sharedworker";
  const files = manifest.files.map(file => file.url);
  const paths = new Set(files.map(name => new URL(name, worker.location.href).pathname));
  // One store for the worker's own address: a build's files, whichever of its pages asked for them.
  const cacheName = `${manifest.cacheNamespace} ${new URL(worker.location.href).pathname}`;
  const base = new URL(manifest.base, worker.location.origin);
  const retained = new Set(manifest.retainedFiles.map(file => new URL(file.url, worker.location.href).pathname));
  const matchOptions = { ignoreVary: true, ignoreSearch: true };
  // Set when the page turns keeping off: until the page closes, this worker still sees its requests, and passes them by.
  let forgotten = false;

  /** A response worth keeping: the file itself, from this site. */
  const keepable = response => Boolean(response) && response.ok && response.status === 200 && response.type === "basic" && !response.redirected;

  /** The path of a URL this build lists, or null. */
  const listed = href => {
    let url;
    try { url = new URL(href, worker.location.href); } catch { return null; }
    return url.origin === worker.location.origin && paths.has(url.pathname) ? url.pathname : null;
  };

  async function answer(event, request, path) {
    const cache = await worker.caches.open(cacheName);
    const kept = await cache.match(path, matchOptions);
    if (kept) return kept;
    const response = await worker.fetch(request);
    if (keepable(response)) event.waitUntil(cache.put(path, response.clone()).catch(() => {}));
    return response;
  }

  worker.addEventListener("install", event => {
    // Nothing is fetched ahead: files are kept as the app asks for them. The new list takes over at once.
    event.waitUntil(worker.skipWaiting());
  });

  worker.addEventListener("activate", event => {
    event.waitUntil((async () => {
      // The page is asked for while the worker starts, not after.
      await worker.registration.navigationPreload?.enable().catch(() => {});
      // A worker that keeps nothing has no store: what an earlier one kept goes, as the page that turned keeping off asks.
      if (!keeping) await worker.caches.delete(cacheName).catch(() => {});
      else {
        const cache = await worker.caches.open(cacheName);
        // Older pages may still request their files. Deletion is an explicit host
        // policy; retained legacy resources survive either activation policy.
        if (manifest.retention === "current-only") for (const request of await cache.keys()) {
          if (!paths.has(new URL(request.url).pathname) && !retained.has(new URL(request.url).pathname)) await cache.delete(request);
        }
      }
      await worker.clients.claim();
    })());
  });

  worker.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    if (request.mode === "navigate") {
      event.respondWith((async () => {
        // The request made while the worker started, if the browser made one; a failed one is asked again, as a page without this worker would be.
        const preloaded = await Promise.resolve(event.preloadResponse).catch(() => undefined);
        return served(preloaded || await worker.fetch(request));
      })());
      return;
    }
    // As coi-serviceworker: a request that may only be answered from the browser's cache is not this worker's to fetch.
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
    let url;
    try { url = new URL(request.url); } catch { return; }
    const own = url.origin === worker.location.origin;
    const isolate = () => { if (isolationHeaders.length && own && needsHeaders(request)) event.respondWith(worker.fetch(request).then(served)); };
    if (forgotten || !keeping) { isolate(); return; }
    const path = listed(request.url);
    if (path) { event.respondWith(answer(event, request, path).then(served)); return; }
    // Existing older files are usable by still-open pages. Do not acquire an
    // unknown file merely because the worker controls the deployment root.
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) { isolate(); return; }
    if (retained.has(url.pathname) || manifest.retention === "retain-older") event.respondWith((async () => {
      const cache = await worker.caches.open(cacheName);
      const old = await cache.match(url.pathname, matchOptions);
      if (old) return served(old);
      if (retained.has(url.pathname)) return served(await answer(event, request, url.pathname));
      return served(await worker.fetch(request));
    })());
    else isolate();
  });

  // The page names what it loaded before this worker controlled it; those files are kept from the browser's cache.
  worker.addEventListener("message", event => {
    const data = event.data;
    if (manifest.identity && data?.identity !== manifest.identity) return;
    if (data?.type === "foss-earth-forget") forgotten = true;
    if (!keeping || data?.type !== "foss-earth-keep" || !Array.isArray(data.urls)) return;
    forgotten = false;
    event.waitUntil((async () => {
      const cache = await worker.caches.open(cacheName);
      for (const href of data.urls) {
        const path = typeof href === "string" ? listed(href) : null;
        if (forgotten || !path || await cache.match(path, matchOptions)) continue;
        const response = await worker.fetch(path, { cache: "force-cache" }).catch(() => null);
        if (keepable(response)) await cache.put(path, response).catch(() => {});
      }
    })());
  });
}
