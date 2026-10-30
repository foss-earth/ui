import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildReport } from "./report.js";
import { createIssueDraft, ISSUE_DRAFT_URL_LIMIT, issueReportAttachment, issueReportFilename, redactIssueReport, validateIssueReporterConfig, splitIssueReport, issueReportZip, type IssueBundle } from "./issueReport.js";

describe("issue reporter configuration", () => {
  it("accepts the three apps' GitHub repositories", () => {
    for (const repository of ["UMN-VR/UMN-VR.github.io", "0SFS/0SFS.github.io", "FOSS-Earth/FOSS-Earth.github.io"]) {
      expect(validateIssueReporterConfig({ repository, appName: "Globe" })).toEqual({ repository, appName: "Globe" });
    }
  });

  it.each(["org", "org/app/more", "/app", "org/..", "org/.", "org/app?body=x", "org/app#x", "org/name with spaces"])("rejects repository %s", repository => {
    expect(() => validateIssueReporterConfig({ repository })).toThrow("owner/name");
  });
});

describe("public issue report redaction", () => {
  it("removes URL credentials, queries and fragments while preserving useful paths", () => {
    const raw = [
      "Page: https://name:password@tour.example/tour/?panorama=mall&token=sensitive#pair-secret",
      "Tile https://tiles.example/1/2/3.png?key=tile-secret returned 403",
      "Scene /tour/#private-hash and ./scene.json?key=other-secret",
      "Pair URL ?code=code-secret&token=more-secret",
    ].join("\n");
    const report = redactIssueReport(raw);
    for (const value of ["name", "password", "mall", "sensitive", "pair-secret", "tile-secret", "private-hash", "other-secret", "code-secret", "more-secret"]) {
      expect(report).not.toContain(value);
    }
    expect(report).toContain("https://[redacted]@tour.example/tour/[redacted]");
    expect(report).toContain("https://tiles.example/1/2/3.png[redacted] returned 403");
    expect(report).toContain("Scene /tour/[redacted] and ./scene.json[redacted]");
  });

  it("removes secrets in headers, settings, pairing messages, JSON and obvious tokens", () => {
    const raw = [
      "Authorization: Bearer abc.DEF-123_456",
      "Basic YWxhZGRpbjpvcGVuc2VzYW1l",
      "map.apiKey = tile-api-secret (saved; default none)",
      "google_api_key=another-secret",
      'headers {"token":"JSON token with spaces","password":"escaped \\"password\\""}',
      "pairing code = 126789",
      "pair-secret: secret-pairing-value",
      "Cookie: session-cookie-value",
      "Session token: session-private-token",
      "mail me at tester@example.com",
      "ghp_abcdefghijklmnopqrstuvwxyz123456789012",
      "github_pat_abcdefghijklmnopqrstuvwxyz123456789012",
      "AIzaabcdefghijklmnopqrstuvwxyz1234567890",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signature",
      "-----BEGIN PRIVATE KEY-----\nprivate-key-value\n-----END PRIVATE KEY-----",
    ].join("\n");
    const report = redactIssueReport(raw);
    for (const value of [
      "abc.DEF-123_456", "YWxhZGRpbjpvcGVuc2VzYW1l", "tile-api-secret", "another-secret", "JSON token with spaces", "escaped",
      "126789", "secret-pairing-value", "session-cookie-value", "session-private-token", "tester@example.com",
      "abcdefghijklmnopqrstuvwxyz", "eyJhbGci", "private-key-value",
    ]) expect(report).not.toContain(value);
    expect(report).toContain("map.apiKey = [redacted] (saved; default none)");
  });

  it("redacts known host secrets wherever they appear, including common encodings", () => {
    const secret = 'hidden secret"value';
    const report = redactIssueReport([
      `Failed with ${secret}`,
      `Encoded: ${encodeURIComponent(secret)}`,
      `Form encoded: ${encodeURIComponent(secret).replace(/%20/g, "+")}`,
      `JSON: ${JSON.stringify(secret)}`,
    ].join("\n"), [secret, "", "short"]);
    expect(report).toBe('Failed with [redacted]\nEncoded: [redacted]\nForm encoded: [redacted]\nJSON: "[redacted]"');
  });

  it("removes gkey values from URLs, settings and JSON without known secrets", () => {
    const report = redactIssueReport('Page: https://example.org/?gkey=url-private\ngkey=setting-private\n{"gkey":"JSON private value"}\nmap.gkey: nested-private');
    for (const value of ["url-private", "setting-private", "JSON private value", "nested-private"]) expect(report).not.toContain(value);
    expect(report).toContain('gkey=[redacted]\n{"gkey":[redacted]}\nmap.gkey: [redacted]');
  });

  it("redacts coordinates in console payloads and settings without removing GPU or vector details", () => {
    const report = redactIssueReport([
      'Warning: physics state {"position":{"latDeg":44.975123,"lonDeg":-93.234567},"vector":{"x":2,"y":3,"z":4},"maxTextureSize":16384}',
      "state latitude: 44.999 longitude=-93.777 lat_deg=45.555 lon_deg: '-94.888'",
      "  camera.lat = 44.1234 (saved; default 43.4321)",
      "  camera.longitude = -93.1234 (saved; default -92.4321)",
    ].join("\n"));
    for (const coordinate of ["44.975123", "-93.234567", "44.999", "-93.777", "45.555", "-94.888", "44.1234", "43.4321", "-93.1234", "-92.4321"]) {
      expect(report).not.toContain(coordinate);
    }
    expect(report).toContain('"vector":{"x":2,"y":3,"z":4},"maxTextureSize":16384');
    expect(report).toContain("  camera.lat = [redacted]");
  });

  it("can be applied repeatedly while a person edits a preview", () => {
    const once = redactIssueReport('Page: https://user:pass@tour.example/?token=secret#pair\n?code=secret&token=secret\n{"token":"secret","latDeg":44.123}\napiKey=private-key');
    expect(redactIssueReport(once)).toBe(once);
  });

  it("preserves every retained activity step and the complete browser and renderer details", () => {
    const report = [
      "Browser: Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
      "Renderer: webgl2; GPU: Adreno 740; largest texture 16384 px",
      ...Array.from({ length: 500 }, (_, index) => `  ${index / 10} s Scene loaded sphere-${index} ${"details ".repeat(50)}`),
    ].join("\n");
    expect(report.length).toBeGreaterThan(200_000);
    expect(redactIssueReport(report)).toBe(report);
  });
});

