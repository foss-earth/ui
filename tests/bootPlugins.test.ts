// @vitest-environment jsdom
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootTerminal, warmPages } from "../vite/index.mjs";

const ROOT = "/repo/tour";
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Minneapolis &amp; more</title>
    <script type="module" crossorigin src="/tour/assets/minneapolis-1.js"></script>
    <link rel="modulepreload" crossorigin href="/tour/assets/shared-1.js">
    <link rel="stylesheet" crossorigin href="/tour/assets/scenes-1.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

/** Text that compresses to about `bytes` / 2, a different size for each file. */
const code = (bytes: number): string => Array.from({ length: bytes / 4 }, (_, i) => ((i * 7919) % 10007).toString(36).padStart(3, "0")).join(",");
const chunk = (fileName: string, bytes: number, extra: { facadeModuleId?: string; imports?: string[]; css?: string[] } = {}) => ({
  type: "chunk" as const, fileName, code: code(bytes), facadeModuleId: extra.facadeModuleId ?? null, imports: extra.imports ?? [], viteMetadata: { importedCss: new Set(extra.css ?? []) },
});
const bundle = Object.fromEntries([
  chunk("assets/selector-1.js", 400, { facadeModuleId: `${ROOT}/index.html` }),
  chunk("assets/minneapolis-1.js", 4000, { facadeModuleId: `${ROOT}/minneapolis/index.html`, imports: ["assets/shared-1.js", "assets/babylon-1.js"], css: ["assets/scenes-1.css"] }),
  chunk("assets/st-paul-1.js", 2000, { facadeModuleId: `${ROOT}/st-paul/index.html`, imports: ["assets/shared-1.js", "assets/tiles-1.js"], css: ["assets/scenes-1.css"] }),
  chunk("assets/shared-1.js", 8000),
  chunk("assets/babylon-1.js", 40000),
  chunk("assets/tiles-1.js", 12000),
  chunk("assets/flight-1.js", 16000, { facadeModuleId: `${ROOT}/src/flight.ts`, imports: ["assets/shared-1.js", "assets/physics-1.js"] }),
  chunk("assets/physics-1.js", 24000),
  chunk("assets/lazy-1.js", 800),
  { type: "asset" as const, fileName: "assets/scenes-1.css", source: code(1200) },
].map(output => [output.fileName, output]));
const gzipped = (file: string): number => {
  const output = bundle[file]!;
  return gzipSync(output.type === "chunk" ? output.code : output.source).length;
};

function terminal(options: Parameters<typeof bootTerminal>[0] = {}, base = "/tour/") {
  const plugin = bootTerminal(options);
  plugin.configResolved({ base, root: ROOT });
  return plugin;
}
const built = (path: string, entry: string) => ({ path, bundle, chunk: bundle[entry] });
const graphOf = (html: string) => JSON.parse(html.match(/installBootTerminal\(window, (.*)\);\n\}\)\(\);<\/script>/)![1]!) as { base: string; files: [string, number][]; preload?: string[] } | null;
const headScriptOf = (html: string) => html.match(/<\/style><script>(.*?)<\/script>/)![1]!;

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (globalThis as Record<string, unknown>).__fossEarthBoot;
  document.documentElement.removeAttribute("data-boot-theme");
});

