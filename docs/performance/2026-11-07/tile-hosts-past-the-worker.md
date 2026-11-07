# Tile requests past the service worker — 7 November 2026

Item L26 of the performance limits audit (app
`docs/proposals/performance-limits.md`), P-111 in the performance ledger.
Exact: the worker never answered these requests, so the same requests go to
the network with the same answers.

## What happens without it

The app's service worker answers same-origin files and navigations. It
controls every request its pages make, so each tile request to another host
is dispatched to its `fetch` handler, which lets it by
(`vite/appFilesWorker.js`). That is one hop through the worker's thread for
each of hundreds of tiles a view loads. If the worker has stopped, which
Chrome does after about 30 s idle, the next tile request starts it again.

## The change

- `appFiles` and `appFilesWorker` (`vite/index.mjs`) take `networkHosts`:
  lowercase hostnames, at most 64, kept once each in the worker's manifest.
  Anything else is refused when the build runs.
- At install, where the browser has static routing (`InstallEvent.addRoutes`
  and `URLPattern`), the worker adds one rule per host:
  `{ condition: { urlPattern: new URLPattern({ hostname }) }, source: "network" }`.
  The worker's own host is never routed.
- A browser without the API, or one that refuses the rules, installs the
  worker as before. The rules are added inside `waitUntil` with their
  rejection caught, so a refusal never fails the install.
- Default: no hosts, so a build that names none gets the same worker as
  before. The FOSS Earth app names its map tile hosts (`MAP_TILE_HOSTS` in
  its `vite/appFiles.ts`); an empty list there is the old behaviour.

## Why it is exact

A static route with `source: "network"` sends a request where the worker's
`fetch` handler, for these hosts, would have sent it: to the network,
unchanged. `tests/appFilesRoutes.test.ts` checks that the handler answers no
request to another host for every build and page state: 3 worker addresses,
3 isolation modes, keeping files on and off, before and after the page
forgets them, and requests in 3 modes, 5 destinations and 3 cache modes to
2 hosts. That is 2,160 requests, none answered. Navigations to another site
are outside the worker's scope.

## Tests

- `tests/appFilesRoutes.test.ts`:
  - The manifest lists each host once; uppercase, schemes, ports, paths,
    wildcards, empty names, more than 64 hosts and a non-array are refused.
  - Install adds a `network` rule per host, never the worker's own, and
    still takes over at once.
  - Install works as before with no `addRoutes`, no `URLPattern`, a rejected
    or thrown `addRoutes`, no hosts, or only the worker's own host.
  - The 2,160-request check above.
- App `vite/appFiles.test.ts`: the app's list equals the hosts of the
  engine's terrain and base map sources, with their variants, plus Google's
  3D tiles, the overview's chart and the sky's night lights. The built worker
  carries the list and routes it at install.
- **Mutants.** ui: 9 of 10 one-line mutants fail a test. The survivor,
  routing without checking for `URLPattern`, is equivalent: without it the
  constructor throws inside the caught promise, before `addRoutes`. App: 8 of
  8, among them each host dropped, a host that is not a map's, a host twice,
  and the list left out of the worker or the plugin.

## In the browser

The method:

- Headless Chrome 156 on an Apple M5, 1280 × 800, the app's production build
  with the default map, over the real network.
- Control: the same build, with the worker's list of hosts emptied, which is
  the worker as it was.
- One Chrome per run with a fresh profile, so the HTTP cache, the map cache
  and the worker start empty. The first visit installs the worker. Once it
  controls the page, the camera goes 25 km above six cities in turn. Before
  every other city, DevTools stops the worker, as Chrome does once it has
  idled about 30 s.
- Three runs each way, interleaved: new, control, control, new, new,
  control.
- Each city reads the Resource Timing of the tile requests it caused, and
  DevTools' record of the worker starting
  (`ServiceWorker.workerVersionUpdated`). The script is the app's
  `build/l26/bench.mjs`, which is not committed.

| Build | Worker before the move | Tile requests | Through the worker's fetch handler | Straight to the network (`workerFinalSourceType`) | Worker started again |
| --- | --- | ---: | ---: | ---: | ---: |
| Control | running | 3,510 | 3,510 | 0 | — |
| Control | stopped | 3,475 | 3,475 | 0 | 9 of 9 times |
| New | running | 3,519 | 0 | 3,519 | — |
| New | stopped | 3,478 | 0 | 3,478 | 0 of 9 times |

DevTools listed the nine rules on the worker's version.

Time per request did not resolve. All of each request is network-bound here,
and the two builds overlap:

| Build | Worker before the move | Median request, median of 9 cities (range) | First 10 requests after the move |
| --- | --- | --- | --- |
| Control | running | 40.3 ms (34.1–56.1) | 54.4 ms (34.5–60.2) |
| Control | stopped | 39.4 ms (32.5–64.4) | 61.5 ms (50.1–75.8) |
| New | running | 36.8 ms (35.0–44.8) | 59.4 ms (50.0–69.1) |
| New | stopped | 37.1 ms (33.6–59.1) | 55.7 ms (45.4–80.8) |

So the measured gain is in work, not time: no fetch event per tile, and no
worker start after it idles. What a hop and a start cost a slower phone is
not measured.
