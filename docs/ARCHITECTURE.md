# Architecture

koota-kit is intentionally a convention layer, not an abstraction over every
Koota capability. Consumers still use Koota entities, traits, relations,
queries, and actions directly.

## Module boundaries

```text
traits ───────────────> koota
seed ─────────────────> (leaf: built-in SHA-256)
rng ──────────────────> seedrandom + seed
world ────────────────> koota + rng
schedule ─────────────> world (advanceClock) + WorldHandle scratch
eventLog ─────────────> WorldHandle scratch
react ────────────────> koota/react + react + world (type only)
index ────────────────> public re-exports only (never react)
```

`traits` is a leaf module: it imports Koota but no sibling runtime module. This
keeps trait declarations out of world/scenario evaluation cycles and preserves
the reference identity Koota uses to identify traits.

`rng` has no Koota dependency. Its serialized contract is the seedrandom ARC4
state plus a two-stream container, or a seed plus named-substream container.

`seed` is a leaf module with no runtime dependency at all. `deriveSeed` uses a
small built-in synchronous SHA-256 so it behaves identically in browsers and
Node, in both the ESM and the CommonJS build (Web Crypto's digest is async, and
the common hash packages are ESM-only). The test suite checks it against
`node:crypto` and a frozen golden vector. Its byte encoding (a
domain tag, then each value as a 4-byte big-endian UTF-8 length plus its UTF-8
text) is a stable contract: changing it would change every derived world.

`world` owns allocation, teardown, time, and facade-owned persistence. It does
not own application entity serialization.

`schedule` turns a frame's dt into whole fixed steps. Its accumulator lives in
the handle's scratch map, so time owed dies with the run and two schedules or
two worlds never share it. It imports no renderer: a frame callback calls
`tick` and that is the whole integration. The step cap drops excess time rather
than carrying it, so one huge dt cannot cause a catch-up storm.

`eventLog` uses the handle's scratch map so event lifetime matches world
lifetime. It does not use a process-global queue.

`react` is the only module that imports React, through `koota/react`. It is
reachable only from the `koota-kit/react` subpath: `index` does not re-export it,
and `react` is an optional peer dependency, so an application that never imports
that subpath never needs React installed. It carries the `WorldHandle` through a
context and mounts Koota's own `WorldProvider` for `handle.world`, which keeps
one source of truth for the world. It imports `world` for types only and owns no
lifecycle: creating and destroying the handle stays with the application.
`pnpm package:check` walks every other built entry's import graph and fails if
it reaches `react` or `koota/react`.

## Invariants

1. Seed values on a handle are copied and frozen at creation.
2. World-generation and runtime-event draws never share a PRNG instance.
3. Invalid draw parameters do not advance a stream.
4. Restoring a header is atomic from the caller's perspective.
5. Object-valued structure-of-arrays fields use factories.
6. Event logs have one consuming owner; observers use `peek`.
7. World teardown clears facade-owned scratch state and releases the Koota ID.
8. A named substream's sequence depends only on its seed and name; creating or
   consuming another substream never shifts it.
9. Only `koota-kit/react` imports React; every other entry stays React-free.
10. A schedule's systems only ever see `dt === step`; the same elapsed time
    delivered at any frame rate runs the same steps in the same order.

## Performance choices

- RNG draws delegate directly to seedrandom after one small validation step.
- Snapshots clone the 256-byte permutation explicitly instead of serializing
  through JSON.
- Event logs allocate on first push, leave scratch untouched for empty reads,
  truncate in place on drain, and expose a non-allocating `size` operation.
- The package is not bundled. ESM and CommonJS outputs preserve small subpath
  entry points and let application bundlers tree-shake normally.

## Intentional limits

- No entity/trait serializer: applications need versioned domain schemas.
- No system graph: `createSchedule` runs an ordered list once per fixed step,
  and nothing more. There is no dependency resolution, parallelism, or
  per-system rate; a system that wants a slower cadence counts steps itself.
  Koota's queries/actions remain the execution model inside each system.
- No implicit derived keys: `deriveSeed` hashes only the parts the application
  passes, so the application still owns stable domain keys.
- No multi-consumer queue semantics: publish separate logs when two systems
  must independently consume the same fact.