describe("local report attachment and GitHub draft", () => {
  const config = { repository: "UMN-VR/UMN-VR.github.io" };
  const input = {
    title: "The panorama goes black",
    description: "I opened the mall panorama and the screen went black.",
    filename: "tour-report.txt",
    report: [
      "Browser: Android Firefox Mobile",
      "Screen: 360 × 800 CSS px; touch",
      "Build: abc123 · source def456",
      "Renderer: webgl2 (asked for webgl2); lost 1 time",
      "GPU: Adreno 740",
      "This visit, oldest first:",
      "0.0 s Loaded panorama mall",
      "4.0 s PRIVATE_ACTIVITY_MARKER",
    ].join("\n"),
  };

  it("uses a filesystem-safe UTC filename and keeps the full reviewed input in the file", () => {
    expect(issueReportFilename(config, new Date("2026-10-08T14:15:16.123Z")))
      .toBe("UMN-VR.github.io-bug-report-2026-10-08T14-15-16-123Z.zip");
    const attachment = issueReportAttachment(config, input);
    expect(attachment).toContain(`Title: ${input.title}`);
    expect(attachment).toContain(input.description);
    expect(attachment).toContain(input.report);
  });

  it("prefills a short summary and filename instructions, with no full activity in the URL", () => {
    const draft = createIssueDraft(config, input);
    const url = new URL(draft.url);
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/UMN-VR/UMN-VR.github.io/issues/new");
    expect(url.searchParams.get("title")).toBe(input.title);
    expect(url.searchParams.get("body")).toBe(draft.body);
    for (const detail of ["Android Firefox Mobile", "webgl2", "abc123", "Adreno 740", input.filename]) expect(draft.body).toContain(detail);
    expect(draft.body).toContain("GitHub attachments become public when uploaded");
    expect(draft.url).not.toContain("PRIVATE_ACTIVITY_MARKER");
    expect(draft.body).not.toContain("Loaded panorama mall");
    expect(draft.url.length).toBeLessThanOrEqual(ISSUE_DRAFT_URL_LIMIT);
  });

  it.each(["tour-report.zip", "tour-report.txt"])("accepts a portable %s attachment in a draft", filename => {
    expect(createIssueDraft(config, { ...input, filename }).body).toContain(filename);
  });

  it("bounds the encoded URL with huge Unicode text without shortening the downloaded report", () => {
    const hugeInput = {
      title: "問題🌎".repeat(500),
      description: "細かい再現手順🌎".repeat(2_000),
      filename: issueReportFilename({ repository: `${"o".repeat(39)}/${"r".repeat(100)}` }, new Date("2026-10-08T14:15:16.123Z")),
      report: `${["Browser", "Screen", "Build", "Renderer", "GPU"].map(field => `${field}: ${"詳細🌎".repeat(1_000)}`).join("\n")}\n${"activity ".repeat(10_000)}`,
    };
    const draft = createIssueDraft({ repository: `${"o".repeat(39)}/${"r".repeat(100)}` }, hugeInput);
    expect(draft.url.length).toBeLessThanOrEqual(ISSUE_DRAFT_URL_LIMIT);
    expect(draft.shortened).toBe(true);
    expect(draft.body).toContain(hugeInput.filename);
    const attachment = issueReportAttachment(config, hugeInput);
    expect(attachment).toContain(hugeInput.title);
    expect(attachment).toContain(hugeInput.description);
    expect(attachment).toContain(hugeInput.report);
  });

  it("redacts selected summary lines and rejects unsafe filenames", () => {
    const draft = createIssueDraft(config, { ...input, report: "Browser: tester@example.com\nBuild: apiKey=secret-value\nRenderer: webgl2" });
    expect(draft.body).not.toContain("tester@example.com");
    expect(draft.body).not.toContain("secret-value");
    expect(() => createIssueDraft(config, { ...input, filename: "../secret.txt" })).toThrow("filename");
    expect(() => createIssueDraft(config, { ...input, filename: `${"x".repeat(1_000)}.txt` })).toThrow("filename");
  });
});

