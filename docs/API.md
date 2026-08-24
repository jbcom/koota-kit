# API reference

All functions and types are exported from `@jbdevprimary/koota-kit`. The
module-specific import paths shown below can reduce coupling in larger
codebases.

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
object can be round-tripped through JSON. Entity and trait data are outside
this package's persistence boundary. Restore validates the complete replacement
before mutating the handle.

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
- Restore functions reject malformed ARC4 state and clone accepted state so a
  snapshot can seed multiple independent replays.

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
