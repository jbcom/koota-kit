// World facade. Wraps koota's createWorld + trait helper so the rest of a
// game's codebase imports from here and the ECS lib stays swappable behind
// one boundary.
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
  world: World;
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
  seeds: RngSeeds;
  clock: { tickIndex: number; simSeconds: number };
  /**
   * Per-system scratch caches owned by the WorldHandle (so they lifecycle with
   * the world, not at module scope). Systems read/write via well-known keys.
   * Examples: per-region noise fns, pathfinding grids, behavior-tree instances.
   */
  scratch: Map<string, unknown>;
};

export function createSimWorld(seeds: RngSeeds): WorldHandle {
  return {
    world: createWorld(),
    rng: createRng(seeds),
    seeds,
    clock: { tickIndex: 0, simSeconds: 0 },
    scratch: new Map(),
  };
}

export function advanceClock(handle: WorldHandle, dt: number): void {
  handle.clock.tickIndex += 1;
  handle.clock.simSeconds += dt;
}

export type WorldSnapshot = {
  rng: RngLayersSnapshot;
  clock: { tickIndex: number; simSeconds: number };
};

export function snapshotWorld(handle: WorldHandle): WorldSnapshot {
  return {
    rng: snapshotLayers(handle.rng),
    clock: { tickIndex: handle.clock.tickIndex, simSeconds: handle.clock.simSeconds },
  };
}

export function restoreWorldHeader(handle: WorldHandle, snap: WorldSnapshot): void {
  handle.rng = restoreLayers(snap.rng);
  handle.clock = { tickIndex: snap.clock.tickIndex, simSeconds: snap.clock.simSeconds };
}
