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
spatial ──────────────> (leaf: caller-provided provider + exact oracle)
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

`spatial` is a renderer-neutral leaf entry. Providers publish immutable,
completed records with caller-owned source/instance/part/registration identity,
common frame/unit, separate geometry/topology/pose/transform revisions, full
and visible topology identities, and certified enclosing AABBs. The module
sorts records deterministically, does only conservative AABB filtering, and
delegates exact nearest-surface work to an injected oracle. It retains neither
provider records nor buffers, so producer-owned buffers cannot be aliased by a
core cache. Full topology is the default; a visible selection is explicit.
Sparse provider slots and capability lists fail closed; copied query thresholds stay fixed through
callbacks. Foreign-frame peers remain unresolved while compatible candidates
are evaluated, preserving exact violation precedence. Satisfaction involving
any AABB-only evidence remains conservative.
Point clearance establishes distance to open surfaces only. It deliberately
does not infer solid containment or nonpenetration from triangle proximity.
`coordination` accepts an existing raw Koota `World` and attaches only its
own ownership and registration traits. Its immutable snapshot is a completed
metadata projection, not a second World or ECS serializer. The World retains
authority over caller entities and traits. Each binding owns an opaque marker
held on that World and registration records tagged with that marker, so it can
remove only its own records. Bindings may coexist only for disjoint entities.
`CoordinationBinding` and `CoordinationRegistration` have one identity per
module format. Applications must use one Koota runtime and module format per
process. Koota 0.6.6 installs numeric entity methods globally; loading
its opposite ESM/CommonJS format replaces dispatch for already live entities.
Coordination rejects a World outside its imported peer universe before adding
markers. It then attests dispatch against the existing World marker holder,
using the public `getStore`, `unpackEntity`, and `universe` APIs. The initial
holder lookup inspects only its owned marker store; subsequent checks cache the
holder and require constant work. There is no probe entity, hidden World,
prototype repair, or second World registry.

Every live read and raw mutation verifies that dispatch and marker ownership
still agree. Callbackful writes are checked before and after the raw operation
and before committing metadata or cleanup. A mismatch throws while preserving
the previous completed snapshot and subscribers. A dispatch change during listener
delivery is a postcommit error: all listeners receive the new committed
snapshot, and that snapshot stays published. A raw callback may already
have written or removed an owned trait; that partial raw state is outside the
completed projection. Registration rollback uses the previously attested peer
functions solely for its just-added owned trait. Initial binding rollback uses
direct World methods. Final marker removal checks dispatch without requiring
the removed marker, then commits cleanup. Destroyed-World cleanup needs no
entity dispatch, and an already disposed binding stays idempotent.

Before a publication, coordination validates every update and produces a new
immutable view sorted by caller-authored stable ID. Koota raw trait callbacks
may see the individual mirror writes, so the completed view changes only after
all mirror writes succeed and is the sole atomic observer boundary. Producers
share a binding to form one atomic cohort; disjoint bindings are independent
cohorts. Listener callbacks cannot mutate the registry while delivery
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
11. Spatial query results are stamped with the provider's full identity,
    selected topology, frame/unit, and independent completed revisions. A
    mismatched expected or oracle-consumed tuple is stale, never exact.
12. A coordination snapshot publishes only fully validated completed metadata;
    failed batch preparation leaves the prior projection visible.
13. Coordination disposal never destroys or resets a caller-owned World,
    entity, caller trait, provider, or geometry buffer.

## Performance choices

- RNG draws delegate directly to seedrandom after one small validation step.
- Snapshots clone the 256-byte permutation explicitly instead of serializing
  through JSON.
- Event logs allocate on first push, leave scratch untouched for empty reads,
  truncate in place on drain, and expose a non-allocating `size` operation.
- Spatial expected stamps use a per-query map keyed by the complete encoded
  identity tuple. Matching all expectations takes linear lookup work after
  preparing the snapshot, before any exclusions; no map is retained between
  queries. Queries without expected stamps do not allocate this map.
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

## Grounded movement boundary

