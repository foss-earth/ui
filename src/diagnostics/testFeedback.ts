import { redactIssueReport } from "./issueReport.js";

export const TEST_FEEDBACK_SCHEMA = "foss-earth-test-feedback";
export interface TestPlan {
  version: 1;
  id: string;
  title: string;
  instructions?: string;
  steps: { id: string; text: string }[];
  /** Names of host-registered providers; links cannot execute code. */
  sources: string[];
  /** Optional bounded sampling, only between Start and Finish. */
  intervalMs?: number;
}
export type TestOutcome = "untested" | "pass" | "fail" | "skip";
export type TestJson = null | boolean | number | string | TestJson[] | { [key: string]: TestJson };
export type TestProvider = () => unknown | Promise<unknown>;
export interface TestSample { at: string; reason: string; source: string; value?: TestJson; error?: string }
export interface TestFeedbackBundle {
  schema: typeof TEST_FEEDBACK_SCHEMA;
  version: 1;
  plan: TestPlan;
  startedAt: string | null;
  finishedAt: string;
  page: string;
  steps: { id: string; outcome: TestOutcome; notes: string; at: string | null }[];
  notes: { at: string; text: string }[];
  samples: TestSample[];
  limits: { maxSamples: number; maxCharacters: number; droppedSamples: number; shortenedValues: number; coalescedCaptures: number; droppedNotes: number };
}

