// Run with `npm run test:browser`. jsdom lays nothing out and draws no
// scrollbar, so these load the real TabStrip and windowing.css into Chrome and
// Firefox: CHROME_BIN and FIREFOX_BIN, or the usual install paths, and the
// browser-testing checkout beside this one. Screenshots go to
// build/tab-strip-scrollbar.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluate, openHeadlessChrome } from "../../../browser-testing/src/headlessChrome.mjs";
import { openHeadlessFirefox } from "../../../browser-testing/src/headlessFirefox.mjs";

/**
 * With more tabs than fit, swiping the strip showed the browser's scrollbar
 * over the bottom of the tabs: on a phone, a tablet or a Mac it is drawn over
 * what scrolls instead of beside it. While it showed, a press on the lower
 * part of a tab or its x went to the scrollbar (the lower 4 px on a phone,
 * 16 px of the 30 on a Mac), so selecting or closing a tab meant waiting for it
 * to fade. The scrollbar now has its own room under the tabs. A finger swipes
 * there as on the tabs, and a mouse drags the scrollbar.
 */

interface Box { x: number; y: number; width: number; height: number }
interface Geometry {
  strip: Box;
  list: Box;
  tabsTop: number;
  tabsBottom: number;
  scrollLeft: number;
  maxScroll: number;
  /** Tabs wholly inside the strip's visible part. */
  visible: Array<{ label: string; selected: boolean; button: Box; close: Box }>;
}
interface Tabs { open: string[]; active: string | null }
interface Page {
  load(query: string): Promise<void>;
  run<T>(expression: string): Promise<T>;
  /** A PNG of part of the window, in base64. */
  shot(box: Box): Promise<string>;
  /** A finger or wheel moving the strip's content `dx` to the left. */
  swipe(x: number, y: number, dx: number): Promise<void>;
  /** A tap on a phone; a click otherwise. */
  press(x: number, y: number): Promise<void>;
  drag(fromX: number, y: number, toX: number): Promise<void>;
  close(): Promise<void>;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = path.join(ROOT, "build", "tab-strip-scrollbar");
const FIXTURE = path.join(OUT, "fixture.html");
const VIEWPORT = { width: 390, height: 700 };
const firstExisting = (paths: string[]) => paths.find((candidate) => existsSync(candidate));
const CHROME = process.env.CHROME_BIN ?? firstExisting([
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
]);
const FIREFOX = process.env.FIREFOX_BIN ?? firstExisting(["/Applications/Firefox.app/Contents/MacOS/firefox", "/usr/bin/firefox"]);

const GEOMETRY = `(() => {
  const box = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const strip = document.querySelector(".foss-earth-tab-strip");
  const list = strip.querySelector(".foss-earth-tab-strip-list");
  const shells = [...list.querySelectorAll(".foss-earth-tab-shell")];
  const bounds = list.getBoundingClientRect();
  return {
    strip: box(strip),
    list: box(list),
    tabsTop: Math.min(...shells.map((shell) => shell.getBoundingClientRect().top)),
    tabsBottom: Math.max(...shells.map((shell) => shell.getBoundingClientRect().bottom)),
    scrollLeft: list.scrollLeft,
    maxScroll: list.scrollWidth - list.clientWidth,
    visible: shells
      .filter((shell) => { const r = shell.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right; })
      .map((shell) => ({
        label: shell.querySelector(".foss-earth-tab-button").textContent,
        selected: shell.classList.contains("foss-earth-tab-shell-selected"),
        button: box(shell.querySelector(".foss-earth-tab-button")),
        close: box(shell.querySelector(".foss-earth-tab-close")),
      })),
  };
})()`;
// The same strip with the browser's own scrollbar hidden, to compare against.
const HIDE_BROWSER_SCROLLBAR = `(() => {
  const style = document.createElement("style");
  style.textContent = ".foss-earth-tab-strip-list { scrollbar-width: none !important; } .foss-earth-tab-strip-list::-webkit-scrollbar { display: none !important; }";
  document.head.append(style);
})()`;
const FRAMES = "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))";

/** Pixels that differ between two same-sized PNGs, compared in the page. */
async function differingPixels(page: Page, first: string, second: string): Promise<number> {
  return page.run<number>(`(async () => {
    const pixels = async (data) => {
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [a, b] = await Promise.all([pixels(${JSON.stringify(first)}), pixels(${JSON.stringify(second)})]);
    if (a.length !== b.length) return Math.max(a.length, b.length) / 4;
    let count = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) count += 1;
    }
    return count;
  })()`);
}

async function load(page: Page, query = ""): Promise<Geometry> {
  // Emptied first, so the last test's tabs are not taken for the new page's.
  await page.run("document.documentElement.replaceChildren()");
  await page.load(pathToFileURL(FIXTURE).href + query);
  for (let tries = 0; !(await page.run<boolean>("Boolean(document.querySelector('.foss-earth-tab-shell'))")); tries += 1) {
    if (tries > 100) throw new Error("The fixture did not render.");
    await pause(50);
  }
  await page.run(FRAMES);
  return page.run<Geometry>(GEOMETRY);
}

const middle = (box: Box) => box.x + box.width / 2;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Swipes the tabs, then waits for them to stop: Firefox scrolls after its wheel action returns. */
async function swipe(page: Page, geometry: Geometry, dx: number, y = (geometry.tabsTop + geometry.tabsBottom) / 2): Promise<Geometry> {
  await page.swipe(middle(geometry.list), y, dx);
  let last = geometry;
  for (let tries = 0; tries < 40; tries += 1) {
    const now = await page.run<Geometry>(GEOMETRY);
    if (now.scrollLeft !== geometry.scrollLeft && now.scrollLeft === last.scrollLeft) return now;
    last = now;
    await pause(50);
  }
  throw new Error(`The swipe left the tabs at ${last.scrollLeft} px.`);
}
const lane = (geometry: Geometry): Box => ({
  x: geometry.list.x,
  y: geometry.tabsBottom,
  width: geometry.list.width,
  height: geometry.strip.y + geometry.strip.height - geometry.tabsBottom,
});

async function openChrome(phone: boolean, profile: string): Promise<Page> {
  const chrome = await openHeadlessChrome(profile, CHROME);
  const { targetId } = await chrome.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}) => chrome.send<T>(method, params, sessionId);
  // A phone draws Android's overlay scrollbar and takes touches.
  await send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: phone });
  if (phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const touch = (type: string, x?: number, y?: number) => send("Input.dispatchTouchEvent", { type, touchPoints: x === undefined ? [] : [{ x, y }] });
  const mouse = (type: string, x: number, y: number, buttons = 0) => send("Input.dispatchMouseEvent", {
    type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1,
  });
  return {
    load: async (url) => { await send("Page.navigate", { url }); },
    run: (expression) => evaluate(chrome, sessionId, expression),
    shot: async (box) => (await send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 } })).data,
    swipe: async (x, y, dx) => {
      await send("Input.synthesizeScrollGesture", { x, y, xDistance: -dx, yDistance: 0, gestureSourceType: phone ? "touch" : "mouse", preventFling: true, speed: 1200 });
    },
    press: async (x, y) => {
      if (phone) { await touch("touchStart", x, y); await touch("touchEnd"); return; }
      await mouse("mouseMoved", x, y);
      await mouse("mousePressed", x, y, 1);
      await mouse("mouseReleased", x, y);
    },
    drag: async (fromX, y, toX) => {
      const steps = Array.from({ length: 10 }, (_, step) => fromX + (toX - fromX) * (step + 1) / 10);
      if (phone) {
        await touch("touchStart", fromX, y);
        for (const x of steps) await touch("touchMove", x, y);
        await touch("touchEnd");
        return;
      }
      await mouse("mouseMoved", fromX, y);
      await mouse("mousePressed", fromX, y, 1);
      for (const x of steps) await mouse("mouseMoved", x, y, 1);
      await mouse("mouseReleased", toX, y);
    },
    close: async () => { await chrome.close(); },
  };
}