const flightState = [
  ["loading.txt", `Loading diagnostics:\n${JSON.stringify({ tasks: ["name } with { braces", "Settings (all effective values):"], message: 'escaped "quote"' }, null, 2)}`],
  ["component-execution.txt", 'Component execution: [{"name":"earth","backend":"worker"}]'],
  ["compute-scheduling.txt", 'Compute scheduling: {"workers":2}'],
  ["isolation.txt", "Isolation: cross-origin isolated; shared memory available"],
  ["aircraft.txt", "Aircraft: C172; model loaded"],
  ["flight.txt", "Flight: paused; view third"],
  ["flight-progress.txt", 'Flight progress: {"ticks":42}'],
  ["jsbsim.txt", 'JSBSim: {"state":"ready"}'],
  ["console.txt", `Console diagnostics: ${JSON.stringify({ count: 1, messages: [{ text: 'escaped "quote", } braces {, line\nnext', level: "error" }] })}`],
  ["scene.txt", "Scene: Earth"],
  ["build-components.txt", "Build components:\n  renderer abc123\n  engine def456"],
  ["render-health.txt", "Render health: ready"],
  ["app-files.txt", "App files: 3 kept files"],
  ["published.txt", "Published: local development"],
  ["cache-state.txt", "Cache state: empty\n  no entries"],
] as const;

