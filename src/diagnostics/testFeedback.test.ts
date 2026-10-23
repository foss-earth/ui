import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestFeedbackSession, createTestLink, readTestPlan, validateTestPlan, type TestPlan } from "./testFeedback.js";

const plan: TestPlan = { version: 1, id: "camera", title: "Camera 🧭", steps: [{ id: "drag", text: "Drag the globe" }, { id: "release", text: "Let go" }], sources: ["camera"] };
const now = (): Date => new Date("2026-10-21T20:00:00Z");
afterEach(() => vi.useRealTimers());

describe("custom test links and capture", () => {
  it("round trips Unicode without losing host settings and rejects executable/malformed plans", () => {
    const link = createTestLink("https://example.org/tour/?scene=mall", plan);
    expect(new URL(link).searchParams.get("scene")).toBe("mall");
    expect(readTestPlan(link)).toEqual(plan);
    expect(readTestPlan("https://example.org/#camera")).toBeNull();
    expect(() => createTestLink("javascript:alert(1)", plan)).toThrow();
    expect(() => createTestLink("https://example.org/#camera", plan)).toThrow();
    expect(() => readTestPlan("https://example.org/#test=%zz")).toThrow();
    expect(() => validateTestPlan({ ...plan, intervalMs: 1 })).toThrow();
    expect(() => validateTestPlan({ ...plan, sources: ["camera", "camera"] })).toThrow();
    expect(() => validateTestPlan({ ...plan, version: 2 })).toThrow();
  });

  it("keeps feedback, real outcomes and selected debug data in one redacted bundle", async () => {
    const ignored = vi.fn();
    const session = createTestFeedbackSession({ plan, page: "https://example.org/?key=private-secret", now,
      secrets: () => ["private-secret"], providers: { camera: () => ({ heading: 20, token: "opaque", key: "unlisted-private", nested: { latitude: 45, latDeg: 44.12345, lonDeg: -93.12345 }, detail: "private-secret" }), ignored } });
    session.record("camera", { beforeStart: true });
    session.start();
    await session.capture("wait");
    session.setStep("drag", "fail", "It jumps. private-secret");
    session.note("Happened just after release");
    session.record("camera", { heading: 24, velocity: 1 });
    session.record("ignored", { unwanted: true });
    const report = await session.finish();
    expect(ignored).not.toHaveBeenCalled();
    expect(report.schema).toBe("foss-earth-test-feedback");
    expect(report.steps[0]).toMatchObject({ outcome: "fail", notes: "It jumps. [redacted]" });
    expect(report.steps[1]).toMatchObject({ outcome: "untested", at: null });
    expect(report.notes[0].text).toContain("after release");
    expect(report.samples.some(s => s.reason === "event" && s.value && typeof s.value === "object" && "velocity" in s.value)).toBe(true);
    expect(report.samples.some(s => s.reason === "finish")).toBe(true);
    const json = JSON.stringify(report);
    expect(json).not.toContain("private-secret");
    expect(json).not.toContain("opaque");
    expect(json).not.toContain("unlisted-private");
    expect(json).not.toContain("beforeStart");
    expect(json).not.toContain('"latitude":45');
    expect(json).not.toContain("44.12345");
    expect(json).not.toContain("-93.12345");
    expect(session.running).toBe(false);
    session.dispose();
  });

  it("records missing, failed, circular and timed-out providers and retains bounded newest data", async () => {
    vi.useFakeTimers();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const session = createTestFeedbackSession({ plan: { ...plan, sources: ["missing", "failed", "cycle", "slow"] }, now, page: "https://example.org/",
      maxSamples: 5, providerTimeoutMs: 20, providers: { failed() { throw new Error("broken"); }, cycle: () => cycle, slow: () => new Promise(() => {}) } });
    session.start();
    await vi.advanceTimersByTimeAsync(21);
    const finishing = session.finish();
    await vi.advanceTimersByTimeAsync(21);
    const report = await finishing;
    expect(report.samples).toHaveLength(5);
    expect(report.limits.droppedSamples).toBe(3);
    expect(report.samples.find(s => s.source === "missing")?.error).toContain("unavailable");
    expect(report.samples.find(s => s.source === "failed")?.error).toBe("broken");
    expect(report.samples.find(s => s.source === "slow")?.error).toBe("Provider timed out");
    expect(JSON.stringify(report)).toContain("[circular]");
    session.dispose();
  });

  it("runs requested sampling only during the test and stops on dispose", async () => {
    vi.useFakeTimers();
    const camera = vi.fn(() => ({ heading: 1 }));
    const session = createTestFeedbackSession({ plan: { ...plan, intervalMs: 250 }, providers: { camera }, page: "https://example.org/", now });
    await vi.advanceTimersByTimeAsync(1000);
    expect(camera).not.toHaveBeenCalled();
    session.start();
    await vi.advanceTimersByTimeAsync(501);
    expect(camera).toHaveBeenCalledTimes(3);
    session.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(camera).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps full normal diagnostic reports and bounds aggregate capture size", async () => {
    const diagnostic = "Report line\n".repeat(5000) + "END_OF_DIAGNOSTICS";
    const session = createTestFeedbackSession({ plan, providers: { camera: () => diagnostic }, page: "https://example.org/", now,
      maxCharacters: 1_000_000 });
    await session.capture("full-report");
    for (let i = 0; i < 25; i++) await session.capture("more");
    const report = await session.finish();
    expect(report.samples.every(s => typeof s.value === "string" && s.value.endsWith("END_OF_DIAGNOSTICS"))).toBe(true);
    expect(report.limits.shortenedValues).toBe(0);
    expect(report.limits.droppedSamples).toBeGreaterThan(0);
    expect(JSON.stringify(report.samples).length).toBeLessThan(1_000_100);
    session.dispose();
  });
});