async function openFirefox(profile: string): Promise<Page> {
  const firefox = await openHeadlessFirefox(profile, FIREFOX, {
    // Firefox draws overlay scrollbars on a Mac, Windows 11 and Android. These
    // draw them everywhere, and keep them showing as they do while a strip scrolls.
    "ui.useOverlayScrollbars": 1,
    "layout.testing.overlay-scrollbars.always-visible": true,
    "general.smoothScroll": false,
  });
  const context = await firefox.context();
  await firefox.send("browsingContext.setViewport", { context, viewport: VIEWPORT });
  const pointer = (actions: object[]) => firefox.send("input.performActions", {
    context, actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions }],
  });
  const at = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) });
  return {
    load: async (url) => { await firefox.send("browsingContext.navigate", { context, url, wait: "complete" }); },
    run: (expression) => firefox.evaluate(context, expression),
    shot: async (box) => (await firefox.send<{ data: string }>("browsingContext.captureScreenshot", { context, clip: { type: "box", ...box } })).data,
    swipe: async (x, y, dx) => {
      await firefox.send("input.performActions", {
        context, actions: [{ type: "wheel", id: "wheel", actions: [{ type: "scroll", ...at(x, y), deltaX: Math.round(dx), deltaY: 0 }] }],
      });
    },
    press: async (x, y) => {
      await pointer([{ type: "pointerMove", ...at(x, y) }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }]);
    },
    drag: async (fromX, y, toX) => {
      await pointer([
        { type: "pointerMove", ...at(fromX, y) }, { type: "pointerDown", button: 0 },
        { type: "pointerMove", ...at(toX, y), duration: 200 }, { type: "pointerUp", button: 0 },
      ]);
    },
    close: async () => { await firefox.close(); },
  };
}

