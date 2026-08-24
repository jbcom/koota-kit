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
  gen: string | number;
  /** Per-playthrough events seed (changes per cycle for new playthroughs of the same world). */
  events: string | number;
};

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
 * `[minInclusive, maxExclusive)`. Consumes exactly one `nextFloat` draw.
 */
export function nextInt(stream: RngStream, minInclusive: number, maxExclusive: number): number {
  const span = maxExclusive - minInclusive;
  return minInclusive + Math.floor(nextFloat(stream) * span);
}

/**
 * Roll a boolean weighted by probability `p` (`0` never true, `1` always
 * true). Consumes exactly one `nextFloat` draw from `stream`, so calling
 * `chance` where a system might otherwise skip a draw entirely will shift
 * every later draw on that stream — keep draw counts deterministic across
 * codepaths that must replay identically.
 */
export function chance(stream: RngStream, p: number): boolean {
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
  return { state: JSON.parse(JSON.stringify(stream.prng.state())) as State };
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
 * is irrelevant because `{ state: snap.state }` fully overrides it.
 */
export function restoreStream(snap: RngStreamSnapshot): RngStream {
  const prng = seedrandom("", { state: snap.state });
  return { prng };
}

/**
 * Rebuild both RNG layers from a snapshot taken by `snapshotLayers`. See
 * `restoreStream` — applied independently to `gen` and `events`.
 */
export function restoreLayers(snap: RngLayersSnapshot): RngLayers {
  return { gen: restoreStream(snap.gen), events: restoreStream(snap.events) };
}
