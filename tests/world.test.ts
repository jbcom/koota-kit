import { describe, expect, it } from "vitest";
import { nextU32 } from "../src/rng.js";
import {
  advanceClock,
  createSimWorld,
  restoreWorldHeader,
  snapshotWorld,
  trait,
} from "../src/world.js";

describe("world bootstrap", () => {
  it("createSimWorld returns a koota world + dual-layer rng + clock", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    expect(h.world).toBeDefined();
    expect(h.rng.gen.prng).toBeDefined();
    expect(h.rng.events.prng).toBeDefined();
    expect(h.clock).toEqual({ tickIndex: 0, simSeconds: 0 });
  });

  it("advanceClock increments tickIndex and accumulates simSeconds", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    advanceClock(h, 1 / 60);
    advanceClock(h, 1 / 60);
    advanceClock(h, 1 / 60);
    expect(h.clock.tickIndex).toBe(3);
    expect(h.clock.simSeconds).toBeCloseTo(3 / 60, 6);
  });

  it("koota world supports spawn / has / remove of trait-tagged entities", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    const Tag = trait({ value: 0 });
    const e = h.world.spawn(Tag({ value: 42 }));
    expect(e.has(Tag)).toBe(true);
    expect(e.get(Tag)?.value).toBe(42);
    e.remove(Tag);
    expect(e.has(Tag)).toBe(false);
  });

  it("snapshot + restoreWorldHeader replays both RNG layers byte-exact", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    nextU32(h.rng.gen);
    nextU32(h.rng.events);
    nextU32(h.rng.events);
    advanceClock(h, 0.5);
    const snap = snapshotWorld(h);
    const futureGen = [nextU32(h.rng.gen), nextU32(h.rng.gen)];
    const futureEv = [nextU32(h.rng.events), nextU32(h.rng.events)];
    restoreWorldHeader(h, snap);
    expect([nextU32(h.rng.gen), nextU32(h.rng.gen)]).toEqual(futureGen);
    expect([nextU32(h.rng.events), nextU32(h.rng.events)]).toEqual(futureEv);
    expect(h.clock.simSeconds).toBeCloseTo(0.5, 6);
  });

  it("stores the seeds immutably on the handle for per-entity derivation", () => {
    const seeds = { gen: "world-A", events: "play-0" };
    const h = createSimWorld(seeds);
    expect(h.seeds).toBe(seeds);
    // Consuming rng streams must not alter the stored seeds.
    nextU32(h.rng.gen);
    nextU32(h.rng.events);
    expect(h.seeds).toEqual({ gen: "world-A", events: "play-0" });
  });

  it("scratch map is per-world, empty at creation", () => {
    const a = createSimWorld({ gen: "g", events: "e" });
    const b = createSimWorld({ gen: "g", events: "e" });
    expect(a.scratch.size).toBe(0);
    a.scratch.set("noise:1", 123);
    expect(b.scratch.has("noise:1")).toBe(false);
  });
});
