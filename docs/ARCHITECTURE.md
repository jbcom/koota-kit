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
eventLog ─────────────> WorldHandle scratch
index ────────────────> public re-exports only
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
8. A named substream's sequence depends only on its seed and name; creating or
   consuming another substream never shifts it.

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
- No implicit derived keys: `deriveSeed` hashes only the parts the application
  passes, so the application still owns stable domain keys.
- No multi-consumer queue semantics: publish separate logs when two systems
  must independently consume the same fact.