const MAX_PLAN = 16_000;
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid test ${label}`);
  return value;
}
/** Validate untrusted link data and return a fresh, plain plan. */
export function validateTestPlan(input: unknown): TestPlan {
  if (!input || typeof input !== "object") throw new Error("Invalid test plan");
  const p = input as Record<string, unknown>;
  if (p.version !== 1 || !Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > 30
    || !Array.isArray(p.sources) || p.sources.length > 16) throw new Error("Invalid test plan version, steps or sources");
  const identifier = (value: unknown): string => {
    const id = text(value, 100, "identifier");
    if (!/^[a-z\d][a-z\d._-]*$/i.test(id)) throw new Error("Invalid test identifier");
    return id;
  };
  const steps = p.steps.map(s => {
    if (!s || typeof s !== "object") throw new Error("Invalid test step");
    return { id: identifier(s.id), text: text(s.text, 1000, "step text") };
  });
  const sources = p.sources.map(identifier);
  if (new Set(steps.map(s => s.id)).size !== steps.length || new Set(sources).size !== sources.length) throw new Error("Duplicate test step or source");
  const plan: TestPlan = { version: 1, id: identifier(p.id), title: text(p.title, 200, "title"), steps, sources };
  if (p.instructions !== undefined) plan.instructions = text(p.instructions, 3000, "instructions");
  if (p.intervalMs !== undefined) {
    if (!Number.isInteger(p.intervalMs) || (p.intervalMs as number) < 250 || (p.intervalMs as number) > 60_000) throw new Error("Test interval must be 250–60000 ms");
    plan.intervalMs = p.intervalMs as number;
  }
  if (JSON.stringify(plan).length > MAX_PLAN) throw new Error("Test plan is too large");
  return plan;
}

/** A fragment keeps the checklist out of HTTP requests and server logs. */
export function createTestLink(href: string, input: TestPlan): string {
  const url = new URL(href);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Test links require HTTP or HTTPS");
  if (url.hash && !url.hash.startsWith("#test=")) throw new Error("Use a page address without a fragment for this test link");
  url.hash = `test=${encodeURIComponent(JSON.stringify(validateTestPlan(input)))}`;
  return url.href;
}
export function readTestPlan(href: string): TestPlan | null {
  const hash = new URL(href).hash;
  if (!hash.startsWith("#test=")) return null;
  if (hash.length > MAX_PLAN * 9) throw new Error("Test link is too large");
  return validateTestPlan(JSON.parse(decodeURIComponent(hash.slice(6))));
}

export interface TestFeedbackOptions {
  plan: TestPlan;
  page: string;
  providers: Readonly<Record<string, TestProvider>>;
  now(): Date;
  secrets?(): readonly string[];
  maxSamples?: number;
  maxCharacters?: number;
  providerTimeoutMs?: number;
}
export interface TestFeedbackSession {
  readonly plan: TestPlan;
  readonly running: boolean;
  start(): void;
  setStep(id: string, outcome: TestOutcome, notes?: string): void;
  note(text: string): void;
  /** Push task-specific events only for a selected source. */
  record(source: string, value: unknown): void;
  capture(reason: string): Promise<void>;
  finish(): Promise<TestFeedbackBundle>;
  dispose(): void;
}

/** Bounded, opt-in observation; no browser globals or automatic capture on import. */
export function createTestFeedbackSession(options: TestFeedbackOptions): TestFeedbackSession {
  const plan = validateTestPlan(options.plan);
  const maxSamples = options.maxSamples ?? 1000;
  const maxCharacters = options.maxCharacters ?? 8_000_000;
  const timeout = options.providerTimeoutMs ?? 1500;
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 5000 || !Number.isInteger(maxCharacters) || maxCharacters < 1_000_000 || maxCharacters > 32_000_000
    || !Number.isFinite(timeout) || timeout < 1 || timeout > 10_000) throw new Error("Invalid test capture limits");
  const steps = plan.steps.map(s => ({ id: s.id, outcome: "untested" as TestOutcome, notes: "", at: null as string | null }));
  const notes: TestFeedbackBundle["notes"] = [];
  const samples: TestSample[] = [];
  const sampleSizes: number[] = [];
  let sampleCharacters = 0;
  let running = false, disposed = false, finished = false, startedAt: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let droppedSamples = 0, shortenedValues = 0, coalescedCaptures = 0, droppedNotes = 0;
  let pending: Promise<void> | null = null;
  const clean = (value: string): string => redactIssueReport(value, options.secrets?.());
  const at = (): string => options.now().toISOString();
  const boundedText = (value: string, max = 20_000): string => {
    if (value.length > max) { shortenedValues++; return clean(value.slice(0, max)) + " [shortened]"; }
    return clean(value);
  };
  const safe = (value: unknown): TestJson => {
    const seen = new WeakSet<object>();
    let budget = 2000;
    let characters = 512_000;
    const visit = (v: unknown, depth: number): TestJson => {
      if (--budget < 0 || depth > 8 || characters <= 0) { shortenedValues++; return "[capture limit]"; }
      if (v === null || typeof v === "boolean") return v;
      if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
      if (typeof v === "string") { const result = boundedText(v, Math.min(256_000, characters)); characters -= result.length; return result; }
      if (typeof v !== "object") return boundedText(String(v));
      if (seen.has(v)) return "[circular]";
      seen.add(v);
      if (v instanceof Error) return boundedText(v.stack ?? v.message);
      if (Array.isArray(v)) {
        if (v.length > 200) shortenedValues++;
        return v.slice(0, 200).map(item => visit(item, depth + 1));
      }
      const entries = Object.entries(v);
      if (entries.length > 200) shortenedValues++;
      return Object.fromEntries(entries.slice(0, 200).map(([key, item]) => [boundedText(key, 200),
        /(?:key|secret|password|passwd|token|authorization|cookies?|credentials?|pairingCode|pin)$|latitude|longitude|(?:^|[._-])(?:latDeg|lonDeg|lat_deg|lon_deg|lat|lon)$/i.test(key)
          ? "[redacted]" : visit(item, depth + 1)]));
    };
    return visit(value, 0);
  };
  const add = (sample: TestSample): void => {
    if (disposed) return;
    samples.push(sample);
    const size = JSON.stringify(sample).length;
    sampleSizes.push(size); sampleCharacters += size;
    while (samples.length > maxSamples || sampleCharacters > maxCharacters) {
      samples.shift(); sampleCharacters -= sampleSizes.shift()!; droppedSamples++;
    }
  };
  const capture = async (reason: string): Promise<void> => {
    if (disposed || finished) return;
    // Coalesce overlapping requests rather than creating an unbounded queue.
    if (pending) { coalescedCaptures++; return pending; }
    const round = Promise.all(plan.sources.map(async source => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!Object.hasOwn(options.providers, source)) throw new Error("Provider unavailable in this build");
        const value = await Promise.race([
          Promise.resolve().then(() => options.providers[source]()),
          new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Provider timed out")), timeout); }),
        ]);
        add({ at: at(), reason: boundedText(reason, 200), source, value: safe(value) });
      } catch (error) {
        add({ at: at(), reason: boundedText(reason, 200), source, error: boundedText(error instanceof Error ? error.message : String(error)) });
      } finally { clearTimeout(deadline); }
    })).then(() => {});
    pending = round;
    await round;
    if (pending === round) pending = null;
  };
  const stop = (): void => { running = false; clearInterval(timer); timer = undefined; };
  return {
    get plan() { return validateTestPlan(plan); },
    get running() { return running; },
    start() {
      if (running || disposed || finished || startedAt) return;
      running = true; startedAt = at();
      void capture("start");
      if (plan.intervalMs) timer = setInterval(() => { if (!pending) void capture("sample"); }, plan.intervalMs);
    },
    setStep(id, outcome, message = "") {
      if (disposed || finished) return;
      const step = steps.find(s => s.id === id);
      if (!step || !["untested", "pass", "fail", "skip"].includes(outcome)) throw new Error("Unknown test step or outcome");
      const nextNotes = boundedText(message);
      if (step.outcome === outcome && step.notes === nextNotes) return;
      Object.assign(step, { outcome, notes: nextNotes, at: at() });
      if (running) void capture(`step:${id}:${outcome}`);
    },
    note(message) {
      if (disposed || finished || !message.trim()) return;
      if (notes.length >= 200) { notes.shift(); droppedNotes++; }
      notes.push({ at: at(), text: boundedText(message) });
      if (running) void capture("note");
    },
    record(source, value) { if (running && !disposed && plan.sources.includes(source)) add({ at: at(), reason: "event", source, value: safe(value) }); },
    capture,
    async finish() {
      if (disposed) throw new Error("Test session disposed");
      stop();
      if (pending) await pending;
      await capture("finish");
      finished = true;
      const cleanPlan = { ...plan, title: clean(plan.title), ...(plan.instructions ? { instructions: clean(plan.instructions) } : {}),
        steps: plan.steps.map(step => ({ ...step, text: clean(step.text) })) };
      return structuredClone({ schema: TEST_FEEDBACK_SCHEMA, version: 1 as const, plan: cleanPlan, startedAt, finishedAt: at(),
        page: clean(options.page), steps, notes, samples,
        limits: { maxSamples, maxCharacters, droppedSamples, shortenedValues, coalescedCaptures, droppedNotes } });
    },
    dispose() { disposed = true; stop(); },
  };
}
