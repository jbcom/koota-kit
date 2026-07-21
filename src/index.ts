// @arcade-cabinet/ecs-koota — thin koota ECS conventions layer.
//
// Extracted from timber-town (ecs-conventions tournament winner). Three
// modules, also importable as subpaths:
//   ./world  — WorldHandle facade (world + dual-stream rng + clock + scratch)
//   ./rng    — dual-layer deterministic seedrandom PRNG with byte-exact
//              snapshot/restore
//   ./traits — defineTrait AoS-aliasing guard (leaf module, zero sibling
//              imports)

export {
  advanceClock,
  createActions,
  createSimWorld,
  relation,
  restoreWorldHeader,
  snapshotWorld,
  trait,
} from "./world.js";
export type { Entity, World, WorldHandle, WorldSnapshot } from "./world.js";

export {
  chance,
  createRng,
  nextFloat,
  nextInt,
  nextU32,
  restoreLayers,
  restoreStream,
  snapshotLayers,
  snapshotStream,
} from "./rng.js";
export type {
  RngLayers,
  RngLayersSnapshot,
  RngSeeds,
  RngStream,
  RngStreamSnapshot,
} from "./rng.js";

export { defineTrait } from "./traits/index.js";
export type { SafeSchema } from "./traits/index.js";