describe("bootTerminal", () => {
  it("paints the terminal from the page's first bytes and moves its stylesheets to the end of its body", () => {
    const html = terminal().transformIndexHtml.handler(PAGE, { path: "/minneapolis/index.html" });
    const charset = '<meta charset="UTF-8" />';
    expect(html.indexOf('<style id="foss-earth-boot-style">')).toBe(html.indexOf(charset) + charset.length);
    expect(html).toContain('</style><script>(()=>{try{performance.getEntriesByName("boot:html")');
    expect(html).toContain('<body><div id="foss-earth-boot"><p class="fe-boot__title">Minneapolis &amp; more</p>');
    expect(html.indexOf('<link rel="modulepreload"')).toBeLessThan(html.indexOf("</head>"));
    expect(html.indexOf('<link rel="stylesheet"')).toBeGreaterThan(html.indexOf('<div id="root">'));
    expect(html.indexOf('<link rel="stylesheet"')).toBeLessThan(html.indexOf("</body>"));
    expect(html.match(/<link rel="stylesheet"/g)).toHaveLength(1);
    // The dev server's page has no build to count.
    expect(graphOf(html)).toBeNull();
    // Its runtime runs as the page's inline script.
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script>[\s\S]*?<\/script>/, "");
    const runtime = html.match(/<script>("use strict";[\s\S]*?)<\/script>/)![1]!;
    new Function("window", runtime)(window);
    const boot = (window as unknown as Record<string, { step(id: string, text: string): void; done(): void }>).__fossEarthBoot!;
    boot.step("modules", "Starting the app");
    expect([...document.querySelectorAll("#foss-earth-boot li")].map(row => row.textContent)).toEqual([expect.stringMatching(/^Loaded the app in /), "Starting the app"]);
    boot.done();
  });

  it("lists what a page waits for before its first module runs, with compressed sizes", () => {
    const html = terminal().transformIndexHtml.handler(PAGE, built("/minneapolis/index.html", "assets/minneapolis-1.js"));
    const files = ["assets/babylon-1.js", "assets/minneapolis-1.js", "assets/scenes-1.css", "assets/shared-1.js"];
    expect(graphOf(html)).toEqual({ base: "/tour/", files: files.map(file => [file, gzipped(file)]) });
    const waiting = terminal({ waitFor: ["src/flight.ts"] }).transformIndexHtml.handler(PAGE, built("/minneapolis/index.html", "assets/minneapolis-1.js"));
    expect(graphOf(waiting)!.files.map(([file]) => file)).toEqual([...files, "assets/flight-1.js", "assets/physics-1.js"].sort());
    // Vite preloads the entry's imports; the page fetches the rest at once, largest first.
    expect(graphOf(html)!.preload).toBeUndefined();
    expect(graphOf(waiting)!.preload).toEqual(["assets/physics-1.js", "assets/flight-1.js"]);
    expect(gzipped("assets/physics-1.js")).toBeGreaterThan(gzipped("assets/flight-1.js"));
    expect(() => terminal({ waitFor: ["src/missing.ts"] }).transformIndexHtml.handler(PAGE, built("/minneapolis/index.html", "assets/minneapolis-1.js"))).toThrow(/waitFor names src\/missing\.ts/);
  });

  it("names the files from a page's folder under a relative base", () => {
    expect(graphOf(terminal({}, "./").transformIndexHtml.handler(PAGE, built("/minneapolis/index.html", "assets/minneapolis-1.js")))!.base).toBe("../");
    expect(graphOf(terminal({}, "./").transformIndexHtml.handler(PAGE, built("/index.html", "assets/selector-1.js")))!.base).toBe("./");
  });

  it("leaves out the light palettes on a page that is always dark", () => {
    const styleOf = (html: string) => html.match(/<style id="foss-earth-boot-style">(.*?)<\/style>/)![1]!;
    const auto = styleOf(terminal().transformIndexHtml.handler(PAGE, { path: "/index.html" }));
    const dark = styleOf(terminal({ theme: "dark" }).transformIndexHtml.handler(PAGE, { path: "/index.html" }));
    for (const style of [auto, dark]) {
      expect(style).toContain('html[data-ui-theme="umn"] #foss-earth-boot');
      expect(style).not.toMatch(/\/\*|\n/);
    }
    expect(auto).toContain("prefers-color-scheme: light");
    expect(auto).toContain('[data-boot-theme="light"]');
    expect(dark).not.toContain("light");
  });

  it("leaves the pages it is not for alone, and checks its options", () => {
    expect(terminal({ pages: page => page === "/minneapolis/index.html" }).transformIndexHtml.handler(PAGE, { path: "/index.html" })).toBe(PAGE);
    expect(terminal({ title: "A < B" }).transformIndexHtml.handler(PAGE, { path: "/index.html" })).toContain('<p class="fe-boot__title">A &lt; B</p>');
    expect(() => bootTerminal({ theme: "light" as "dark" })).toThrow(/theme/);
    expect(() => bootTerminal({ title: " " })).toThrow(/title/);
  });

  it("starts the terminal in the theme the visitor chose, and marks when the HTML began to run", () => {
    const script = headScriptOf(terminal().transformIndexHtml.handler(PAGE, { path: "/index.html" }));
    const themeWith = (items: Record<string, string>, marked = false) => {
      document.documentElement.removeAttribute("data-boot-theme");
      const performance = { getEntriesByName: () => marked ? [{}] : [], mark: vi.fn() };
      const localStorage = { getItem: (key: string) => items[key] ?? null };
      new Function("performance", "localStorage", "document", script)(performance, localStorage, document);
      expect(performance.mark).toHaveBeenCalledTimes(marked ? 0 : 1);
      return document.documentElement.getAttribute("data-boot-theme");
    };
    const settings = (theme: string, version = 1) => JSON.stringify({ version, values: { "interface.theme": theme } });
    expect(themeWith({ "foss-earth.theme": "light" })).toBe("light");
    expect(themeWith({ "foss-earth.theme": "dark" }, true)).toBe("dark");
    expect(themeWith({ "foss-earth.theme": "auto", "foss-earth.settings.v1": settings("dark") })).toBeNull();
    expect(themeWith({ "foss-earth.settings.v1": settings("light") })).toBe("light");
    expect(themeWith({ "foss-earth.settings.v1": settings("light", 2) })).toBeNull();
    expect(themeWith({ "foss-earth.settings.v1": "{" })).toBeNull();
    expect(themeWith({})).toBeNull();
  });
});

