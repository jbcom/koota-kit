import { describe, expect, it } from "vitest";
import {
  chance,
  createRng,
  nextFloat,
  nextInt,
  nextU32,
  restoreLayers,
  restoreStream,
  snapshotLayers,
  snapshotStream,
} from "../src/rng.js";

describe("dual-layer seedrandom PRNG", () => {
  it("rejects malformed or non-finite seeds with actionable errors", () => {
    expect(() => createRng(null as never)).toThrow(/seeds must be an object/);
    expect(() => createRng({ gen: {} as never, events: "e" })).toThrow(/seeds.gen/);
    expect(() => createRng({ gen: Number.NaN, events: "e" })).toThrow(/seeds.gen.*finite/);
    expect(() => createRng({ gen: "g", events: Number.POSITIVE_INFINITY })).toThrow(
      /seeds.events.*finite/,
    );
  });

  it("produces a deterministic sequence per stream for fixed seeds", () => {
    const a = createRng({ gen: "world-A", events: "play-0" });
    const b = createRng({ gen: "world-A", events: "play-0" });
    const genA = Array.from({ length: 6 }, () => nextU32(a.gen));
    const genB = Array.from({ length: 6 }, () => nextU32(b.gen));
    const evA = Array.from({ length: 6 }, () => nextU32(a.events));
    const evB = Array.from({ length: 6 }, () => nextU32(b.events));
    expect(genA).toEqual(genB);
    expect(evA).toEqual(evB);
  });

  it("gen and events streams are independent", () => {
    // Advancing one stream must not change the other's output.
    const r = createRng({ gen: "world-A", events: "play-0" });
    for (let i = 0; i < 50; i++) nextU32(r.events);
    const genHead = nextU32(r.gen);

    const fresh = createRng({ gen: "world-A", events: "play-0" });
    const genHeadFresh = nextU32(fresh.gen);
    expect(genHead).toBe(genHeadFresh);
  });

  it("different events seeds yield different play sequences but same worldgen", () => {
    const a = createRng({ gen: "world-A", events: "play-0" });
    const b = createRng({ gen: "world-A", events: "play-1" });
    const genA = nextU32(a.gen);
    const genB = nextU32(b.gen);
    const evA = nextU32(a.events);
    const evB = nextU32(b.events);
    expect(genA).toBe(genB); // same worldgen — "same map, fresh playthrough" invariant
    expect(evA).not.toBe(evB); // different playthrough
  });

  it("nextFloat stays in [0, 1)", () => {
    const r = createRng({ gen: 7, events: 7 });
    for (let i = 0; i < 1000; i++) {
      const v = nextFloat(r.events);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt respects bounds [min, max)", () => {
    const r = createRng({ gen: 99, events: 99 });
    for (let i = 0; i < 1000; i++) {
      const v = nextInt(r.events, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it("nextInt rejects unsafe, empty, reversed, and oversized ranges without drawing", () => {
    const r = createRng({ gen: 99, events: 99 });
    const before = snapshotStream(r.events);
    expect(() => nextInt(r.events, 0.5, 2)).toThrow(/safe integers/);
    expect(() => nextInt(r.events, 0, 2.5)).toThrow(/safe integers/);
    expect(() => nextInt(r.events, 2, 2)).toThrow(/must be greater/);
    expect(() => nextInt(r.events, 2, 1)).toThrow(/must be greater/);
    expect(() => nextInt(r.events, 0, 2 ** 32 + 1)).toThrow(/cannot exceed/);
    expect(snapshotStream(r.events)).toEqual(before);
  });

  it("chance(p) converges to p over many draws", () => {
    const r = createRng({ gen: "g", events: "e" });
    let hits = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) if (chance(r.events, 0.25)) hits++;
    expect(hits / N).toBeCloseTo(0.25, 1);
  });

  it("chance rejects values outside [0, 1] without drawing", () => {
    const r = createRng({ gen: "g", events: "e" });
    const before = snapshotStream(r.events);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      expect(() => chance(r.events, invalid)).toThrow(/probability/);
    }
    expect(snapshotStream(r.events)).toEqual(before);
  });

  it("chance consumes one draw even for the boundary probabilities", () => {
    const zero = createRng({ gen: "g", events: "e" }).events;
    const one = restoreStream(snapshotStream(zero));
    expect(chance(zero, 0)).toBe(false);
    expect(chance(one, 1)).toBe(true);
    expect(snapshotStream(zero)).toEqual(snapshotStream(one));
  });

  it("snapshot + restore stream yields byte-exact replay", () => {
    const r = createRng({ gen: "g", events: "e" });
    for (let i = 0; i < 17; i++) nextU32(r.events);
    const snap = snapshotStream(r.events);
    const after = [nextU32(r.events), nextU32(r.events), nextU32(r.events)];
    const restored = restoreStream(snap);
    const replayed = [nextU32(restored), nextU32(restored), nextU32(restored)];
    expect(replayed).toEqual(after);
  });

  it("snapshot + restore layers preserves both streams independently", () => {
    const r = createRng({ gen: "g", events: "e" });
    nextU32(r.gen);
    nextU32(r.events);
    nextU32(r.events);
    const snap = snapshotLayers(r);
    const futureGen = [nextU32(r.gen), nextU32(r.gen)];
    const futureEv = [nextU32(r.events), nextU32(r.events)];
    const restored = restoreLayers(snap);
    expect([nextU32(restored.gen), nextU32(restored.gen)]).toEqual(futureGen);
    expect([nextU32(restored.events), nextU32(restored.events)]).toEqual(futureEv);
  });

  it("worldgen replay invariance: snapshotting gen at t=0 always replays the same world", () => {
    // The "same map, fresh playthrough" contract: same gen seed → same world
    // layout, regardless of how many events have fired since.
    const r = createRng({ gen: "seed-42", events: "play-X" });
    const snap = snapshotStream(r.gen);
    const worldRoll = [nextU32(r.gen), nextU32(r.gen), nextU32(r.gen)];
    // Advance events arbitrarily (simulating play).
    for (let i = 0; i < 1000; i++) nextU32(r.events);
    // Restore gen — events stream untouched.
    const replayGen = restoreStream(snap);
    expect([nextU32(replayGen), nextU32(replayGen), nextU32(replayGen)]).toEqual(worldRoll);
  });

  it("snapshots survive JSON round-tripping (persistable in saves)", () => {
    const r = createRng({ gen: "g", events: "e" });
    for (let i = 0; i < 5; i++) nextU32(r.events);
    const snap = JSON.parse(JSON.stringify(snapshotLayers(r)));
    const after = [nextU32(r.events), nextU32(r.events)];
    const restored = restoreLayers(snap);
    expect([nextU32(restored.events), nextU32(restored.events)]).toEqual(after);
  });

  it("the same snapshot can seed multiple independent replays", () => {
    const stream = createRng({ gen: "g", events: "e" }).events;
    const snap = snapshotStream(stream);
    const a = restoreStream(snap);
    const b = restoreStream(snap);
    expect(Array.from({ length: 8 }, () => nextU32(a))).toEqual(
      Array.from({ length: 8 }, () => nextU32(b)),
    );
    expect(snap).toEqual(snapshotStream(stream));
  });

  it("rejects malformed persisted ARC4 snapshots", () => {
    const valid = snapshotStream(createRng({ gen: "g", events: "e" }).events);
    const malformed: unknown[] = [
      null,
      {},
      { state: { ...valid.state, i: 0.5 } },
      { state: { ...valid.state, i: -1 } },
      { state: { ...valid.state, i: 256 } },
      { state: { ...valid.state, j: 0.5 } },
      { state: { ...valid.state, j: -1 } },
      { state: { ...valid.state, j: 256 } },
      { state: { ...valid.state, S: "not-an-array" } },
      { state: { ...valid.state, S: valid.state.S.slice(1) } },
      { state: { ...valid.state, S: valid.state.S.map((v, i) => (i === 0 ? 0.5 : v)) } },
      { state: { ...valid.state, S: valid.state.S.map((v, i) => (i === 0 ? -1 : v)) } },
      { state: { ...valid.state, S: valid.state.S.map((v, i) => (i === 0 ? 256 : v)) } },
      {
        state: { ...valid.state, S: valid.state.S.map((v, i) => (i === 0 ? valid.state.S[1] : v)) },
      },
    ];

    for (const snap of malformed) {
      expect(() => restoreStream(snap as never)).toThrow(/valid seedrandom ARC4 state/);
    }
    expect(() => restoreLayers(null as never)).toThrow(/snapshot must contain/);
    expect(() => restoreLayers({ gen: valid, events: {} as never })).toThrow(/valid seedrandom/);
  });
});