function fullReport(prefix = "", errorLines = "Errors nothing handled: none."): string {
  return `${prefix}${[
    "0SFS report, 2026-10-28T12:00:00.000Z", "Page: https://localhost:7470/fly/", "Build: local", "Browser: test browser", "Screen: 1440 × 900",
    "Renderer: webgpu (asked for webgpu)", "GPU: example device", "Graphics capability textures: available",
    ...flightState.map(([, text]) => text),
    "", "Settings (all effective values):", '  aircraft.selection = "C172" (saved; default "SF-50")',
    ...Array.from({ length: 60 }, (_, n) => `  setting.${n} = ${n}`),
    "", errorLines, "", "This visit, oldest first:", "  0.0 s App opened", "  1.0 s Aircraft change requested", "",
    "The visit before, opened 2026-10-27T12:00:00.000Z, was closed. 0SFS", "  3.0 s Last step", "",
  ].join("\n")}`;
}
function file(bundle: IssueBundle, name: string): string {
  const found = bundle.files.find(item => item.name === name);
  expect(found, name).toBeDefined();
  return found!.text;
}
function indexData(bundle: IssueBundle): {
  failure: { file: string; line: number; text: string } | null;
  needles: { file: string; line: number; text: string }[];
  files: { name: string; lines: number }[];
} {
  return JSON.parse(file(bundle, "index.json"));
}

