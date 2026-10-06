import { describe, expect, it } from "vitest";
import {
  createRng,
  createSubstreams,
  getSubstream,
  nextU32,
  restoreSubstreams,
  snapshotStream,
  snapshotSubstreams,
  substream,
} from "../src/rng.js";
import { deriveSeed } from "../src/seed.js";

const draws = (stream: Parameters<typeof nextU32>[0], count = 8) =>
  Array.from({ length: count }, () => nextU32(stream));

describe("substream", () => {
  it("is deterministic for a seed and name", () => {
    expect(draws(substream("round-7", "layout"))).toEqual(draws(substream("round-7", "layout")));
  });

  it("is exactly the stream seeded by deriveSeed(seed, name)", () => {
    const viaDerive = createRng({ gen: deriveSeed("round-7", "layout"), events: 0 }).gen;
    expect(draws(substream("round-7", "layout"))).toEqual(draws(viaDerive));
  });

  it("isolates names: different names and different seeds diverge", () => {
    const layout = draws(substream("round-7", "layout"));
    expect(draws(substream("round-7", "roster"))).not.toEqual(layout);
    expect(draws(substream("round-8", "layout"))).not.toEqual(layout);
    // The old string-concatenation footgun: "a/bc" vs "ab/c" must not collide.
    expect(draws(substream("a", "bc"))).not.toEqual(draws(substream("ab", "c")));
  });

  it("never shifts an existing substream when another is added or consumed", () => {
    const baseline = draws(substream("round-7", "layout"));

    // Same seed, new generators created first and drained heavily.
    const loot = substream("round-7", "loot");
    const graph = substream("round-7", "graph");
    for (let index = 0; index < 500; index += 1) {
      nextU32(loot);
      nextU32(graph);
    }
    expect(draws(substream("round-7", "layout"))).toEqual(baseline);
  });

  it("rejects bad seeds and names without allocating", () => {
    expect(() => substream("s", "")).toThrow(/substream: name must be a non-empty string/);
    expect(() => substream("s", 3 as never)).toThrow(/substream: name/);
    expect(() => substream(Number.NaN, "x")).toThrow(/deriveSeed/);
  });
});

describe("substream sets", () => {
  it("creates one stream per name lazily and returns the same instance", () => {
    const set = createSubstreams("round-7");
    expect(set.seed).toBe("round-7");
    expect(set.streams.size).toBe(0);
    const layout = getSubstream(set, "layout");
    expect(getSubstream(set, "layout")).toBe(layout);
    expect(set.streams.size).toBe(1);
    expect(draws(layout)).toEqual(draws(substream("round-7", "layout")));
  });

  it("keeps each set member independent of creation order", () => {
    const first = createSubstreams(42);
    nextU32(getSubstream(first, "roster"));
    const layoutA = draws(getSubstream(first, "layout"));

    const second = createSubstreams(42);
    const layoutB = draws(getSubstream(second, "layout"));
    expect(layoutA).toEqual(layoutB);
  });

  it("validates seeds and names", () => {
    expect(() => createSubstreams({} as never)).toThrow(/createSubstreams: seed/);
    expect(() => createSubstreams(Number.POSITIVE_INFINITY)).toThrow(/createSubstreams: seed/);
    const set = createSubstreams("s");
    expect(() => getSubstream(set, "")).toThrow(/getSubstream: name/);
    expect(set.streams.size).toBe(0);
  });

  it("snapshots byte-exact with sorted names and restores every later draw", () => {
    const set = createSubstreams("round-7");
    nextU32(getSubstream(set, "roster"));
    nextU32(getSubstream(set, "layout"));
    nextU32(getSubstream(set, "layout"));

    const snap = JSON.parse(JSON.stringify(snapshotSubstreams(set)));
    expect(Object.keys(snap.streams)).toEqual(["layout", "roster"]);
    expect(snap.seed).toBe("round-7");

    const expectedLayout = draws(getSubstream(set, "layout"));
    const expectedRoster = draws(getSubstream(set, "roster"));
    const expectedLoot = draws(getSubstream(set, "loot"));

    const restored = restoreSubstreams(snap);
    expect(draws(getSubstream(restored, "layout"))).toEqual(expectedLayout);
    expect(draws(getSubstream(restored, "roster"))).toEqual(expectedRoster);
    // Never-created streams restore lazily from the seed.
    expect(draws(getSubstream(restored, "loot"))).toEqual(expectedLoot);
  });

  it("detaches snapshots from later draws", () => {
    const set = createSubstreams("s");
    const stream = getSubstream(set, "a");
    const snap = snapshotSubstreams(set);
    const before = JSON.stringify(snap);
    draws(stream, 20);
    expect(JSON.stringify(snap)).toBe(before);
  });

  it("restores atomically, rejecting any malformed part", () => {
    const valid = snapshotStream(substream("s", "a"));
    expect(() => restoreSubstreams(null as never)).toThrow(/restoreSubstreams: snapshot/);
    expect(() => restoreSubstreams({ seed: Number.NaN, streams: {} } as never)).toThrow(
      /restoreSubstreams: seed/,
    );
    expect(() => restoreSubstreams({ seed: "s", streams: null } as never)).toThrow(
      /restoreSubstreams: streams/,
    );
    expect(() => restoreSubstreams({ seed: "s", streams: [] } as never)).toThrow(
      /restoreSubstreams: streams/,
    );
    expect(() => restoreSubstreams({ seed: "s", streams: { "": valid } } as never)).toThrow(
      /restoreSubstreams: stream names/,
    );
    expect(() =>
      restoreSubstreams({ seed: "s", streams: { a: valid, b: { state: { i: 0 } } } } as never),
    ).toThrow(/restoreStream/);
  });
});
