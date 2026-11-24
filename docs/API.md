# API reference

All functions and types are exported from `koota-kit`, except the React
bindings, which are only available from `koota-kit/react` so the root entry
never loads React. The module-specific import paths shown below can reduce
coupling in larger codebases.

## `spatial`

Import from `koota-kit/spatial` or the root:

```ts
function queryPointClearance(
  provider: SpatialProvider,
  oracle: SpatialNearestSurfaceOracle,
  query: SpatialClearanceQuery,
): SpatialClearanceResult;
```

`queryPointClearance` decides one explicit predicate: the query point is at
least `minimumDistance` from every selected **open surface**. The default
selection is each part's `full` topology; callers must explicitly request
`visible` topology. A provider record carries stable source, instance, part,
and provider-local registration identity; a common Euclidean frame and unit;
independent geometry, topology, pose, and transform revisions; and certified
enclosing AABBs for both topology selections.

The core performs deterministic AABB broadphase only. It invokes the supplied
nearest-surface oracle for overlapping candidates and validates that its
witness is in the selected certified bound, in the same frame/unit, and was
computed from the exact consumed identity/topology/revision tuple. Results
include those checked tuples, ordered witnesses, exclusions, one of
`satisfied`, `violated`, `unknown`, `unsupported`, or `stale`, and an
exactness label. An AABB rejection can conservatively satisfy the threshold;
an oracle witness or a stamped bounded `no-hit` is exact. Satisfaction that
combines AABB and oracle evidence is conservative. A stale expected/provider
tuple wins before the result can be trusted; otherwise an exact violating
witness wins over an unavailable or foreign-frame peer. Sparse provider
snapshots and capability lists fail closed. Validated query thresholds are captured before any
provider or oracle callback and cannot change during evaluation.

There is no geometry kernel, BVH, renderer, model, physics, Koota, or React
dependency in this entry. It does not prove containment or solid
nonpenetration: an open-surface nearest query has no watertightness/thickness
semantics. A future solid query needs an injected containment-capable oracle.

### Grid queries

`koota-kit/spatial` (and the root) also export pure, deterministic queries over a
finite grid of unit cells. A grid is `{ width, height }`; cell `(x, y)` has the
row-major index `y * width + x`. The caller owns what a cell means and passes a
`GridPredicate = (x, y) => boolean`. Every predicate is read exactly once per
cell it needs, row-major, before any search starts. A grid holds at most
`GRID_MAX_CELLS` (4,194,304) cells. Malformed sizes, predicates, cells and
options throw `TypeError` or `RangeError` with a `spatial:` message before any
allocation.

```ts
type GridSize = { width: number; height: number };
type GridCell = { x: number; y: number };
type GridRect = { x: number; y: number; width: number; height: number };
type GridSquare = { x: number; y: number; side: number };
type GridPredicate = (x: number, y: number) => boolean;
type GridConnectivity = 4 | 8;
type GridMask = { width: number; height: number; cells: Uint8Array; count: number };
```

A `GridMask` holds `1` for a member cell in `cells[y * width + x]` and `0`
otherwise.

```ts
function createGridMask(size: GridSize, predicate: GridPredicate): GridMask;
function gridMaskHas(mask: GridMask, x: number, y: number): boolean; // false outside the grid
function gridMaskCells(mask: GridMask): GridCell[]; // ascending row-major
```

#### Occupancy

```ts
function buildGridOccupancy(size: GridSize, footprints: readonly GridRect[]): GridOccupancy;

type GridOccupancy = {
  width: number;
  height: number;
  occupant: Int32Array; // occupant[y * width + x]: first footprint to cover the cell, or -1
  occupied: GridMask;
  overlapping: readonly number[]; // ascending indices that cover an already covered cell
  outOfBounds: readonly number[]; // ascending indices with any cell outside the grid
};
```

