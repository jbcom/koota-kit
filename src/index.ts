// koota-kit — thin koota ECS conventions layer.
//
// Six modules, also importable as subpaths:
//   ./world    — WorldHandle lifecycle (world + dual-stream rng + clock + scratch)
//   ./schedule — fixed-step system schedule (accumulator in scratch, step cap)
//   ./rng      — dual-layer deterministic seedrandom PRNG and named substreams
//                with byte-exact snapshot/restore
//   ./seed     — length-prefixed SHA-256 seed derivation and 128-bit master
//                seeds (leaf module, zero runtime dependencies)
//   ./traits   — defineTrait AoS-aliasing guard (leaf module, zero sibling
//                imports)
//   ./eventLog — scratch-backed publish/drain event logs with a peek seam for
//                observers (harnesses, tests, HUDs)

export {
  advanceClock,
  createActions,
  createSimWorld,
  destroySimWorld,
  relation,
  restoreWorldHeader,
  snapshotWorld,
  trait,
} from "./world.js";
export type { Entity, World, WorldHandle, WorldSnapshot } from "./world.js";

export {
  chance,
  createRng,
  createSubstreams,
  getSubstream,
  nextFloat,
  nextInt,
  nextU32,
  pick,
  restoreLayers,
  restoreStream,
  restoreSubstreams,
  shuffle,
  snapshotLayers,
  snapshotStream,
  snapshotSubstreams,
  substream,
} from "./rng.js";
export type {
  RngLayers,
  RngLayersSnapshot,
  RngSeeds,
  RngStream,
  RngStreamSnapshot,
  Substreams,
  SubstreamsSnapshot,
} from "./rng.js";

export { createMasterSeed, deriveSeed, isMasterSeed, MASTER_SEED_BYTES } from "./seed.js";
export type { EntropySource, SeedPart } from "./seed.js";

export { createSchedule } from "./schedule.js";
export type { Schedule, ScheduleOptions, System } from "./schedule.js";

export { defineEventLog } from "./eventLog.js";
export type { EventLog } from "./eventLog.js";

export { defineTrait } from "./traits/index.js";
export type { SafeSchema } from "./traits/index.js";