`walker` is a dependency-free leaf over immutable authored JSON geometry. It
owns fixed-displacement body collision, support selection and segment
occlusion. `schedule` owns time; the consumer owns input, coordinate transforms,
saved state, physical dimensions, geometry production and rendering. Neither
module imports the other. A consumer can therefore save the authoritative
walker state and render that state without a second controller body.

The solver uses an upright square prism and an explicit X-then-Z sliding
policy. It partitions each axis displacement at support rectangle boundaries,
validates transitions against the step limit, and sweeps both vertical
transitions and subsequent movement against expanded AABBs. Unsupported gaps
cannot be skipped by a large movement delta. Surface selection and equal-time
collision ordering use stable lexical IDs; caller array order is immaterial.

Walkability planes and solid volumes are separate authored facts. A support
plane certifies foot-centre support, not a solid floor underside or a complete
walkway enclosure. Solid ceilings and railings must be authored explicitly.
The point-clearance oracle in `spatial` does not replace these volume sweeps:
clearance of a point is not proof that a walking body fits or that its entire
path remains clear. Numeric and supported-geometry limits are in the API page.

`queryWalkerPath` separately certifies continuous straight horizontal routes.
An X-then-Z movement result cannot establish diagonal support or collision
clearance. The path query computes closed parameter intervals for every support
rectangle, partitions their entry/exit boundaries, and validates complete
interval coverage plus continuous whole-body sweeps. It shares the support
transition/sweep primitive with walking, but does not share its axis routing.
Literal endpoints resolve arithmetic residuals without applying a geometric
support-gap tolerance. Consumers own route search and must revalidate a planned
segment against the current world before committing it.

## Bounded numeric replay contract

`numeric.ts` is a dependency-free leaf for a small deterministic simulation gap:
rotations within one turn, the positive inverse cosine, and cube roots of
unsigned 32-bit integer counts. It does not own transforms, meshes, authored
poses, scheduling, units, cache policy, or an arbitrary-precision math engine.
Finite authored pose tables were considered: they cannot cover continuous
caller-owned articulation without introducing a separate interpolation contract.

Revision 1 uses signed Q80 BigInt arithmetic. Conversion to Q80 multiplies by
the exactly representable power of two `2^80`, then applies specified truncation;
conversion back uses specified BigInt-to-Number rounding and power-of-two
division. These operations and integer arithmetic follow the
[ECMAScript numeric operations](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types).
The implementation never calls host sine, cosine, inverse cosine, cube root,
power, or square root. This avoids the implementation-approximated
[Math transcendental functions](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math-object).

Sine and cosine evaluate 24 Taylor terms with a single integer truncation per
recurrence. For `|x| <= pi`, the first omitted term is below `6e-38`.
The initial recurrence multiplier is at most 5 and all subsequent cosine
multipliers are below 1; the sine recurrence has an initial multiplier below 2
and subsequent multipliers below 1. Input quantization and all recurrence
truncations therefore contribute less than `1024 * 2^-80`. Including binary64
output rounding gives the conservative `1e-14` component bound.

Inverse cosine bisects integer angles over `[0, floor(pi/2 * 2^80)]`, using
the same cosine kernel, to an interval of one Q80 unit (at most 81 iterations).
The exact `value === 1` endpoint returns zero. Every other positive binary64
input below 1 is at least `2^-53` below it, giving a sine derivative magnitude
above `1e-8` at the closest root. Even with cosine error and the bounded near-root
interval, the inverse error is below the conservative `1e-10` radian bound.
Values smaller than one Q80 unit map to zero with angular error below `2^-80`.
The encoded half-pi integer is the floor of the mathematical constant times
`2^80`, independent of the host Math implementation.

Cube root bisects the exact integer `value * 2^240` over `[0, 1626 * 2^80]`
and returns its integer cube root divided by `2^80`. Its quantization error is
below `2^-80`; the result is below 1626, so binary64 rounding contributes less
than `2^-43`, comfortably within `1e-12`. The bisection uses at most 91 steps.
There are no growing tables or hidden caches. Shared golden vectors, endpoint
and dense native-reference checks, poisoned host-Math checks, and installed
ESM/CommonJS parity run through the supported Node 22/24/26 CI matrix.