Footprints are laid in array order and the first footprint to cover a cell owns
it. An overlap or an out-of-bounds footprint is reported as data, never thrown,
and an out-of-bounds footprint still lays its in-bounds cells. Rotation is the
caller's: pass the footprint already turned, with its lowest-index corner as
`x, y`.

#### Reachability flood

```ts
function floodGrid(
  size: GridSize,
  open: GridPredicate,
  seeds: readonly GridCell[],
  step: GridConnectivity,
): GridMask;
```

Returns every open cell reachable from `seeds` by steps through open cells.
`step` 4 moves to the four side neighbours; `step` 8 also moves to the four
diagonals. **There is no corner-cutting rule:** under 8 the flood passes between
two blocked cells that touch only at a corner, so a barrier seals only when its
pieces join side to side. A seed that is not open is never entered. A seed
outside the grid, or a sparse seed list, throws. Reachability is symmetric:
`b` is reached from `a` exactly when `a` is reached from `b`, and the 8-step
set contains the 4-step set.

#### Enclosed regions

```ts
function enclosedGridRegions(
  size: GridSize,
  open: GridPredicate,
  options: { step: GridConnectivity; regionStep?: GridConnectivity; seeds?: readonly GridCell[] },
): GridEnclosure;

type GridEnclosure = {
  outside: GridMask; // what the outside flood reached
  regions: readonly { cells: readonly GridCell[] }[];
};
```

Floods the outside through open cells with `step` (required: it decides what
counts as a seal) and returns the open cells it never reached, grouped into
connected regions with `regionStep` (default `step`). The outside begins at
every open border cell unless `seeds` are given, which is the same as an open
ring beyond the grid: a barrier along the border closes a region, and three
sides of a barrier against the border do not. Pass `seeds` (open cells at the
edge of the land) when the grid is a bounding box of irregular land. Regions
are ordered by their first cell in row-major order and each region's cells
ascend in row-major order. A region is not told which barrier cells bound it;
a barrier cell may touch a region only diagonally, so a caller who needs a
region's fence should look at the eight neighbours of its cells.

A game that wants "wire must join side to side to seal" floods the outside with
`step: 8`; a route that must not squeeze through a corner gap floods with
`floodGrid(..., 4)`.

#### Largest clear square

```ts
function largestClearGridSquare(
  size: GridSize,
  clear: GridPredicate,
  target: GridCell | GridRect,
  options?: { minSide?: number; maxSide?: number },
): GridSquare | null;
```