describe("one portable report split into indexed text files", () => {
  it("extends buildReport directly while preserving its environment, states and section order", () => {
    const report = buildReport({
      appName: "0SFS", at: new Date("2026-10-28T12:00:00.000Z"), page: "https://localhost:7470/fly/",
      build: "local", source: "source-id", bundle: "main.js", userAgent: "test browser",
      screen: { width: 800, height: 600, devicePixelRatio: 1, touch: false }, device: { cores: 8, memoryGiB: null },
      environment: ["Browser environment: secure"],
      renderer: { asked: "webgpu", mode: "webgpu", driver: "test GPU", maxTextureSize: 4096, fallbackReason: null, lost: 0,
        capabilities: ["Graphics capability textureFloatRender: true"] },
      state: flightState.map(([, text]) => text),
      settings: [{ id: "aircraft.selection", value: "C172", defaultValue: "SF-50", from: "saved" }], settingsComplete: true,
      errors: [{ kind: "error", message: "TypeError: component failed", count: 1 }],
      steps: [{ ms: 0, text: "first step" }, { ms: 1000, text: "second step" }], previous: null,
    });
    const headings = ["0SFS report, ", "Browser environment:", "Renderer:", "GPU:", "Graphics capability ",
      ...flightState.map(([, text]) => text.split("\n")[0]!), "Settings (all effective values):", "Errors nothing handled:", "This visit, oldest first:", "The visit before"];
    const positions = headings.map((heading, index) => index === 0 ? 0 : report.indexOf(`\n${heading}`));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    const bundle = splitIssueReport(report);
    for (const [name, text] of flightState) expect(file(bundle, name)).toBe(text);
    expect(file(bundle, "environment.txt")).toContain("Graphics capability textureFloatRender: true");
    expect(file(bundle, "settings.txt")).toBe("Settings (all effective values):\n  aircraft.selection = C172 (saved; default SF-50)");
    expect(indexData(bundle).failure).toMatchObject({ file: "errors.txt", line: 2, text: "  TypeError: component failed" });
    expect(file(bundle, "visit.txt").indexOf("first step")).toBeLessThan(file(bundle, "visit.txt").indexOf("second step"));
  });

  it("follows buildReport section order, extracting every flight and FOSS Earth state blob", () => {
    const bundle = splitIssueReport(fullReport("Aircraft change failed.\nTypeError: Could not apply C172\n"));
    expect(bundle.files.map(item => item.name)).toEqual([
      "index.txt", "index.json", "failure.txt", "environment.txt", "renderer.txt", "gpu.txt",
      ...flightState.map(([name]) => name), "settings.txt", "errors.txt", "visit.txt", "previous-visit.txt",
    ]);
    expect(file(bundle, "failure.txt")).toBe("Aircraft change failed.\nTypeError: Could not apply C172");
    expect(file(bundle, "environment.txt")).toBe([
      "0SFS report, 2026-10-28T12:00:00.000Z", "Page: https://localhost:7470/fly/", "Build: local", "Browser: test browser", "Screen: 1440 × 900", "Graphics capability textures: available",
    ].join("\n"));
    for (const [name, text] of flightState) expect(file(bundle, name), name).toBe(text);
    expect(file(bundle, "console.txt").split("\n")).toHaveLength(1);
    expect(JSON.parse(file(bundle, "console.txt").slice("Console diagnostics: ".length))).toEqual({ count: 1, messages: [{ text: 'escaped "quote", } braces {, line\nnext', level: "error" }] });
    expect(file(bundle, "settings.txt")).toContain('aircraft.selection = "C172"');
    expect(file(bundle, "errors.txt")).toBe("Errors nothing handled: none.");
    expect(file(bundle, "visit.txt")).toBe("This visit, oldest first:\n  0.0 s App opened\n  1.0 s Aircraft change requested");
    expect(file(bundle, "previous-visit.txt")).toContain("  3.0 s Last step");
  });

  it("quotes the exact explicit failure line and names only lines that exist", () => {
    const failureLine = `  TypeError: Aircraft "C172" rejected ${"an exact quoted diagnostic ".repeat(15)}`;
    const prefix = ["Aircraft change failed.", "Saved aircraft.selection = C172", "", failureLine, "    at applyAircraft (aircraft.ts:42:3)", ""].join("\n");
    const bundle = splitIssueReport(fullReport(prefix));
    const index = indexData(bundle);
    expect(file(bundle, "failure.txt")).toBe(prefix.replace(/\n+$/, ""));
    expect(index.failure).toMatchObject({ file: "failure.txt", line: 4, text: failureLine });
    expect(file(bundle, "index.txt")).toContain(`the failure: failure.txt:4\n> ${failureLine}`);
    expect(index.needles).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "failure.txt", line: 5, text: "    at applyAircraft (aircraft.ts:42:3)" }),
      expect.objectContaining({ file: "settings.txt", line: 2, text: '  aircraft.selection = "C172" (saved; default "SF-50")' }),
    ]));
    for (const needle of index.needles) expect(file(bundle, needle.file).split("\n")[needle.line - 1]).toBe(needle.text);
  });

  it("uses captured errors when the original report has no failure prefix", () => {
    const error = "  RangeError: sample state is out of range at runtime.ts:52";
    const bundle = splitIssueReport(fullReport("", `Errors nothing handled:\n${error}\n      at update (runtime.ts:52:4)`));
    expect(bundle.files.some(item => item.name === "failure.txt")).toBe(false);
    expect(indexData(bundle).failure).toMatchObject({ file: "errors.txt", line: 2, text: error });
    expect(file(bundle, "index.txt")).toContain(`errors.txt:2\n> ${error}`);
  });

  it("records no invented failure when a report has no prefix or captured errors", () => {
    const bundle = splitIssueReport(fullReport());
    expect(indexData(bundle).failure).toBeNull();
    expect(bundle.needles).toEqual([]);
    expect(file(bundle, "index.txt")).toContain("no failure recorded");
  });

  it("names an unexpectedly stopped previous visit when it is the only failure evidence", () => {
    const stopped = "The visit before, opened 2026-10-27T16:00:00.000Z, stopped without being closed, while shown. FOSS Earth";
    const bundle = splitIssueReport(fullReport().replace(/^The visit before[^\n]*/m, stopped));
    expect(indexData(bundle).failure).toMatchObject({ file: "previous-visit.txt", line: 1, text: stopped });
    expect(file(bundle, "index.txt")).toContain(`previous-visit.txt:1\n> ${stopped}`);
  });

  it("uses a supplied bug title and never calls an empty bug form a failure", () => {
    const config = { repository: "foss-earth/app" };
    const input = { title: "", description: "", report: fullReport(), filename: "report.zip" };
    expect(indexData(splitIssueReport(issueReportAttachment(config, input))).failure).toBeNull();
    expect(indexData(splitIssueReport(issueReportAttachment(config, { ...input, title: "The view went black" }))).failure)
      .toMatchObject({ file: "failure.txt", line: 2, text: "Title: The view went black" });
  });

  it("lists the actual line count of every file, including both indexes", () => {
    const bundle = splitIssueReport(fullReport("Error: Example failure\n"));
    const index = indexData(bundle);
    expect(index.files.map(entry => entry.name)).toEqual(bundle.files.map(entry => entry.name));
    for (const entry of index.files) {
      expect(entry.lines, entry.name).toBe(file(bundle, entry.name).split("\n").length);
      expect(file(bundle, "index.txt")).toContain(`- ${entry.name}  ${entry.lines} `);
    }
    expect(file(bundle, "index.txt").split("\n")[0]).toContain("Start with index.txt");
  });

  it("gives repeated state headings unique filenames without losing either body", () => {
    const raw = fullReport().replace("Scene: Earth", "Scene: Earth\nScene: second scene\nBuild components:\n  first duplicate build");
    const bundle = splitIssueReport(raw);
    expect(new Set(bundle.files.map(item => item.name)).size).toBe(bundle.files.length);
    expect(file(bundle, "scene.txt")).toBe("Scene: Earth");
    expect(file(bundle, "scene-2.txt")).toBe("Scene: second scene");
    expect(file(bundle, "build-components.txt")).toBe("Build components:\n  first duplicate build");
    expect(file(bundle, "build-components-2.txt")).toBe("Build components:\n  renderer abc123\n  engine def456");
  });

  it.each([
    "TypeError: Failed to fetch dynamically imported module: https://localhost:7470/aircraft.js",
    "TypeError: error loading dynamically imported module",
    "TypeError: Importing a module script failed.",
  ])("points outside the report for a dev-server log: %s", failure => {
    const bundle = splitIssueReport(fullReport(`${failure}\n`));
    expect(file(bundle, "index.txt")).toContain("A dev-server log is not inside this report.");
    expect(bundle.files.some(item => /dev-server|server-log/.test(item.name))).toBe(false);
  });

  it("preserves a failure-only string when there is no report marker", () => {
    const raw = "Aircraft change failed.\nTypeError: missing package\n    at load (aircraft.ts:8:2)\n";
    const bundle = splitIssueReport(raw);
    expect(bundle.files.map(item => item.name)).toEqual(["index.txt", "index.json", "failure.txt"]);
    expect(file(bundle, "failure.txt")).toBe(raw.trimEnd());
    expect(indexData(bundle).failure).toMatchObject({ file: "failure.txt", line: 2, text: "TypeError: missing package" });
  });
});

