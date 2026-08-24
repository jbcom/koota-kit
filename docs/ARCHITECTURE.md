# Architecture

koota-kit is intentionally a convention layer, not an abstraction over every
Koota capability. Consumers still use Koota entities, traits, relations,
queries, and actions directly.

## Module boundaries

```text
traits ───────────────> koota
rng ──────────────────> seedrandom
world ────────────────> koota + rng
eventLog ─────────────> WorldHandle scratch
index ────────────────> public re-exports only
```

`traits` is a leaf module: it imports Koota but no sibling runtime module. This
keeps trait declarations out of world/scenario evaluation cycles and preserves
the reference identity Koota uses to identify traits.

`rng` has no Koota dependency. Its serialized contract is the seedrandom ARC4
state plus a two-stream container.

`world` owns allocation, teardown, time, and facade-owned persistence. It does
not own application entity serialization.

`eventLog` uses the handle's scratch map so event lifetime matches world
lifetime. It does not use a process-global queue.

## Invariants

1. Seed values on a handle are copied and frozen at creation.
2. World-generation and runtime-event draws never share a PRNG instance.
3. Invalid draw parameters do not advance a stream.
4. Restoring a header is atomic from the caller's perspective.
5. Object-valued structure-of-arrays fields use factories.
6. Event logs have one consuming owner; observers use `peek`.
7. World teardown clears facade-owned scratch state and releases the Koota ID.

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
- No scheduler or system runner: Koota's queries/actions remain the execution
  model.
- No automatic derived-key hashing: the application owns stable domain keys.
- No multi-consumer queue semantics: publish separate logs when two systems
  must independently consume the same fact.
