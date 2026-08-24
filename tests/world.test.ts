import { describe, expect, it } from "vitest";
import { nextU32 } from "../src/rng.js";
import {
  advanceClock,
  createSimWorld,
  destroySimWorld,
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
    destroySimWorld(h);
  });

  it("advanceClock increments tickIndex and accumulates simSeconds", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    advanceClock(h, 1 / 60);
    advanceClock(h, 1 / 60);
    advanceClock(h, 1 / 60);
    expect(h.clock.tickIndex).toBe(3);
    expect(h.clock.simSeconds).toBeCloseTo(3 / 60, 6);
    destroySimWorld(h);
  });

  it("koota world supports spawn / has / remove of trait-tagged entities", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    const Tag = trait({ value: 0 });
    const e = h.world.spawn(Tag({ value: 42 }));
    expect(e.has(Tag)).toBe(true);
    expect(e.get(Tag)?.value).toBe(42);
    e.remove(Tag);
    expect(e.has(Tag)).toBe(false);
    destroySimWorld(h);
  });

  it("runs multi-trait queries through Koota 0.6.x updateEach", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    const Position = trait({ x: 0, y: 0 });
    const Velocity = trait({ x: 0, y: 0 });
    const moving = h.world.spawn(Position({ x: 2, y: 4 }), Velocity({ x: 3, y: -1 }));
    const stationary = h.world.spawn(Position({ x: 9, y: 9 }));

    h.world.query(Position, Velocity).updateEach(([position, velocity]) => {
      position.x += velocity.x;
      position.y += velocity.y;
    });

    expect(moving.get(Position)).toEqual({ x: 5, y: 3 });
    expect(stationary.get(Position)).toEqual({ x: 9, y: 9 });
    destroySimWorld(h);
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
    destroySimWorld(h);
  });

  it("stores the seeds immutably on the handle for per-entity derivation", () => {
    const seeds = { gen: "world-A", events: "play-0" };
    const h = createSimWorld(seeds);
    expect(h.seeds).not.toBe(seeds);
    expect(Object.isFrozen(h.seeds)).toBe(true);
    seeds.gen = "mutated-outside";
    // Consuming rng streams must not alter the stored seeds.
    nextU32(h.rng.gen);
    nextU32(h.rng.events);
    expect(h.seeds).toEqual({ gen: "world-A", events: "play-0" });
    destroySimWorld(h);
  });

  it("scratch map is per-world, empty at creation", () => {
    const a = createSimWorld({ gen: "g", events: "e" });
    const b = createSimWorld({ gen: "g", events: "e" });
    expect(a.scratch.size).toBe(0);
    a.scratch.set("noise:1", 123);
    expect(b.scratch.has("noise:1")).toBe(false);
    destroySimWorld(a);
    destroySimWorld(b);
  });

  it("rejects invalid seeds before allocating a Koota world", () => {
    expect(() => createSimWorld(undefined as never)).toThrow(/seeds must be an object/);
  });

  it("destroySimWorld clears scratch, releases the world, and is idempotent", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    h.scratch.set("cache", { expensive: true });
    destroySimWorld(h);
    expect(h.scratch.size).toBe(0);
    expect(h.world.isInitialized).toBe(false);
    expect(() => destroySimWorld(h)).not.toThrow();
  });

  it("advanceClock validates input and leaves the clock unchanged on failure", () => {
    const invalidDts = [Number.NaN, Number.POSITIVE_INFINITY, -0.001];
    for (const dt of invalidDts) {
      const h = createSimWorld({ gen: "g", events: "e" });
      expect(() => advanceClock(h, dt)).toThrow(/dt must be/);
      expect(h.clock).toEqual({ tickIndex: 0, simSeconds: 0 });
      destroySimWorld(h);
    }

    const corruptions = [
      { tickIndex: -1, simSeconds: 0 },
      { tickIndex: 0.5, simSeconds: 0 },
      { tickIndex: 0, simSeconds: -1 },
      { tickIndex: 0, simSeconds: Number.POSITIVE_INFINITY },
      { tickIndex: Number.MAX_SAFE_INTEGER, simSeconds: 0 },
      { tickIndex: 0, simSeconds: Number.MAX_VALUE },
    ];
    for (const clock of corruptions) {
      const h = createSimWorld({ gen: "g", events: "e" });
      h.clock = clock;
      expect(() => advanceClock(h, Number.MAX_VALUE)).toThrow(/clock|numeric range/);
      expect(h.clock).toEqual(clock);
      destroySimWorld(h);
    }
  });

  it("restoreWorldHeader rejects malformed saves atomically", () => {
    const h = createSimWorld({ gen: "g", events: "e" });
    advanceClock(h, 0.25);
    const before = snapshotWorld(h);
    const invalidClocks = [
      undefined,
      { tickIndex: -1, simSeconds: 0 },
      { tickIndex: 0.5, simSeconds: 0 },
      { tickIndex: 0, simSeconds: -1 },
      { tickIndex: 0, simSeconds: Number.NaN },
    ];
    for (const clock of invalidClocks) {
      expect(() => restoreWorldHeader(h, { ...before, clock } as never)).toThrow(/snapshot.clock/);
      expect(snapshotWorld(h)).toEqual(before);
    }
    expect(() => restoreWorldHeader(h, { ...before, rng: {} } as never)).toThrow(/ARC4 state/);
    expect(snapshotWorld(h)).toEqual(before);
    destroySimWorld(h);
  });
});
