/** The GitHub repository where a host's bugs are reported. */
export interface IssueReporterConfig {
  /** A repository in owner/name form. */
  repository: string;
  appName?: string;
}

/** Validate the repository before creating a GitHub issue link. */
export function validateIssueReporterConfig(config: IssueReporterConfig): IssueReporterConfig {
  if (!/^[a-z\d][a-z\d-]{0,38}\/[a-z\d._-]{1,100}$/i.test(config.repository) || [".", ".."].includes(config.repository.split("/")[1])) {
    throw new Error("The issue repository must be in owner/name form.");
  }
  return { ...config };
}

const REDACTED = "[redacted]";

function redactUrl(value: string): string {
  // Strip these directly rather than decode/re-encode the path, so useful source
  // locations and stack frames retain their original spelling.
  return value.replace(/^(https?:\/\/)[^/\s]+@/i, "$1[redacted]@")
    .replace(/[?#].*$/, REDACTED);
}

/**
 * Redact a report without shortening its retained activity. This is a second
 * boundary after report generation: errors and activity can contain secrets
 * outside the settings fields. Known host secrets are replaced wherever they
 * occur, including common URL encodings. Heuristics cannot recognize every
 * personal detail, so the reporting UI always shows the result for review.
 */
export function redactIssueReport(text: string, secrets: readonly string[] = []): string {
  let result = text;
  const known = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    known.add(secret);
    known.add(JSON.stringify(secret).slice(1, -1));
    try {
      const encoded = encodeURIComponent(secret);
      known.add(encoded);
      known.add(encoded.replace(/%20/g, "+"));
    } catch { /* A malformed Unicode value can still be replaced literally. */ }
  }
  for (const secret of [...known].sort((a, b) => b.length - a.length)) result = result.split(secret).join(REDACTED);

  result = result
    .replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g, REDACTED)
    .replace(/https?:\/\/[^\s<>"'`]+/gi, redactUrl)
    .replace(/(^|[\s("'`])((?:\/|\.{1,2}\/)[^\s<>"'`?#]*)([?#][^\s<>"'`]+)/g, "$1$2[redacted]")
    // Also cover relative URLs and fragments logged without an origin.
    .replace(/([?#&](?:[a-z\d_.%+-]+)=)(?:\[redacted\]|[^\s<>"'`&#)\]}]*)/gi, "$1[redacted]")
    .replace(/\b(?:Bearer|Basic)\s+[a-z\d._~+/-]+=*/gi, match => `${match.split(/\s/)[0]} ${REDACTED}`)
    .replace(/\b(?:gh[pousr]_[a-z\d]{20,}|github_pat_[a-z\d_]{20,}|AIza[a-z\d_-]{20,}|sk-[a-z\d_-]{20,}|(?:AKIA|ASIA)[a-z\d]{16})\b/gi, REDACTED)
    .replace(/\beyJ[a-z\d_-]+\.[a-z\d_-]+\.[a-z\d_-]+\b/gi, REDACTED)
    .replace(/^([ \t]*(?:Cookie|Set-Cookie|Authorization)\s*:\s*)[^\r\n]*/gim, "$1[redacted]")
    // A location setting's default is also a coordinate; omit that value too.
    .replace(/^([ \t]*(?:[a-z\d_.-]*[._-])?(?:latitude|longitude|latDeg|lonDeg|lat_deg|lon_deg|lat|lon)\s*=\s*)[^\r\n]*/gim, "$1[redacted]")
    .replace(/(["']?\b(?:latitude|longitude|latDeg|lonDeg|lat_deg|lon_deg|lat|lon)\b["']?\s*[:=]\s*)(?:\[redacted\]|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[-+]?\d+(?:\.\d*)?(?:e[-+]?\d+)?)/gi, "$1[redacted]")
    .replace(/(["']?\b(?:[a-z\d_.-]*[._-])?(?:gkey|key|api[_ .-]?key|access[_ .-]?token|refresh[_ .-]?token|id[_ .-]?token|(?:client[_ .-]?)?secret|password|passwd|pwd|token|authorization|credentials?|pair(?:ing)?(?:[_ .-]?(?:code|secret|token))?|pin|cookies?|session[_ .-]?(?:id|token))\b["']?\s*[:=]\s*)(?:\[redacted\]|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;)\]}]+)/gi, "$1[redacted]")
    .replace(/\b[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}\b/gi, REDACTED);
  return result;
}

export interface IssueReportDraftInput {
  title: string;
  description: string;
  /** The complete reviewed report, used only for selected summary lines. */
  report: string;
  filename: string;
}

export interface IssueReportDraft {
  url: string;
  body: string;
  /** Some text was shortened in the draft; the attachment still has all of it. */
  shortened: boolean;
}

/** A conservative URL limit for mobile browsers and sign-in redirects. */
export const ISSUE_DRAFT_URL_LIMIT = 2_000;
const SUMMARY_FIELDS = ["Browser", "Screen", "Build", "Renderer", "GPU"] as const;
const encodedSize = (value: string): number => new URLSearchParams({ v: value }).toString().length - 2;

function fitEncoded(value: string, budget: number): string {
  if (encodedSize(value) <= budget) return value;
  const suffix = "…";
  const available = Math.max(0, budget - encodedSize(suffix));
  let fitted = "";
  let used = 0;
  for (const character of value) {
    const cost = encodedSize(character);
    if (used + cost > available) break;
    fitted += character;
    used += cost;
  }
  return budget >= encodedSize(suffix) ? `${fitted}${suffix}` : "";
}

/** The full report is a local file, never an issue URL or a remote upload. */
export function issueReportFilename(config: IssueReporterConfig | undefined, at: Date): string {
  const name = config ? validateIssueReporterConfig(config).repository.split("/")[1] : "app";
  return `${name}-bug-report-${at.toISOString().replace(/[:.]/g, "-")}.zip`;
}

export function issueReportAttachment(config: IssueReporterConfig | undefined, input: IssueReportDraftInput): string {
  const app = config ? validateIssueReporterConfig(config).repository : "this app";
  return `Bug report for ${app}\nTitle: ${redactIssueReport(input.title)}\n\nWhat happened:\n${redactIssueReport(input.description)}\n\nActivity report:\n${redactIssueReport(input.report)}`;
}

/**
 * Make a short GitHub draft with selected device/build/renderer details. The
 * encoded URL stays below 2,000 characters even with non-ASCII user text. Only
 * the draft summary is shortened; the downloadable attachment retains the
 * complete description and every activity step.
 */
export function createIssueDraft(config: IssueReporterConfig, input: IssueReportDraftInput): IssueReportDraft {
  const { repository } = validateIssueReporterConfig(config);
  if (!/^[a-z\d._-]{1,200}\.(?:txt|zip)$/i.test(input.filename)) throw new Error("The report filename must be a short .zip or .txt filename.");
  const base = `https://github.com/${repository}/issues/new`;
  const title = fitEncoded(redactIssueReport(input.title.trim()), 240);
  const description = redactIssueReport(input.description.trim());
  const lines = redactIssueReport(input.report).split("\n");
  const details = SUMMARY_FIELDS.map(field => lines.find(line => line.startsWith(`${field}: `))?.slice(field.length + 2) ?? "not recorded");
  const heading = "What happened (summary):\n";
  const summaryHeading = "\n\nDevice, build and renderer (summary):\n";
  const footer = `\n\nAttach the downloaded file ${input.filename} to this issue. It contains the full description and activity report. Review it first: GitHub attachments become public when uploaded. Submit publishes the issue.`;
  const labels = SUMMARY_FIELDS.map(field => `${field}: `);
  const fixed = heading + summaryHeading + labels.join("\n") + footer;
  const available = Math.max(0, ISSUE_DRAFT_URL_LIMIT - base.length - "?title=".length - encodedSize(title) - "&body=".length - encodedSize(fixed));
  const descriptionBudget = Math.floor(available * 0.4);
  const detailBudget = Math.floor((available - descriptionBudget) / details.length);
  const shortDescription = fitEncoded(description, descriptionBudget);
  const shortDetails = details.map(detail => fitEncoded(detail, detailBudget));
  const body = `${heading}${shortDescription}${summaryHeading}${shortDetails.map((detail, index) => `${labels[index]}${detail}`).join("\n")}${footer}`;
  const url = new URL(base);
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  return { url: url.href, body, shortened: title !== input.title.trim() || shortDescription !== description || shortDetails.some((detail, index) => detail !== details[index]) };
}

export interface IssueNeedle {
  file: string;
  /** 1-based line inside `file`. */
  line: number;
  why: string;
  text: string;
}

export interface IssueFile {
  name: string;
  text: string;
}

export interface IssueBundle {
  /** `index.txt` first, then `index.json`, then the report pieces. */
  files: readonly IssueFile[];
  needles: readonly IssueNeedle[];
}

const STATE_LINES: readonly { prefix: string; name: string }[] = [
  { prefix: "Loading diagnostics:", name: "loading.txt" },
  { prefix: "Component execution:", name: "component-execution.txt" },
  { prefix: "Compute scheduling:", name: "compute-scheduling.txt" },
  { prefix: "Console diagnostics:", name: "console.txt" },
  { prefix: "Isolation:", name: "isolation.txt" },
  { prefix: "Flight progress:", name: "flight-progress.txt" },
  { prefix: "Aircraft:", name: "aircraft.txt" },
  { prefix: "Flight:", name: "flight.txt" },
  { prefix: "JSBSim:", name: "jsbsim.txt" },
  { prefix: "Renderer:", name: "renderer.txt" },
  { prefix: "GPU:", name: "gpu.txt" },
  { prefix: "Scene:", name: "scene.txt" },
  { prefix: "Build components:", name: "build-components.txt" },
  { prefix: "Render health:", name: "render-health.txt" },
  { prefix: "App files:", name: "app-files.txt" },
  { prefix: "Published:", name: "published.txt" },
];

function sectionOf(line: string): "settings" | "errors" | "visit" | "previous" | null {
  if (
    line === "Settings (all effective values):"
    || line === "Settings not at their defaults:"
    || line === "Settings: all at their defaults."
  ) return "settings";
  if (line.startsWith("Errors nothing handled:")) return "errors";
  if (line === "This visit, oldest first:") return "visit";
  if (line.startsWith("The visit before")) return "previous";
  return null;
}

function sectionRank(section: "environment" | "settings" | "errors" | "visit" | "previous"): number {
  if (section === "settings") return 1;
  if (section === "errors") return 2;
  if (section === "visit") return 3;
  if (section === "previous") return 4;
  return 0;
}

function stateHeading(line: string, generic: boolean): { prefix: string; name: string } | undefined {
  if (line.startsWith("Graphics capability ")) return undefined;
  const known = STATE_LINES.find(state => line.startsWith(state.prefix));
  if (known) return known;
  const heading = generic ? /^([A-Z][A-Za-z0-9 -]*):/.exec(line)?.[1] : undefined;
  return heading ? { prefix: `${heading}:`, name: `${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt` } : undefined;
}

function takeState(lines: readonly string[], index: number, generic: boolean): { name: string; lines: string[]; next: number } | null {
  const line = lines[index] ?? "";
  const state = stateHeading(line, generic);
  if (!state) return null;
  let end = index + 1;
  // State readers can return multiline text or JSON. Only a new top-level
  // heading ends a blob; braces and headings inside JSON strings are data.
  while (end < lines.length) {
    const next = lines[end] ?? "";
    if (sectionOf(next) || stateHeading(next, generic) || next.startsWith("Graphics capability ")) break;
    if (state.name === "renderer.txt" || state.name === "gpu.txt") break;
    end++;
  }
  return { name: state.name, lines: lines.slice(index, end), next: end };
}

function addFile(files: IssueFile[], name: string, body: readonly string[]): void {
  const text = body.join("\n").replace(/\n+$/, "");
  if (!text) return;
  const stem = name.replace(/\.txt$/, "");
  let unique = name;
  for (let n = 2; files.some(file => file.name === unique); n++) unique = `${stem}-${n}.txt`;
  files.push({ name: unique, text });
}

function contentFiles(raw: string): IssueFile[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const reportAt = lines.findIndex(line => / report, /.test(line));
  const files: IssueFile[] = [];
  const failure = reportAt < 0 ? lines : lines.slice(0, reportAt);
  if (failure.some(line => line.trim())) addFile(files, "failure.txt", failure);
  if (reportAt < 0) return files;

  const rest = lines.slice(reportAt);
  const gpuAt = rest.findIndex(line => line.startsWith("GPU:"));
  let mode: "environment" | "settings" | "errors" | "visit" | "previous" = "environment";
  let bucket: string[] = [];
  const states: IssueFile[] = [];
  const flush = () => {
    const name = mode === "environment" ? "environment.txt"
      : mode === "settings" ? "settings.txt"
        : mode === "errors" ? "errors.txt"
          : mode === "visit" ? "visit.txt"
            : "previous-visit.txt";
    addFile(files, name, bucket);
    if (mode === "environment") files.push(...states.splice(0));
    bucket = [];
  };

  for (let index = 0; index < rest.length; index += 1) {
    const line = rest[index] ?? "";
    const section = sectionOf(line);
    if (section && sectionRank(section) > sectionRank(mode)) {
      flush();
      mode = section;
      bucket = [line];
      continue;
    }
    if (mode === "environment") {
      const state = takeState(rest, index, gpuAt >= 0 && index > gpuAt);
      if (state) {
        addFile(states, state.name, state.lines);
        index = state.next - 1;
        continue;
      }
    }
    bucket.push(line);
  }
  flush();
  return files;
}

function buildNeedles(files: readonly IssueFile[]): IssueNeedle[] {
  const failure = files.find(file => file.name === "failure.txt");
  const lines = failure?.text.split("\n") ?? [];
  const needles: IssueNeedle[] = [];
  const explicit = lines.findIndex(line => /\b\w*Error:/.test(line));
  const message = explicit >= 0 ? explicit : lines.findIndex(line => /\bFailed\b|\bis not one of\b|\bCould not\b/i.test(line));
  const errors = files.find(file => file.name === "errors.txt");
  const errorLines = errors?.text.split("\n") ?? [];
  const errorAt = errorLines.findIndex(line => line.trim().length > 0 && !line.startsWith("Errors nothing handled:"));
  const title = lines.findIndex(line => /^Title: \S/.test(line));
  const first = lines.findIndex(line => line.trim().length > 0 && !/^(?:Bug report for |Title:\s*$|What happened:$|Activity report:$)/.test(line));
  const chosen = message >= 0 ? message : errorAt >= 0 ? -1 : title >= 0 ? title : first;
  if (failure && chosen >= 0) {
    needles.push({ file: "failure.txt", line: chosen + 1, why: "the failure", text: lines[chosen] ?? "" });
  } else if (errors && errorAt >= 0) {
    needles.push({ file: errors.name, line: errorAt + 1, why: "the failure", text: errorLines[errorAt] ?? "" });
  }
  const stack = lines.findIndex(line => /^\s+at \S/.test(line));
  if (failure && stack >= 0) {
    needles.push({ file: "failure.txt", line: stack + 1, why: "first stack frame", text: lines[stack] ?? "" });
  }
  const quoted = /"([^"\n]{1,80})"/.exec(lines[chosen] ?? "");
  if (quoted) {
    const token = quoted[1] ?? "";
    const settings = files.find(file => file.name === "settings.txt");
    const hit = settings?.text.split("\n").findIndex(line => line.includes(token)) ?? -1;
    if (settings && hit >= 0) {
      needles.push({
        file: "settings.txt",
        line: hit + 1,
        why: `line containing ${token}`,
        text: settings.text.split("\n")[hit] ?? "",
      });
    }
  }
  if (!needles.length) {
    const previous = files.find(file => file.name === "previous-visit.txt");
    const previousLines = previous?.text.split("\n") ?? [];
    const stopped = previousLines.findIndex(line => line.includes("stopped without being closed"));
    if (previous && stopped >= 0) needles.push({ file: previous.name, line: stopped + 1, why: "the previous visit stopped unexpectedly", text: previousLines[stopped]! });
  }
  return needles;
}

/** Extend the existing report string with a portable file index, without making another report. */
export function splitIssueReport(raw: string): IssueBundle {
  const content = contentFiles(raw);
  const needles = buildNeedles(content);
  const listed = [
    { name: "index.txt", lines: 0 }, { name: "index.json", lines: 0 },
    ...content.map(file => ({ name: file.name, lines: file.text.split("\n").length })),
  ];
  const dynamicImport = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed dynamic import/i.test(raw);
  const instruction = "Read index.txt and stop. It names and quotes the failure. Open another file only at a needle or search hit; never read a long file from the top.";
  const makeIndex = () => [
    instruction,
    "index.json contains the same facts as plain text JSON.",
    "",
    ...(needles.length ? needles.map(needle => `${needle.why}: ${needle.file}:${needle.line}\n> ${needle.text}`) : ["the failure: no failure recorded in this report."]),
    ...(dynamicImport ? ["", "A dev-server log is not inside this report. For this failed dynamic import, consult the dev-server terminal separately."] : []),
    "",
    "Files:",
    ...listed.map(file => `- ${file.name}  ${file.lines} ${file.lines === 1 ? "line" : "lines"}  ${file.lines > 24 ? "search or open one line" : "short"}`),
  ].join("\n");
  const makeJson = () => JSON.stringify({
    instruction,
    failure: needles[0] ?? null,
    needles,
    files: listed,
  }, null, 2);
  // Line counts include both indexes. The number of lines is independent of
  // the count's digits, so a second rendering contains the final counts.
  listed[0]!.lines = makeIndex().split("\n").length;
  listed[1]!.lines = makeJson().split("\n").length;
  return {
    needles,
    files: [
      { name: "index.txt", text: makeIndex() },
      { name: "index.json", text: makeJson() },
      ...content,
    ],
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** STORE-method zip of the report files. Text is already small, so method 0 keeps each file readable. */
export function issueReportZip(bundle: IssueBundle): Uint8Array {
  const encoder = new TextEncoder();
  const entries = bundle.files.map(file => {
    const name = encoder.encode(file.name);
    const bytes = encoder.encode(file.text);
    return { name, bytes, crc: crc32(bytes) };
  });
  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.bytes.length, 0);
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;
  const locals: number[] = [];
  for (const entry of entries) {
    locals.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 12, 0x0021, true); // 1980-01-01, the ZIP epoch
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.bytes.length, true);
    view.setUint32(offset + 22, entry.bytes.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    out.set(entry.name, offset + 30);
    out.set(entry.bytes, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.bytes.length;
  }
  const centralStart = offset;
  entries.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 14, 0x0021, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.bytes.length, true);
    view.setUint32(offset + 24, entry.bytes.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint32(offset + 42, locals[index] ?? 0, true);
    out.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  return out;
}