describe("warmPages", () => {
  const SELECTOR = "<!doctype html><html><head></head><body><main></main></body></html>";
  const warm = () => {
    const plugin = warmPages({ from: "/index.html", pages: ["/minneapolis/index.html", "/st-paul/index.html"] });
    plugin.configResolved({ base: "/tour/", root: ROOT });
    return plugin;
  };
  const filesOf = (html: string) => JSON.parse(html.match(/const files=(\[.*?\]);/)![1]!) as string[];

  it("lets the selector fetch a campus page as its card is pressed, and that page's files once idle", () => {
    const html = warm().transformIndexHtml.handler(SELECTOR, built("/index.html", "assets/selector-1.js"));
    expect(html).toContain('<script type="speculationrules">{"prefetch":[{"source":"document","where":{"or":[{"href_matches":"/tour/minneapolis/"},{"href_matches":"/tour/st-paul/"}]},"eagerness":"moderate"}]}</script>');
    expect(html.indexOf("speculationrules")).toBeGreaterThan(html.indexOf("<main>"));
    const files = ["assets/babylon-1.js", "assets/minneapolis-1.js", "assets/scenes-1.css", "assets/shared-1.js", "assets/st-paul-1.js", "assets/tiles-1.js"];
    expect(filesOf(html)).toEqual(files.sort((a, b) => gzipped(b) - gzipped(a)).map(file => `/tour/${file}`));
    expect(gzipped("assets/babylon-1.js")).toBeGreaterThan(gzipped("assets/tiles-1.js"));
  });

  it("leaves other pages and the dev server alone, and checks its pages", () => {
    expect(warm().transformIndexHtml.handler(SELECTOR, built("/minneapolis/index.html", "assets/minneapolis-1.js"))).toBe(SELECTOR);
    expect(warm().transformIndexHtml.handler(SELECTOR, { path: "/index.html" })).toBe(SELECTOR);
    expect(warm().apply).toBe("build");
    expect(() => warmPages({ from: "/index.html", pages: ["/minneapolis/"] })).toThrow(/\.html pages/);
    const missing = warmPages({ from: "/index.html", pages: ["/duluth/index.html"] });
    missing.configResolved({ base: "/tour/", root: ROOT });
    expect(() => missing.transformIndexHtml.handler(SELECTOR, built("/index.html", "assets/selector-1.js"))).toThrow(/duluth/);
  });

  it("warms a few files at a time once the page is idle, and nothing under Save-Data", () => {
    const html = warm().transformIndexHtml.handler(SELECTOR, built("/index.html", "assets/selector-1.js"));
    const script = html.match(/<script>(\(\(\)=>\{const c=navigator\.connection[\s\S]*?)<\/script>/)![1]!;
    const run = (connection: object) => {
      let idle: (() => void) | null = null;
      const view = { requestIdleCallback: (callback: () => void) => { idle = callback; } };
      new Function("navigator", "window", "requestIdleCallback", "document", "addEventListener", "setTimeout", script)(
        { connection }, view, view.requestIdleCallback, document, () => { throw new Error("The page has loaded."); }, () => { throw new Error("Idle callbacks are there."); });
      return () => idle?.();
    };
    run({ saveData: true })();
    run({ effectiveType: "slow-2g" })();
    expect(document.head.querySelectorAll("link")).toHaveLength(0);
    const idle = run({ effectiveType: "4g" });
    expect(document.head.querySelectorAll("link")).toHaveLength(0);
    idle();
    const links = () => [...document.head.querySelectorAll<HTMLLinkElement>("link[rel=prefetch]")].map(link => link.getAttribute("href"));
    expect(links()).toEqual(filesOf(html).slice(0, 4));
    document.head.querySelector("link")!.dispatchEvent(new Event("load"));
    expect(links()).toEqual(filesOf(html).slice(0, 5));
  });
});
