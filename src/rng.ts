// Dual-layer deterministic PRNG (seedrandom-backed).
//
// `gen` — worldgen / layouts / spawn locations / map composition / one-time
//   seeded decisions. Replays a world reliably from the gen seed alone, even
//   when play diverges. Snapshot it once at world creation and you can
//   re-derive the same world forever.
//
// `events` — per-tick runtime decisions (weather rolls, event triggers, mood
//   drift, combat dice). Diverges based on play history. Snapshot/restore
//   independently so a worldgen replay doesn't carry play state with it.
//
// Why two streams: a single stream couples worldgen to play, so seeding a
// "same map, fresh playthrough" scenario requires you to either re-derive
// worldgen mid-restore (fragile) or snapshot the stream at the exact tick
// worldgen finished (brittle to system ordering). Two streams: snapshot gen
// once, never touch it again; snapshot events on demand. Each layer's
// determinism contract is independent.
//
// Forbidden in sim code: `Math.random()`. Use `nextFloat(rng.gen)` or
// `nextFloat(rng.events)` depending on the layer.

import seedrandom from "seedrandom";
import { deriveSeed } from "./seed.js";

type State = seedrandom.State.Arc4;
type Stateful = seedrandom.StatefulPRNG<State>;

export type RngStream = {
  prng: Stateful;
};

export type RngLayers = {
  gen: RngStream;
  events: RngStream;
};

export type RngSeeds = {
  /** World-generation seed (immutable, defines the world's identity). */
  readonly gen: string | number;
  /** Per-playthrough events seed (changes per cycle for new playthroughs of the same world). */
  readonly events: string | number;
};

function assertSeed(seed: unknown, name: keyof RngSeeds): asserts seed is string | number {
  if (typeof seed !== "string" && typeof seed !== "number") {
    throw new TypeError(`createRng: seeds.${name} must be a string or finite number.`);
  }
  if (typeof seed === "number" && !Number.isFinite(seed)) {
    throw new RangeError(`createRng: seeds.${name} must be finite; received ${String(seed)}.`);
  }
}

function makeStream(seed: string | number): RngStream {
  const prng = seedrandom(String(seed), { state: true });
  return { prng };
}

/**
 * Create both RNG layers from their seeds. Called once at world creation
 * (see `createSimWorld` in `./world`) — `gen` and `events` are independent
 * seedrandom instances from this point on, so consuming one never perturbs
 * the other's sequence.
 */
export function createRng(seeds: RngSeeds): RngLayers {
  if (typeof seeds !== "object" || seeds === null) {
    throw new TypeError("createRng: seeds must be an object with gen and events values.");
  }
  assertSeed(seeds.gen, "gen");
  assertSeed(seeds.events, "events");
  return {
    gen: makeStream(seeds.gen),
    events: makeStream(seeds.events),
  };
}

/**
 * Draw the next raw unsigned 32-bit integer from `stream` (range
 * `[0, 2**32)`). The lowest-level draw primitive — `nextFloat`, `nextInt`,
 * and `chance` are all expressed in terms of `quick()`, not this function;
 * reach for `nextU32` directly only when you need the full 32 bits of
 * entropy (e.g. seeding another PRNG, hashing).
 */
export function nextU32(stream: RngStream): number {
  return stream.prng.int32() >>> 0;
}

/**
 * Draw the next float from `stream` in the half-open range `[0, 1)`. The
 * primitive every other draw helper in this module (`nextInt`, `chance`)
 * is built on.
 */
export function nextFloat(stream: RngStream): number {
  return stream.prng.quick();
}

/**
 * Draw a random integer from `stream` in the half-open range
 * `[minInclusive, maxExclusive)`. Bounds must be safe integers, the range must
 * be non-empty and no larger than `2**32`, and valid calls consume exactly one
 * `nextFloat` draw. Invalid calls do not consume the stream.
 */
export function nextInt(stream: RngStream, minInclusive: number, maxExclusive: number): number {
  if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive)) {
    throw new TypeError("nextInt: bounds must be safe integers.");
  }
  if (maxExclusive <= minInclusive) {
    throw new RangeError(
      `nextInt: maxExclusive (${maxExclusive}) must be greater than minInclusive (${minInclusive}).`,
    );
  }
  if (maxExclusive - minInclusive > 2 ** 32) {
    throw new RangeError("nextInt: the requested range cannot exceed 2**32 values.");
  }
  const span = maxExclusive - minInclusive;
  return minInclusive + Math.floor(nextFloat(stream) * span);
}

/**
 * Roll a boolean weighted by finite probability `p` in `[0, 1]` (`0` never
 * true, `1` always true). Valid calls consume exactly one `nextFloat` draw
 * from `stream`, so calling `chance` where a system might otherwise skip a
 * draw entirely will shift every later draw on that stream — keep draw counts
 * deterministic across codepaths that must replay identically.
 */
export function chance(stream: RngStream, p: number): boolean {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError(`chance: probability must be a finite number in [0, 1]; received ${p}.`);
  }
  return nextFloat(stream) < p;
}

export type RngStreamSnapshot = { state: State };
export type RngLayersSnapshot = { gen: RngStreamSnapshot; events: RngStreamSnapshot };

/**
 * Capture `stream`'s internal seedrandom state as a plain, JSON-serializable
 * object (deep-cloned, so later draws on `stream` cannot mutate the
 * snapshot). Restoring it with `restoreStream` reproduces every subsequent
 * draw byte-exact.
 */
export function snapshotStream(stream: RngStream): RngStreamSnapshot {
  const state = stream.prng.state();
  return { state: { i: state.i, j: state.j, S: [...state.S] } };
}

/**
 * Snapshot both RNG layers at once. See `snapshotStream` — this just applies
 * it to `gen` and `events` independently and returns both.
 */
