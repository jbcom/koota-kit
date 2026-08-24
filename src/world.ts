// World facade. Wraps koota's createWorld + trait helper so the rest of a
// game's codebase imports from here and lifecycle/determinism conventions stay
// behind one boundary.
//
// Games declare their traits with `defineTrait` (see ./traits) and drive the
// sim through the WorldHandle: world creation, trait re-export, tick clock,
// dual-layer RNG plumbing.

import type { World } from "koota";
import { createActions, createWorld, relation, trait } from "koota";
import type { RngLayers, RngLayersSnapshot, RngSeeds } from "./rng.js";
import { createRng, restoreLayers, snapshotLayers } from "./rng.js";

export type { Entity } from "koota";
export type { World };
export { createActions, relation, trait };

export type WorldHandle = {
  readonly world: World;
  rng: RngLayers;
  /**
   * The immutable seeds this world was created from. Stored so systems
   * can derive deterministic per-entity seeds (e.g. noise keyed on an
   * entity's stable grid coordinates) WITHOUT lazily consuming the
   * rng.gen stream in query-iteration order — koota entity ids are not
   * reset between worlds, so iteration-order rng draws are
   * non-deterministic across two runs in one process. Derive from
   * `seeds.gen`, never a lazy draw.
   */
  readonly seeds: Readonly<RngSeeds>;
  clock: { tickIndex: number; simSeconds: number };
  /**
   * Per-system scratch caches owned by the WorldHandle (so they lifecycle with
   * the world, not at module scope). Systems read/write via well-known keys.
   * Examples: per-region noise fns, pathfinding grids, behavior-tree instances.
   */
  readonly scratch: Map<string, unknown>;
};

/**
 * Create a fresh `WorldHandle`: a new koota world, both RNG layers seeded
 * from `seeds`, a zeroed clock, and an empty scratch map. This is the one
 * entry point for standing up a sim — call it once per world (per game
 * session, per test, per worldgen run) rather than constructing the koota
 * world and RNG separately, so the facade's invariants (immutable `seeds`,
 * clock starting at zero, scratch starting empty) always hold.
 */
export function createSimWorld(seeds: RngSeeds): WorldHandle {
  // Validate before allocating a Koota world: invalid input must not consume a
  // process-global world id or leave a world that the caller cannot destroy.
  const rng = createRng(seeds);
  const immutableSeeds = Object.freeze({ gen: seeds.gen, events: seeds.events });
  return {
    world: createWorld(),
    rng,
    seeds: immutableSeeds,
    clock: { tickIndex: 0, simSeconds: 0 },
    scratch: new Map(),
  };
}

/**
 * Tear down a simulation handle. This clears facade-owned scratch state and
 * releases Koota's process-global world id. The operation is idempotent, which
 * makes it safe to call from cleanup paths that may run more than once.
 */
export function destroySimWorld(handle: WorldHandle): void {
  handle.scratch.clear();
  if (handle.world.isInitialized) {
    handle.world.destroy();
  }
}

/**
 * Advance `handle`'s clock by one fixed-timestep tick: increments
 * `tickIndex` by 1 and accumulates `dt` seconds into `simSeconds`. Call once
 * per sim tick, before running that tick's systems, so `clock` always
 * reflects "how far the sim has progressed" rather than "how far it will
 * have progressed after this tick's work."
 */
export function advanceClock(handle: WorldHandle, dt: number): void {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new RangeError(`advanceClock: dt must be a finite, non-negative number; received ${dt}.`);
  }
  if (!Number.isSafeInteger(handle.clock.tickIndex) || handle.clock.tickIndex < 0) {
    throw new RangeError("advanceClock: clock.tickIndex must be a non-negative safe integer.");
  }
  if (!Number.isFinite(handle.clock.simSeconds) || handle.clock.simSeconds < 0) {
    throw new RangeError("advanceClock: clock.simSeconds must be finite and non-negative.");
  }
  const tickIndex = handle.clock.tickIndex + 1;
  const simSeconds = handle.clock.simSeconds + dt;
  if (!Number.isSafeInteger(tickIndex) || !Number.isFinite(simSeconds)) {
    throw new RangeError("advanceClock: advancing the clock would exceed its numeric range.");
  }
  handle.clock.tickIndex = tickIndex;
  handle.clock.simSeconds = simSeconds;
}

/**
 * The serializable "header" of a world: both RNG layers' byte-exact state
 * plus the clock. Deliberately excludes entity/component state — koota
 * entities are the caller's data to serialize however their game needs
 * (full ECS dump, delta log, etc.); this snapshot only covers what the
 * facade itself owns.
 */
export type WorldSnapshot = {
  rng: RngLayersSnapshot;
  clock: { tickIndex: number; simSeconds: number };
};

/**
 * Capture `handle`'s RNG state and clock into a plain, JSON-serializable
 * `WorldSnapshot`. Pair with `restoreWorldHeader` for save/load — restoring
 * a snapshot reproduces every subsequent RNG draw on both layers byte-exact
 * and resumes the clock from the exact tick/second it was captured at.
 */
export function snapshotWorld(handle: WorldHandle): WorldSnapshot {
  return {
    rng: snapshotLayers(handle.rng),
    clock: { tickIndex: handle.clock.tickIndex, simSeconds: handle.clock.simSeconds },
  };
}

/**
 * Restore `handle`'s RNG layers and clock from a `WorldSnapshot` taken by
 * `snapshotWorld`. Mutates `handle` in place (replaces `handle.rng` and
 * `handle.clock` with freshly rebuilt values) — entity/component state is
 * untouched, since the facade never captured it in the first place; restore
 * that separately using whatever serialization your game chose.
 */
export function restoreWorldHeader(handle: WorldHandle, snap: WorldSnapshot): void {
  const clock = snap?.clock;
  if (
    !clock ||
    !Number.isSafeInteger(clock.tickIndex) ||
    clock.tickIndex < 0 ||
    !Number.isFinite(clock.simSeconds) ||
    clock.simSeconds < 0
  ) {
    throw new TypeError(
      "restoreWorldHeader: snapshot.clock must contain a non-negative safe integer tickIndex and finite, non-negative simSeconds.",
    );
  }
  // Build and validate every replacement before mutating the handle so a bad
  // persisted snapshot cannot leave it half-restored.
  const rng = restoreLayers(snap.rng);
  handle.rng = rng;
  handle.clock = { tickIndex: clock.tickIndex, simSeconds: clock.simSeconds };
}
