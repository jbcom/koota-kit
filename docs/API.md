# API reference

All functions and types are exported from `koota-kit`, except the React
bindings, which are only available from `koota-kit/react` so the root entry
never loads React. The module-specific import paths shown below can reduce
coupling in larger codebases.

## `world`

### `createSimWorld(seeds)`

```ts
function createSimWorld(seeds: RngSeeds): WorldHandle;
```

Creates a Koota `World`, two seeded RNG streams, immutable copied seeds, a
zeroed clock, and an empty scratch map. Seeds must be strings or finite
numbers. Validation happens before the Koota world is allocated.

### `destroySimWorld(handle)`

```ts
function destroySimWorld(handle: WorldHandle): void;
```

Clears scratch state and destroys the Koota world if it is still active. The
operation is idempotent.

### `advanceClock(handle, dt)`

```ts
function advanceClock(handle: WorldHandle, dt: number): void;
```

Advances `tickIndex` by one and adds `dt` to `simSeconds`. `dt` must be finite
and non-negative. A zero-duration tick is allowed. Overflow and corrupted clock
values raise `RangeError` without changing the clock.

### `snapshotWorld(handle)` / `restoreWorldHeader(handle, snapshot)`

```ts
function snapshotWorld(handle: WorldHandle): WorldSnapshot;
function restoreWorldHeader(handle: WorldHandle, snapshot: WorldSnapshot): void;
```

Snapshots and restores both RNG streams plus the simulation clock. The plain
object can be round-tripped through JSON. It does not include `WorldHandle.seeds`:
persist the immutable seeds separately and use them when creating a fresh
handle for loading. Entity and trait data are also outside this package's
persistence boundary. Restore validates the complete replacement before
mutating the handle.

### Koota exports

`createActions`, `relation`, and `trait` are re-exported so simulation code can
keep its Koota imports at one boundary. `Entity` and `World` are exported as
types.

## `rng`

```ts
type RngSeeds = {
  readonly gen: string | number;
  readonly events: string | number;
};

function createRng(seeds: RngSeeds): RngLayers;
function nextU32(stream: RngStream): number;
function nextFloat(stream: RngStream): number;
function nextInt(stream: RngStream, minInclusive: number, maxExclusive: number): number;
function chance(stream: RngStream, probability: number): boolean;
function pick<T>(stream: RngStream, items: readonly T[]): T;
function shuffle<T>(stream: RngStream, items: readonly T[]): T[];
function snapshotStream(stream: RngStream): RngStreamSnapshot;
function restoreStream(snapshot: RngStreamSnapshot): RngStream;
function snapshotLayers(layers: RngLayers): RngLayersSnapshot;
function restoreLayers(snapshot: RngLayersSnapshot): RngLayers;
```

- `nextU32` returns an unsigned 32-bit integer.
- `nextFloat` returns a value in `[0, 1)`.
- `nextInt` uses half-open bounds and exactly one float draw after validation.
- `chance` consumes one draw for every valid probability, including `0` and
  `1`, keeping later draw positions predictable.
- `pick` returns one element uniformly with exactly one `nextInt` draw and
  rejects an empty array without drawing.
- `shuffle` returns a Fisher–Yates shuffled copy (the input is never mutated)
  and consumes exactly `length - 1` draws, so the draw count depends only on
  the length, never on the contents.
- Restore functions reject malformed ARC4 state and clone accepted state so a
  snapshot can seed multiple independent replays.

### Named substreams

```ts
type Substreams = {
  readonly seed: string | number;
  readonly streams: ReadonlyMap<string, RngStream>;
};
type SubstreamsSnapshot = {
  seed: string | number;
  streams: Record<string, RngStreamSnapshot>;
};

function substream(seed: string | number, name: string): RngStream;
function createSubstreams(seed: string | number): Substreams;
function getSubstream(substreams: Substreams, name: string): RngStream;
function snapshotSubstreams(substreams: Substreams): SubstreamsSnapshot;
function restoreSubstreams(snapshot: SubstreamsSnapshot): Substreams;
```

- `substream(seed, name)` returns a fresh stream seeded by
  `deriveSeed(seed, name)`. Its sequence depends only on `seed` and `name`, so
  adding, removing, reordering, or consuming another substream never shifts it.
- `name` must be a non-empty string. Invalid input throws before anything is
  allocated.
- `createSubstreams` holds one lazily created stream per name, so generators
  that share a set keep drawing where they left off. `getSubstream` returns the
  same stream instance for the same name.
- `snapshotSubstreams` captures the seed plus every stream created so far, with
  names in sorted order. `restoreSubstreams` validates the whole snapshot
  before building anything and reproduces every later draw byte-exact. Streams
  that were never created restore lazily from the seed.

## `seed`

```ts
type SeedPart = string | number;
type EntropySource = {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
}; // `globalThis.crypto` satisfies it, with or without DOM typings

const MASTER_SEED_BYTES = 16;

function deriveSeed(parent: SeedPart, ...parts: SeedPart[]): string;
function createMasterSeed(entropy?: EntropySource): string;
function isMasterSeed(value: unknown): value is string;
```

- `deriveSeed` hashes the parent seed and every part with SHA-256 and returns
  the first 128 bits as 32 lowercase hex characters. The result is a valid
  seed for `createRng`, `createSimWorld`, `substream`, and further
  `deriveSeed` calls.
