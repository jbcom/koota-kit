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
coordination ─────────> koota (borrowed World, no sibling runtime dependency)
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

`coordination` accepts an existing raw Koota `World` and attaches only its
own ownership and registration traits. Its immutable snapshot is a completed
metadata projection, not a second World or ECS serializer. The World retains
authority over caller entities and traits. Each binding owns an opaque marker
held on that World and registration records tagged with that marker, so it can
remove only its own records. Bindings may coexist only for disjoint entities.
The public `CoordinationBinding` and `CoordinationRegistration` traits have one
identity per module format; consumers should not mix package formats in a
single Koota World.

Before a publication, coordination validates every update and produces a new
immutable view sorted by caller-authored stable ID. Koota raw trait callbacks
may see the individual mirror writes, so the completed view is the sole atomic
observer boundary. Listener callbacks cannot mutate the registry while delivery
is active. There is no event-log drain: every coordination subscriber is
independent. Entity destruction is detected by `World.has` and becomes a
published removal only when the caller explicitly invokes `prune`.

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
    delivered at any frame rate runs the same steps in the same order, as long
    as no single tick owes more than `maxSteps` (beyond that, the excess is
    dropped by design, so a one-second frame and sixty 1/60 s frames differ).
11. A coordination snapshot publishes only fully validated completed metadata;
    failed batch preparation leaves the prior projection visible.
12. Coordination disposal never destroys or resets a caller-owned World,
    entity, caller trait, provider, or geometry buffer.

## Performance choices

- RNG draws delegate directly to seedrandom after one small validation step.
- Snapshots clone the 256-byte permutation explicitly instead of serializing
  through JSON.
- Event logs allocate on first push, leave scratch untouched for empty reads,
  truncate in place on drain, and expose a non-allocating `size` operation.
- Coordination snapshots are rebuilt only after a completed registration,
  publication, removal, or explicit prune. Equal completed revisions retain
  the prior snapshot identity and do not notify subscribers.
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
- No geometry, broadphase, exact-query, source/provenance, topology, unit,
  frame, pose, renderer, React, or AI adapter: those are later explicit
  producer/query contracts. A coordination revision is not evidence that a
  provider's buffers are immutable or fresh.