const MODES = [
  { name: "Chrome as a phone, with touch and Android's overlay scrollbar", slug: "chrome-phone", touch: true, open: (profile: string) => openChrome(true, profile) },
  { name: "Chrome with this computer's scrollbars", slug: "chrome-desktop", touch: false, open: (profile: string) => openChrome(false, profile) },
  { name: "Firefox with overlay scrollbars", slug: "firefox-overlay", touch: false, open: openFirefox },
];

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const output = await build({
    configFile: false,
    root: ROOT,
    logLevel: "warn",
    // Vitest's own mode is "test", which would compile the JSX for React's development build.
    mode: "production",
    oxc: { jsx: { runtime: "automatic", development: false } },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(ROOT, "tests/browser/tabStripScrollbar.fixture.tsx"), formats: ["iife"], name: "TabStripScrollbarFixture" },
    },
  });
  const [bundle] = [output].flat() as Array<{ output: Array<{ type: string; code?: string }> }>;
  const code = bundle.output.find((file) => file.type === "chunk")!.code!;
  // The app's viewport, or a phone lays the page out 980 px wide and zooms out.
  writeFileSync(FIXTURE, `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>${readFileSync(path.join(ROOT, "src/windowing/styles/windowing.css"), "utf8")}</style>
<style>html, body { margin: 0; background: #1e293b; color: #f1f5f9; font: 14px sans-serif; }</style>
</head><body><div id="root"></div><script>${code.replaceAll("</script", "<\\/script")}</script></body></html>`);
}, 120_000);

describe.each(MODES)("$name", ({ slug, touch, open }) => {
  let page: Page;
  beforeAll(async () => { page = await open(path.join(OUT, "profiles", slug)); }, 60_000);
  afterAll(async () => { await page?.close(); });

  it("takes no room under the tabs while they all fit", async () => {
    const geometry = await load(page, "?tabs=2");
    expect(geometry.maxScroll).toBe(0);
    expect(lane(geometry).height).toBeLessThan(1);
  });

  it("draws the scrollbar under the tabs, where it follows the strip", async () => {
    const geometry = await load(page);
    expect(geometry.maxScroll).toBeGreaterThan(0);
    const room = lane(geometry);
    expect(room.height, "room under the tabs for the scrollbar").toBeGreaterThanOrEqual(4);
    const start = await page.shot(room);
    await page.run(`document.querySelector(".foss-earth-tab-strip-list").scrollLeft = ${geometry.maxScroll}`);
    await page.run(FRAMES);
    const end = await page.shot(room);
    writeFileSync(path.join(OUT, `${slug}-lane-start.png`), Buffer.from(start, "base64"));
    writeFileSync(path.join(OUT, `${slug}-lane-end.png`), Buffer.from(end, "base64"));
    expect(await differingPixels(page, start, end), "pixels of the scrollbar that moved").toBeGreaterThan(0);
  });

  it("draws nothing over the tabs while they scroll", async () => {
    const geometry = await swipe(page, await load(page), 150);
    const strip = { ...geometry.strip, height: geometry.strip.height + 8 };
    const row = { x: geometry.list.x, y: geometry.tabsTop, width: geometry.list.width, height: geometry.tabsBottom - geometry.tabsTop };
    const [scrolling, stripScrolling] = [await page.shot(row), await page.shot(strip)];
    writeFileSync(path.join(OUT, `${slug}-after-swipe.png`), Buffer.from(stripScrolling, "base64"));
    await page.run(HIDE_BROWSER_SCROLLBAR);
    await page.run(FRAMES);
    const clear = await page.shot(row);
    expect(await page.run<number>(`document.querySelector(".foss-earth-tab-strip-list").scrollLeft`)).toBe(geometry.scrollLeft);
    expect(await differingPixels(page, scrolling, clear), "pixels of the tabs under the scrollbar").toBe(0);
  });

  it("selects a tab, or closes it, from the bottom edge of its label or x just after a swipe", async () => {
    let geometry = await swipe(page, await load(page), 150);
    const target = geometry.visible.find((tab) => !tab.selected)!;
    await page.press(middle(target.button), target.button.y + target.button.height - 1);
    await page.run(FRAMES);
    expect((await page.run<Tabs>("window.tabs")).active, `${target.label} selected`).toBe(target.label);

    geometry = await swipe(page, geometry, 100);
    const closing = geometry.visible.find((tab) => !tab.selected)!;
    await page.press(middle(closing.close), closing.close.y + closing.close.height - 1);
    await page.run(FRAMES);
    expect((await page.run<Tabs>("window.tabs")).open, `${closing.label} closed`).not.toContain(closing.label);
  });

  it.runIf(touch)("swipes the tabs from the scrollbar's lane", async () => {
    const geometry = await load(page);
    const room = lane(geometry);
    expect(room.height, "room under the tabs for the scrollbar").toBeGreaterThanOrEqual(4);
    const after = await swipe(page, geometry, 150, room.y + room.height / 2);
    expect(after.scrollLeft).toBeGreaterThan(100);
  });

  it.skipIf(touch)("scrolls the tabs when the scrollbar under them is dragged", async () => {
    const geometry = await load(page);
    const room = lane(geometry);
    expect(room.height, "room under the tabs for the scrollbar").toBeGreaterThanOrEqual(4);
    await page.drag(room.x + 3, room.y + room.height / 2, room.x + room.width - 3);
    await page.run(FRAMES);
    const after = await page.run<Geometry>(GEOMETRY);
    expect(after.scrollLeft).toBeGreaterThan(after.maxScroll * 0.9);
  });
});