Returns the largest square of clear cells that contains the whole `target` (a
cell, or a rectangle), or `null`. Among squares of the largest side, the one
whose corner has the lowest `y`, then the lowest `x`, wins. The side is bounded
by `minSide` (default 1) and `maxSide` (default the grid's shorter side); `null` means
no square within them fits, including a target that is blocked, outside the grid
or larger than `maxSide`. Pass `minSide` one above a current square's side to
ask whether it can grow. The predicate is read only for the cells a qualifying
square could cover, so `maxSide` bounds the work and the allocation. Deriving a
capacity from the side is the caller's; `deterministicSafeIntegerCubeRoot` in
`koota-kit/numeric` is the replay-stable integer root.

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
run at any frame rate, provided no single tick owes more than `maxSteps` (the
excess is dropped, so one long frame and many short ones then differ).

- A `frameDt` that is negative, `NaN` or infinite counts as `0`. `0` is a valid
  pause: no step runs and the clock does not move, even if a failed tick left
  whole steps owed; those wait for the next frame that moves time.
- When `maxSteps` is reached with whole steps still owed, those steps are
  dropped, not carried. The sub-step fraction is kept, so phase is preserved.
- Owed time saturates at the largest finite double instead of overflowing.
- A billionth of a step of tolerance absorbs float drift, so 432 frames of
  1/144 s run the same 180 steps as 180 frames of 1/60 s.
- The accumulator lives in `scratch`, so it dies with the world and two
  handles never share one. A `key` already holding something other than a
  schedule accumulator throws `TypeError` before the clock moves. Two schedules
  given the same explicit `key` share one accumulator, but an explicit `key`
  may not equal another schedule's generated key, and a generated key skips any
  explicit one.
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

## `coordination`

Import from `koota-kit/coordination` or the root. This React-free entry binds
to an existing caller-owned Koota `World`; it never creates, resets, or
destroys that World or its entities.

```ts
type CompletedRevisions = Readonly<{
  geometry: number;
  pose: number;
  transform: number;
}>;

type CompletedMetadata = Readonly<{ revisions: CompletedRevisions }>;
type CoordinationDescriptor = Readonly<{
  id: string;
  capabilities: readonly string[];
}>;
type CoordinationUpdate = Readonly<{
  token: RegistrationToken;
  completed: CompletedMetadata;
}>;
type CoordinationEntry = Readonly<{
  id: string;
  capabilities: readonly string[];
  completed: CompletedMetadata | undefined;
}>;
type CoordinationSnapshot = Readonly<{
  revision: number;
  entries: readonly CoordinationEntry[];
}>;

function bindCoordination(world: World): Coordination;
```

`id` is a caller-authored, non-empty stable string. It is not a packed Koota
entity ID. Capability labels are copied, sorted, and must be unique non-empty
strings; change a capability set by unregistering and registering again.
`completed.revisions.geometry`, `.pose`, and `.transform` are all required
non-negative safe integers. They may advance independently but no dimension
may decrease. A new completed value with all three values equal is a no-op.

```ts
type Coordination = Readonly<{
  readonly world: World;
  register(entity: Entity, descriptor: CoordinationDescriptor): RegistrationToken;
  publish(token: RegistrationToken, completed: CompletedMetadata): CoordinationSnapshot;
  publishBatch(updates: readonly CoordinationUpdate[]): CoordinationSnapshot;
  unregister(token: RegistrationToken): CoordinationSnapshot;
  prune(): CoordinationSnapshot;
  getRegistration(id: string): RegistrationToken | undefined;
  getEntity(id: string): Entity | undefined;
  getSnapshot(): CoordinationSnapshot;
  subscribe(listener: (snapshot: CoordinationSnapshot) => void): () => void;
  dispose(): void;
}>;
```

`register` accepts only a live entity in the supplied `World`; cross-World,
destroyed, duplicated, and externally conflicting entities are rejected before
the coordinator mutates its projection. The opaque token is scoped to one
binding and to the entity generation. `publish` and `unregister` reject a
stale token. If an entity is destroyed or the owned registration trait is
removed externally, call `prune()` to publish its removal before reusing the
stable ID. If Koota rejects the binding marker during construction or rejects an
add callback during `register`, the binding removes only its just-added marker or
trait before rethrowing, so an existing peer binding remains intact and the
caller may retry registration. `getEntity` and `getRegistration` return `undefined` for a stale
registration.

Use one Koota runtime and module format per process. Koota
0.6.6 replaces numeric entity dispatch when its opposite ESM/CommonJS format
loads. Binding rejects a foreign peer World before adding its marker, and
attests the existing marker holder to detect contamination that predates the
first kit import. Later live reads, mutations, and cleanup throw a
`coordination:` dispatch-realm error if that attestation fails; they preserve
the last committed snapshot and subscribers. `getSnapshot()` remains readable.
A subscriber that changes dispatch after publication triggers an error after
all listeners receive the newly committed snapshot; that publication stays
committed. An opposite-format `koota-kit/spatial` import is safe because that entry does
not load Koota. This guard detects the known peer-format conflict; it does not
repair global methods or make mixed-format entity operations interoperable.

`publishBatch` validates every token and metadata value before it changes any
owned trait or snapshot. Its completed projection changes only after every raw
Koota trait write succeeds; a Koota callback error can leave partial raw mirror
writes, which are outside that projection. A completed snapshot is immutable,
detached from the caller input, and sorted by stable ID. Producers that need a
cross-producer atomic cohort must publish through the same binding; disjoint
bindings are independent cohorts. `revision` is a binding-local committed
publication generation, not a geometry, pose, transform, source-hash, or
provider freshness claim. It deliberately does not serialize entities or join
the RNG/clock `WorldSnapshot` boundary.

Subscribers each receive the same committed snapshot. A subscribe or
unsubscribe during delivery affects only a later publication. Registry mutation
during delivery or an owned Koota trait callback throws. Listener failures are
reported after every listener has been offered the committed snapshot; they do
not roll back it. When a listener throws during `register`, use
`getRegistration(id)` to recover the successfully committed token.

`dispose` is idempotent. It removes only this binding's registration traits and
World-held ownership marker, keeps other bindings' markers, and never destroys
or resets the borrowed World, its entities, caller traits, providers, or
buffers. Several bindings may share a World only for disjoint entities.

`CoordinationBinding` and `CoordinationRegistration` are the exported Koota
trait identities for this module format. The binding trait holds only opaque
per-binding ownership markers on the borrowed World; it is removed when the
last binding disposes. Direct trait mutation is outside the immutable committed-
snapshot contract; use the binding methods for publication. The module has no
renderer, React, producer, geometry, spatial-index, or AI dependency. Exact
adapters must own their own immutable buffers or read leases and report their
own source, topology, frame, unit, and freshness contracts.

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

## `walker`

Import from `koota-kit/walker` or the root. The subpath has no runtime
imports, including Koota, React, browser APIs, storage or a renderer.

```ts
import {
  advanceWalker,
  queryWalkerSupport,
  querySegmentOcclusion,
  type WalkerState,
  type WalkerWorld,
} from "koota-kit/walker";

const state: WalkerState = {
  position: { x: 0, y: 0, z: 0 },
  halfWidth: 0.3,
  height: 1.8,
  maxStep: 0.25,
  supportId: "ground",
};
const world: WalkerWorld = {
  supports: [{
    id: "ground", minX: -10, maxX: 10, minZ: -10, maxZ: 10,
    y: 0, slopeX: 0, slopeZ: 0,
  }],
  solids: [],
};
const result = advanceWalker(state, { x: 0.04, z: 0 }, world);
queryWalkerSupport(result.state, world); // { id: "ground", y: 0 }
querySegmentOcclusion({ x: 0, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }, world); // null
```

### Walker data

All data is plain JSON. Coordinates use caller-selected units with Y up.
`WalkerPoint` is `{x,y,z}`. `WalkerSolid` is `{id,min,max}` with two points
bounding a positive-volume axis-aligned box. `WalkerSupport` has the fields
in the code above: `y` is the height at `(minX,minZ)` and slopes specify rise
per horizontal unit. Bounds have positive area and combined slope magnitude
at most one. IDs are nonempty and unique across solids and supports.

`WalkerState.position` is the foot centre. The body is an upright **square
prism**, with width `2 * halfWidth` and `height`. This conservative footprint
is not a capsule. Dimensions must exceed `1e-9`; `maxStep` is nonnegative.
It limits discontinuous ascent and descent, not motion along a continuous
support plane. `supportId` is a saved observation; the geometry query always
revalidates support rather than trusting an ID. Neither calls nor returned
objects mutate caller-owned state, supports or solids.

### Walking and support

```ts
advanceWalker(state: WalkerState, displacement: { x: number; z: number },
  world: WalkerWorld): WalkerResult
queryWalkerSupport(state: WalkerState, world: WalkerWorld): WalkerSupportHit | null
```

A result contains `{state,status,contacts}`. Status is `moved`, `blocked`,
or `invalid-support`; `moved` also covers a zero displacement. Contacts are
unique lexically sorted solid IDs. An unsupported edge can block movement
without a solid contact. Invalid starting support or body overlap leaves the
position unchanged. A support hit is `{id,y}` and requires the current foot
height and whole-body clearance; it does not relocate the caller.

Call once per **fixed simulation tick**, with a world-space displacement for
that tick. Use `createSchedule` to separate render timing from simulation.
Render-delta integration and differently sized movement ticks are not promised
to produce identical paths. The deterministic slide policy is X followed by Z;
this gives an explicit axis preference, including at corners.

Every axis path is split at every authored support rectangle boundary. Each
interval selects the highest reachable support, breaking equal heights by ID.
This prevents tunnelling across even narrow support gaps. Step transitions
sweep the body vertically before proceeding; the horizontal/inclined segment
then sweeps the complete body against expanded solid bounds. The first hit
clips travel and the other axis can slide. Touching a solid is permitted;
entering its interior is blocked. Floating contact tolerance is `1e-9` in world
units, and equal fractions use lexical IDs, without locale collation.

Support cuts retain their literal authored coordinates and are ordered by exact
rational parameters. Every chosen support must contain both ends of its axis
interval; a rounded midpoint on an edge cannot bridge an unsupported gap.
Reaching an outer support edge returns that exact coordinate, so cancellation
cannot leave the feet a tiny distance outside the support. The next axis may
still slide along the edge. No epsilon clamp or support expansion is applied.

Support is tested at the **foot centre**, so up to half a body width can
extend beyond a support boundary. Author railings as solids wherever the
whole body must remain inside a walkway. Support surfaces are not solid
volumes: model ceilings, undersides, railings, risers and occluders separately.
A ramp may represent stair walkability while authored solids supply surrounding
walls and headroom. A solid riser intersecting the body can block movement;
this API does not infer a climbable surface from arbitrary mesh or box tops.
There is no jumping, airborne state, dynamic obstacle pushing or depenetration.

### Occlusion

```ts
querySegmentOcclusion(from: WalkerPoint, to: WalkerPoint,
  world: WalkerWorld): WalkerSegmentHit | null
```

This is a **closed**, finite segment against authored solids, with no body
expansion. A hit is `{id,fraction,point}` where fraction lies in `[0,1]`.
A start inside/on a solid returns zero; an endpoint hit counts. A zero-length
segment hits only when its point lies in a solid. The earliest fraction wins,
with lexical ID ordering for ties. Support planes do not occlude. Callers own
interaction reach limits, filtering target solids and deciding how a hit affects
an action.

All numeric inputs must be finite and within `+/- 1e9`; invalid numeric or
geometric inputs throw `RangeError`, and invalid IDs throw `TypeError`.
Author worlds near the origin and in sensible physical units: this contract
does not promise cross-engine bit identity for arbitrary floating calculations.

### Straight grounded paths

```ts
queryWalkerPath(state: WalkerState, target: WalkerPoint,
  world: WalkerWorld): WalkerPathResult
// WalkerPathResult = WalkerResult & { walkable: boolean }
```

This query certifies the **actual straight XZ route**, following authored support
heights along it. It never substitutes the X-then-Z movement policy or slides
around obstacles. For instance, two perpendicular walkway arms can carry an
axis-ordered walker between two endpoints while the diagonal crosses unsupported
space. `advanceWalker` success is therefore not a straight-path certificate.

For each support rectangle the query computes an analytic interval of segment
parameters. It partitions the route at every entry and exit and requires support
covering each complete nonempty interval. There is no uniform point sampling and
no support-gap epsilon. Supports covering an interval are considered by descending
height at its entry, with lexical ID ties; the first reachable one is chosen.
Vertical transitions and continuous movement then sweep the complete body through
the authored solids. Blocked support or any solid hit makes `walkable` false.
This is a conservative validator: it does not search alternate support choices
or find a detour when the chosen support is obstructed.

The target's Y must match the reached support height within `1e-9` world units.
Final XZ comes from the literal target rather than a reconstructed
`start + (target - start)`, which need not be exactly equal for decimal numbers.
Support interval ordering compares exact rational representations of the input
IEEE-754 numbers internally, so distinct boundaries cannot collapse into one
parameter or disappear during deduplication. Authored coordinates at an interior
boundary are retained instead of reconstructed on its boundary axis. These rules
do not expand support rectangles or discard narrow unsupported intervals. The ordinary body
contact tolerance remains the one documented above.

`walkable: true` has status `moved`. Invalid starting support has status
`invalid-support`; an incomplete path or target-height mismatch has status
`blocked`. The returned state is detached and describes the last reached point;
for a target-height mismatch it has the reached support's height. Contacts are
solid IDs, so an unsupported interval or target-height mismatch can have none.
A zero-length horizontal path is valid only with current support and a matching
target height. Neither the caller's state nor geometry is changed. Revalidate
against current geometry before committing a planned path.

The shared body/occlusion slab solver also compares interval boundaries and hit
order exactly. Very thin solids on long segments cannot disappear when entry
and exit round to the same floating fraction. Returned fractions remain ordinary
numbers; hit points retain the authored slab coordinate on the entry axis.
Two distinct exact hit times can consequently have the same numeric fraction,
while the selected hit still follows their exact order.

## Replay-stable bounded numeric kernels

Import `deterministicSinCos`, `deterministicAcos`, `deterministicCubeRoot`, and
`DETERMINISTIC_NUMERIC` from `koota-kit/numeric` (or the root entry).
The subpath has no runtime dependencies, world state, RNG, renderer, or cache.

| Function | Admitted input | Result | Absolute error bound |
| --- | --- | --- | --- |
| `deterministicSinCos(radians)` | Finite `[-Math.PI, Math.PI]` | `{sin, cos}` | `1e-14` per component |
| `deterministicAcos(value)` | Finite `[0, 1]` | Radians in `[0, pi/2]` | `1e-10` radians |
| `deterministicCubeRoot(value)` | Integer `[0, 4294967295]` | Real cube root | `1e-12` |

Inputs outside these domains throw `RangeError`. These functions do not wrap
angles or round fractional counts. Negative zero produces positive zero for
sine and cube root. The inverse endpoint `acos(1)` is exactly positive zero; `acos(0)` directly
returns the encoded half-pi value.
Errors refer to the mathematical function of the supplied binary64 input;
they are absolute numerical bounds, not geometric clearance certificates.

`DETERMINISTIC_NUMERIC` is frozen and contains `revision: 1`, the three bounds
(`sinCosAbsoluteError`, `acosAbsoluteError`, `cubeRootAbsoluteError`), and
`maximumCubeRootInput`. Revision 1 freezes the output bits for admitted inputs.
A future algorithm that changes those bits must use a new revision and an
explicit migration contract. Replay data can record the revision alongside its
own world version; world-header serialization remains unchanged.

Use these bounded functions when authoritative simulation and rendered geometry
must share the same scalar results. Persist or memoize repeated authored poses
and count-derived geometry in caller-owned bounded state. BigInt kernels cost
more than native trigonometry, particularly the inverse; do not reevaluate an
unchanged pose for every vertex or animation frame.

### Safe-integer cube-root counts

`deterministicSafeIntegerCubeRoot(value)` accepts every nonnegative safe integer
through `Number.MAX_SAFE_INTEGER`. It returns the real cube root and rejects
fractions, negative values, non-finite values and unsafe integers with
`RangeError`. Negative zero becomes positive zero. Import it and the frozen
`SAFE_INTEGER_CUBE_ROOT` contract from `koota-kit/numeric` or the root entry.

`SAFE_INTEGER_CUBE_ROOT` contains `revision: 1`,
`maximumInput: Number.MAX_SAFE_INTEGER`, and `absoluteError: 3e-11`.
The error is absolute relative to the mathematical cube root of the supplied
integer. Binary64 spacing grows with the result, so larger inputs require this
separate bound. The existing `deterministicCubeRoot` function keeps its uint32
domain, frozen outputs and tighter `DETERMINISTIC_NUMERIC.cubeRootAbsoluteError`
bound of `1e-12`. Both functions share the exact integer kernel and return
identical bits on their overlapping domain.
