import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testPlans } from "../vite/index.mjs";

type Handler = Parameters<Parameters<ReturnType<typeof testPlans>["configureServer"]>[0]["middlewares"]["use"]>[0];

let root = "";
beforeEach(() => {
  // Inside this repository's ignored build directory, as the dev server's root would hold it.
  mkdirSync(join(import.meta.dirname, "../build"), { recursive: true });
  root = mkdtempSync(join(import.meta.dirname, "../build/test-plans-"));
  mkdirSync(join(root, "build/test-plans"), { recursive: true });
  writeFileSync(join(root, "build/test-plans/spawn-loading.json"), JSON.stringify({ version: 1, id: "spawn", title: "</script><b>", steps: [{ id: "a", text: "Try" }], sources: [] }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function serve() {
  const plugin = testPlans();
  plugin.configResolved({ root });
  let handler: Handler | null = null;
  plugin.configureServer({ middlewares: { use(next: Handler) { handler = next; } } });
  const visit = (url: string, accept = "text/html,application/xhtml+xml", method = "GET") => {
    const headers: Record<string, string> = {};
    const res = { statusCode: 200, body: "", setHeader: (name: string, value: string) => { headers[name] = value; }, end: (body = "") => { res.body = body; } };
    const next = vi.fn();
    handler!({ url, method, headers: { accept } }, res, next);
    return { status: res.statusCode, headers, body: res.body, passed: next.mock.calls.length > 0 };
  };
  return { plugin, visit };
}

describe("short test links on the dev server", () => {
  it("opens the named checklist on its page, keeping the page's other parameters", () => {
    const { visit } = serve();
    expect(visit("/fly/test/spawn-loading")).toMatchObject({ status: 302, headers: { location: "/fly/?test=spawn-loading" }, passed: false });
    expect(visit("/fly/test/spawn-loading/?renderer=webgl2").headers.location).toBe("/fly/?renderer=webgl2&test=spawn-loading");
    expect(visit("/test/spawn-loading").headers.location).toBe("/?test=spawn-loading");
  });

  it("says which checklists exist when the name is unknown", () => {
    const { visit } = serve();
    const missing = visit("/fly/test/spawn");
    expect(missing.status).toBe(404);
    expect(missing.body).toContain('No test checklist named "spawn"');
    expect(missing.body).toContain("/fly/test/spawn-loading");
  });

  it("leaves modules, files and other requests under a test/ directory alone", () => {
    const { visit } = serve();
    expect(visit("/src/test/spawn-loading", "*/*").passed).toBe(true);
    expect(visit("/fly/test/spawn-loading", "text/html", "POST").passed).toBe(true);
    expect(visit("/fly/test/spawn-loading.json").passed).toBe(true);
    expect(visit("/fly/testing/spawn-loading").passed).toBe(true);
  });

  it("puts the named checklist into the page as inert data that cannot close its element", () => {
    const { plugin } = serve();
    const [tag] = plugin.transformIndexHtml("", { path: "/index.html", originalUrl: "/fly/?renderer=webgl2&test=spawn-loading" })!;
    expect(tag).toMatchObject({ tag: "script", attrs: { type: "application/json", id: "foss-earth-test-plan", "data-name": "spawn-loading" }, injectTo: "head" });
    expect(tag.children).not.toContain("<");
    expect(JSON.parse(tag.children).title).toBe("</script><b>");
    expect(plugin.transformIndexHtml("", { path: "/index.html", originalUrl: "/fly/?test=unknown" })).toBeUndefined();
    expect(plugin.transformIndexHtml("", { path: "/index.html", originalUrl: "/fly/?test=../secret" })).toBeUndefined();
    expect(plugin.transformIndexHtml("", { path: "/index.html", originalUrl: "/fly/" })).toBeUndefined();
  });
});