describe("standard STORE zip report download", () => {
  it("has valid local entries, central offsets, exact UTF-8 contents and independent CRCs", () => {
    const bundle = splitIssueReport(fullReport('TypeError: Failed to load "C172" 🌎\n'));
    const zip = issueReportZip(bundle);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 8, true)).toBe(bundle.files.length);
    expect(view.getUint16(end + 10, true)).toBe(bundle.files.length);
    const centralStart = view.getUint32(end + 16, true);
    expect(view.getUint32(end + 12, true)).toBe(end - centralStart);
    let central = centralStart;
    let nextLocal = 0;
    for (const expected of bundle.files) {
      expect(view.getUint32(central, true)).toBe(0x02014b50);
      expect(view.getUint16(central + 10, true)).toBe(0); // STORE, no compression.
      const local = view.getUint32(central + 42, true);
      expect(local).toBe(nextLocal);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      expect(view.getUint16(local + 8, true)).toBe(0);
      expect(view.getUint16(local + 6, true) & 0x0800).toBe(0x0800); // UTF-8.
      const nameLength = view.getUint16(local + 26, true);
      const extraLength = view.getUint16(local + 28, true);
      const name = decoder.decode(zip.subarray(local + 30, local + 30 + nameLength));
      expect(name).toBe(expected.name);
      expect(decoder.decode(zip.subarray(central + 46, central + 46 + view.getUint16(central + 28, true)))).toBe(name);
      const size = view.getUint32(local + 22, true);
      expect(size).toBe(encoder.encode(expected.text).length);
      expect(view.getUint32(local + 18, true)).toBe(size);
      expect(view.getUint32(central + 20, true)).toBe(size);
      expect(view.getUint32(central + 24, true)).toBe(size);
      const data = zip.subarray(local + 30 + nameLength + extraLength, local + 30 + nameLength + extraLength + size);
      expect(decoder.decode(data), name).toBe(expected.text);
      expect(view.getUint32(local + 14, true)).toBe(crc32(data));
      expect(view.getUint32(central + 16, true)).toBe(crc32(data));
      nextLocal = local + 30 + nameLength + extraLength + size;
      central += 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
    }
    expect(nextLocal).toBe(centralStart);
    expect(central).toBe(end);
  });
});
