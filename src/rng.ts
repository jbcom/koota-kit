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

export function createRng(seeds: RngSeeds): RngLayers {
  return {
    gen: makeStream(seeds.gen),
    events: makeStream(seeds.events),
  };
}

export function nextU32(stream: RngStream): number {
  return stream.prng.int32() >>> 0;
}

export function nextFloat(stream: RngStream): number {
  return stream.prng.quick();
}

export function nextInt(stream: RngStream, minInclusive: number, maxExclusive: number): number {
  const span = maxExclusive - minInclusive;
  return minInclusive + Math.floor(nextFloat(stream) * span);
}

export function chance(stream: RngStream, p: number): boolean {
  return nextFloat(stream) < p;
}

export type RngStreamSnapshot = { state: State };
export type RngLayersSnapshot = { gen: RngStreamSnapshot; events: RngStreamSnapshot };

export function snapshotStream(stream: RngStream): RngStreamSnapshot {
  return { state: JSON.parse(JSON.stringify(stream.prng.state())) as State };
}

export function snapshotLayers(rng: RngLayers): RngLayersSnapshot {
  return { gen: snapshotStream(rng.gen), events: snapshotStream(rng.events) };
}

export function restoreStream(snap: RngStreamSnapshot): RngStream {
  const prng = seedrandom("", { state: snap.state });
  return { prng };
}

export function restoreLayers(snap: RngLayersSnapshot): RngLayers {
  return { gen: restoreStream(snap.gen), events: restoreStream(snap.events) };
}