export function snapshotLayers(rng: RngLayers): RngLayersSnapshot {
  return { gen: snapshotStream(rng.gen), events: snapshotStream(rng.events) };
}

/**
 * Rebuild an `RngStream` from a snapshot taken by `snapshotStream`. The next
 * draw on the returned stream reproduces the exact next draw the snapshotted
 * stream would have produced — the seed string passed to `seedrandom` here
 * is irrelevant because `{ state: snap.state }` fully overrides it. Malformed
 * persisted state is rejected before seedrandom sees it.
 */
export function restoreStream(snap: RngStreamSnapshot): RngStream {
  const state = snap?.state as State | undefined;
  if (
    !state ||
    !Number.isInteger(state.i) ||
    state.i < 0 ||
    state.i > 255 ||
    !Number.isInteger(state.j) ||
    state.j < 0 ||
    state.j > 255 ||
    !Array.isArray(state.S) ||
    state.S.length !== 256 ||
    state.S.some((value) => !Number.isInteger(value) || value < 0 || value > 255) ||
    new Set(state.S).size !== 256
  ) {
    throw new TypeError("restoreStream: snapshot must contain a valid seedrandom ARC4 state.");
  }
  // Clone the permutation so the same immutable snapshot can safely seed more
  // than one replay, even if seedrandom changes its internal copy behavior.
  const prng = seedrandom("", { state: { i: state.i, j: state.j, S: [...state.S] } });
  return { prng };
}

/**
 * Rebuild both RNG layers from a snapshot taken by `snapshotLayers`. See
 * `restoreStream` — applied independently to `gen` and `events`.
 */
export function restoreLayers(snap: RngLayersSnapshot): RngLayers {
  if (typeof snap !== "object" || snap === null) {
    throw new TypeError("restoreLayers: snapshot must contain gen and events stream states.");
  }
  return { gen: restoreStream(snap.gen), events: restoreStream(snap.events) };
}

// ─── Named substreams ────────────────────────────────────────────────────────
//
// A seed often feeds several independent generators (layout, roster, loot, …).
// Sharing one stream couples them: adding a generator, or one more draw in an
// early generator, shifts every later generator's output and silently changes
// existing saves. A named substream is seeded by `deriveSeed(seed, name)`, so
// its sequence depends only on the seed and its own name.

export type Substreams = {
  /** The seed every member stream is derived from. */
  readonly seed: string | number;
  /** Streams created so far, keyed by name. Create members with `getSubstream`. */
  readonly streams: ReadonlyMap<string, RngStream>;
};

export type SubstreamsSnapshot = {
  seed: string | number;
  streams: Record<string, RngStreamSnapshot>;
};

function assertSubstreamName(name: unknown, api: string): asserts name is string {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError(`${api}: name must be a non-empty string.`);
  }
}

function assertSubstreamSeed(seed: unknown, api: string): asserts seed is string | number {
  if (typeof seed !== "string" && !(typeof seed === "number" && Number.isFinite(seed))) {
    throw new TypeError(`${api}: seed must be a string or finite number.`);
  }
}

/**
 * Create the stream named `name` under `seed`: a fresh stream seeded by
 * `deriveSeed(seed, name)`. Creating or consuming any other substream never
 * shifts this one.
 */
export function substream(seed: string | number, name: string): RngStream {
  assertSubstreamName(name, "substream");
  return makeStream(deriveSeed(seed, name));
}

/** Create an empty, lazily populated set of named substreams under `seed`. */
export function createSubstreams(seed: string | number): Substreams {
  assertSubstreamSeed(seed, "createSubstreams");
  return { seed, streams: new Map() };
}

/**
 * Return the set's stream for `name`, creating it from the set's seed on first
 * use. The same name always returns the same live stream instance.
 */
export function getSubstream(substreams: Substreams, name: string): RngStream {
  assertSubstreamName(name, "getSubstream");
  const existing = substreams.streams.get(name);
  if (existing) return existing;
  const stream = substream(substreams.seed, name);
  (substreams.streams as Map<string, RngStream>).set(name, stream);
  return stream;
}

/**
 * Capture the set's seed plus every stream created so far, with names in
 * sorted order. JSON-serializable and detached from later draws.
 */
export function snapshotSubstreams(substreams: Substreams): SubstreamsSnapshot {
  // Object.fromEntries defines own data properties, so a stream named
  // "__proto__" is captured instead of hitting the prototype setter.
  const streams: Record<string, RngStreamSnapshot> = Object.fromEntries(
    [...substreams.streams.keys()]
      .sort()
      .map((name) => [name, snapshotStream(substreams.streams.get(name) as RngStream)]),
  );
  return { seed: substreams.seed, streams };
}

/**
 * Rebuild a substream set from `snapshotSubstreams` output. Validates the
 * complete snapshot before building anything; streams that were never created
 * restore lazily from the seed on first `getSubstream`.
 */
export function restoreSubstreams(snapshot: SubstreamsSnapshot): Substreams {
  if (typeof snapshot !== "object" || snapshot === null) {
    throw new TypeError("restoreSubstreams: snapshot must contain a seed and streams.");
  }
  assertSubstreamSeed(snapshot.seed, "restoreSubstreams");
  const entries = snapshot.streams;
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
    throw new TypeError("restoreSubstreams: streams must be an object keyed by stream name.");
  }
  const restored = new Map<string, RngStream>();
  for (const [name, stream] of Object.entries(entries)) {
    if (name.length === 0) {
      throw new TypeError("restoreSubstreams: stream names must be non-empty strings.");
    }
    restored.set(name, restoreStream(stream));
  }
  return { seed: snapshot.seed, streams: restored };
}