- Every value is length-prefixed before hashing, so `("a", "bc")` and
  `("ab", "c")` derive different seeds. Order matters.
- Numbers canonicalize to their string form, matching `createRng`, so
  `deriveSeed(7, "x") === deriveSeed("7", "x")`. Non-finite numbers and
  non-string, non-number values throw.
- The output is stable across platforms and package versions. A change to the
  derivation would be a breaking change.
- `createMasterSeed` fills 16 bytes from `entropy` (default
  `globalThis.crypto`) and returns them as 32 lowercase hex characters. It
  throws when no entropy source exists, when the source returns something
  other than the requested 16-byte array, or when it returns all zero bytes,
  which signals an unfilled buffer rather than real entropy.
- `isMasterSeed` accepts exactly 32 lowercase hex characters. Use it to
  validate a persisted seed before deriving from it.

## `traits`

```ts
function defineTrait<S extends Schema>(schema: S & SafeSchema<S>): Trait<Norm<S>>;
```

Pass primitive fields directly. Wrap each object- or array-valued field in a
factory, or use a whole-trait factory:

```ts
const Health = defineTrait({ value: 100 });
const Path = defineTrait({ points: () => [] as Array<{ x: number; y: number }> });
const Pose = defineTrait(() => ({ position: { x: 0, y: 0 } }));
```

Bare object and array fields are rejected by `SafeSchema` and by the runtime
guard.

## `schedule`

Import from `koota-kit/schedule` or the root.

```ts
type System = (handle: WorldHandle, dt: number) => void;

type ScheduleOptions = {
  step: number;     // seconds per step; finite, > 0
  maxSteps: number; // safe integer >= 1: most steps one tick may run
  key?: string;     // scratch key for the accumulator; unique by default
};

type Schedule = {
  readonly step: number;
  readonly maxSteps: number;
  readonly key: string;
  tick(handle: WorldHandle, frameDt: number): number;
  remainder(handle: WorldHandle): number;
};

function createSchedule(systems: readonly System[], options: ScheduleOptions): Readonly<Schedule>;
```

`createSchedule` copies `systems` and validates `step`, `maxSteps`, `key` and
every system before returning; bad configuration throws `TypeError` or
`RangeError` naming `createSchedule`.

`tick(handle, frameDt)` adds `frameDt` to an accumulator stored in
`handle.scratch` under `key`, then, while at least one whole `step` is owed and
fewer than `maxSteps` have run, calls `advanceClock(handle, step)` and then
every system in order with `dt === step`. It returns the number of steps run.
Systems read `dt`, never the frame's dt, so the same elapsed time gives the same
run at any frame rate.

- A `frameDt` that is negative, `NaN` or infinite counts as `0`. `0` is a valid
  pause: no step runs and the clock does not move.
- When `maxSteps` is reached with whole steps still owed, those steps are
  dropped, not carried. The sub-step fraction is kept, so phase is preserved.
- A billionth of a step of tolerance absorbs float drift, so 432 frames of
  1/144 s run the same 180 steps as 180 frames of 1/60 s.
- The accumulator lives in `scratch`, so it dies with the world and two
  handles never share one. A `key` already holding something other than a
  schedule accumulator throws `TypeError` before the clock moves. Two schedules
  given the same explicit `key` share one accumulator.
- If a system throws, the step it was in is already spent (the clock moved) and
  the steps not yet started stay owed, so a retry does not replay spent time.

`remainder(handle)` returns the seconds currently owed, in `[0, step)` between
ticks (`0` on a handle that has not ticked). `remainder / step` is the
interpolation alpha for a renderer drawing between sim states.

## `eventLog`

```ts
type EventLog<T> = {
  readonly key: string;
  push(handle: WorldHandle, event: T): void;
  drain(handle: WorldHandle): T[];
  peek(handle: WorldHandle): readonly T[];
  clear(handle: WorldHandle): void;
  size(handle: WorldHandle): number;
};

function defineEventLog<T>(key: string): EventLog<T>;
```

Logs are created once at module scope but store their arrays in each handle's
scratch map. `drain` truncates the live array in place so an existing internal
reference is not orphaned. Empty reads do not create a scratch entry. `peek`
returns a detached array; `size` does not allocate.

## `react`

Import from `koota-kit/react`. Requires `react` (`>=18`), an optional peer
dependency; no other entry point imports it.

```ts
type SimWorldProviderProps = {
  readonly handle: WorldHandle;
  readonly children?: ReactNode;
};

const SimWorldProvider: FunctionComponent<SimWorldProviderProps>;
function useSimWorld(): WorldHandle;
```

`SimWorldProvider` supplies `handle` to the tree below it and renders
`koota/react`'s `WorldProvider` for `handle.world`, so `useWorld`, `useTrait`,
`useQuery` and `useActions` work under it without a second provider.
`useSimWorld` returns the provided handle, including its `rng`, `seeds`,
`clock` and `scratch`, and throws an `Error` when no `SimWorldProvider` is above
it. Passing a different `handle` re-provides every consumer. The provider does
not create or destroy the handle: pair `createSimWorld` with `destroySimWorld`
yourself.
