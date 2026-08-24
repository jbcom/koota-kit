# @jbcom/koota-kit

Thin koota ECS conventions layer, distilled from real production use. NOT a
game engine — three small modules that keep a game's sim deterministic and its
ECS lib swappable:

Version `0.1.1` targets Koota `^0.6.6`. The package's release gate requires its
peer and conformance-test dependency to match the latest published Koota line;
the wrapper must never make its own adoption an excuse to pin an obsolete ECS.

- **`./world`** — `WorldHandle` facade (`createSimWorld`, `advanceClock`,
  `snapshotWorld`, `restoreWorldHeader`). Wraps koota's
  `createWorld`/`trait`/`relation`/`createActions` behind one boundary so no
  call site imports koota directly.
- **`./rng`** — dual-stream deterministic PRNG (seedrandom-backed):
  `gen` (worldgen — replays a world from its seed forever) vs `events`
  (per-tick play — diverges with play history), each with byte-exact
  snapshot/restore. `Math.random()` is forbidden in sim code.
- **`./traits`** — `defineTrait`, a thin wrapper over koota's `trait()` that
  enforces the AoS-factory convention (`field: () => ({...})`) for
  object-valued fields at type level and runtime, preventing koota's SoA
  layout from aliasing one shared object across every entity.

## The two crown jewels (read before using)

1. **Entity-id-reuse footgun:** koota's entity bookkeeping is process-global.
   Worlds replaced without `destroy()` get different `worldId` bits; churn
   (destroy+respawn) recycles ids with bumped generations. Never key
   per-entity randomness on entity ids or on lazy draws from a shared stream
   in query-iteration order — derive per-entity seeds from stable domain keys
   plus `handle.seeds.gen`. (`WorldHandle.seeds` exists precisely for this.)
2. **Dual-stream RNG rationale:** a single stream couples worldgen to play,
   making "same map, fresh playthrough" fragile. Snapshot `gen` once at
   creation; snapshot `events` on demand. Each layer's determinism contract
   is independent.

## Conventions this package expects of consumers

- Declare traits in a **leaf module with zero sibling imports** (only `koota`
  and pure types) — avoids top-level evaluation cycles between the ECS layer,
  the world facade, and game scenarios (pattern from
  medieval-hexagon-gameboard). Export each trait from exactly one location so
  reference-identity holds.
- Use `relation()` for ownership edges, not manual foreign-key id fields.
- Route ALL sim randomness through `rng.gen` / `rng.events`.
- Express runtime work as Koota queries and systems. The facade is a lifecycle
  and determinism boundary, not permission to replace ECS queries with hand-run
  arrays of mutable game objects.

## Install

```sh
pnpm add @jbcom/koota-kit koota
```

`koota` is a **peer dependency** (`^0.6.6`) — install it alongside, so your app
controls the ECS version rather than this wrapper pinning it for you.

Ships dual ESM + CJS with types for both; `import` and `require` both work.

## Usage

```ts
import {
  advanceClock,
  createSimWorld,
  defineTrait,
  nextFloat,
  relation,
  restoreWorldHeader,
  snapshotWorld,
} from "@jbcom/koota-kit";

const Town = defineTrait({
  name: "",
  population: 0,
  storage: () => ({ logs: 0, planks: 0 }), // AoS factory — never a bare literal
});
const BelongsTo = relation();

const h = createSimWorld({ gen: "world-42", events: "playthrough-0" });
const town = h.world.spawn(Town({ name: "Riverside" }));
h.world.spawn(Town(), BelongsTo(town));

// per tick:
advanceClock(h, 1 / 60);
if (nextFloat(h.rng.events) < 0.01) {
  /* rare event */
}

// save / load:
const snap = snapshotWorld(h); // rng byte-exact + clock (entity state is yours to serialize)
restoreWorldHeader(h, snap);
```

## Development

```sh
pnpm test       # vitest conformance suite (production-derived footgun pins)
pnpm typecheck  # tsc --noEmit
pnpm build      # dist/esm (ESM + .d.ts) and dist/cjs
```

## Release evidence

Extracted standalone from its host monorepo with history preserved. Verified
outside any workspace: 35 tests pass, `tsc --noEmit` is clean, and the dual
build emits ESM + CJS with per-format declarations. `publint` reports no
problems and `arethetypeswrong` is green on every entry point across `node10`,
`node16` (from CJS and ESM), and `bundler`. A scratch consumer installed the
packed tarball and exercised the public API from both `import` and `require`,
getting identical RNG draws from each.

## License

MIT — see [LICENSE](./LICENSE).
