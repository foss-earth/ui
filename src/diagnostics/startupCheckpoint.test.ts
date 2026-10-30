import { describe, expect, it } from "vitest";
import { createStartupCheckpointStore, readStartupCheckpoints, STARTUP_CHECKPOINT_BYTES } from "./startupCheckpoint.js";
function environment() {
  const data = new Map<string, string>();
  let time = 100;
  return { data, storage: { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }, now: () => ++time };
}
describe("startup checkpoints", () => {
  it("recovers the last synchronous checkpoint without a failure or unload handler and keeps two attempts", () => {
    const env = environment();
    const first = createStartupCheckpointStore(env, "/fly/");
    first.section("loading.txt", "renderer and physics running"); first.save();
    expect(readStartupCheckpoints(env, "/fly/")[0]?.sections["loading.txt"]).toContain("physics running");
    const second = createStartupCheckpointStore(env, "/fly/"); second.section("loading.txt", "next attempt"); second.save("ready");
    expect(readStartupCheckpoints(env, "/fly/").map(record => record.outcome)).toEqual(["ready", "loading"]);
    const before = [...env.data];
    readStartupCheckpoints(env, "/fly/"); readStartupCheckpoints(env, "/fly/");
    expect([...env.data]).toEqual(before);
    createStartupCheckpointStore(env, "/fly/").save();
    expect(readStartupCheckpoints(env, "/fly/")).toHaveLength(2);
    expect(readStartupCheckpoints(env, "/other/")).toEqual([]);
  });
  it("bounds storage including Unicode and reports every shortened section", () => {
    const env = environment(); const store = createStartupCheckpointStore(env, "/fly/");
    for (let index = 0; index < 8; index++) store.section(`large-${index}.txt`, "🛩️".repeat(100_000));
    store.save("failed");
    expect([...env.data.values()].every(raw => raw.length * 2 <= STARTUP_CHECKPOINT_BYTES)).toBe(true);
    expect(readStartupCheckpoints(env, "/fly/")[0]?.omissions).toHaveLength(8);
  });
  it("survives unavailable, full, and corrupt storage, and clears retained evidence when disabled", () => {
    const env = environment(); const store = createStartupCheckpointStore(env, "/fly/");
    store.save(); store.disable(); store.save(); expect(env.data.size).toBe(0);
    const unavailable = createStartupCheckpointStore({ now: () => 1, storage: null }, "/fly/");
    expect(() => unavailable.save()).not.toThrow(); expect(unavailable.status()).toContain("failed");
    env.storage.setItem = () => { throw new Error("Quota"); };
    const full = createStartupCheckpointStore(env, "/fly/"); full.save(); expect(full.status()).toContain("full");
    env.data.set("foss-earth.startup.v1 /fly/ current", "{broken");
    expect(readStartupCheckpoints(env, "/fly/")).toEqual([]);
  });
});
