# koota-kit

![Two deterministic streams—world generation and runtime events—flow through a simulation clock into modular ECS components.](./docs/assets/koota-kit-hero.webp)

[![CI](https://github.com/jbcom/koota-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/jbcom/koota-kit/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-17324d.svg)](./LICENSE)

Small, production-derived conventions for deterministic simulations built with
[Koota](https://github.com/pmndrs/koota). koota-kit gives a simulation one
lifecycle boundary, two independent seeded random streams, safe object-valued
traits, and world-scoped event logs.

It is deliberately **not a game engine**. It is the narrow layer that prevents
recurring classes of simulation bug without hiding Koota's queries,
entities, relations, or actions.

Full documentation: **[jonbogaty.com/koota-kit](https://jonbogaty.com/koota-kit/)**

## Why use it?

| Problem | koota-kit convention |
| --- | --- |
| World generation changes after unrelated gameplay draws | Separate `gen` and `events` RNG streams |
| A loaded save no longer reproduces the next random result | Byte-exact, JSON-safe RNG snapshots |
| Object state leaks between entities | `defineTrait` requires per-entity factories |
| A HUD or test consumes an event before its real system sees it | Single-consumer `drain`, non-consuming `peek` |
| Replaced worlds retain caches or process-global Koota IDs | `createSimWorld` / idempotent `destroySimWorld` lifecycle |

## Install

```sh
pnpm add @jbdevprimary/koota-kit koota
```

Requirements:

- Node.js 22 or newer (CI covers Node 22/24/26 on Linux and Node 24 on Windows)
- Koota `^0.6.6`, installed by the application as a peer dependency

The package ships native ESM and CommonJS entry points with format-correct
TypeScript declarations.

## Quick start

```ts
import {
  advanceClock,
  createSimWorld,
  defineEventLog,
  defineTrait,
  destroySimWorld,
  nextInt,
  snapshotWorld,
} from "@jbdevprimary/koota-kit";

const Position = defineTrait({ x: 0, y: 0 });
const Inventory = defineTrait({ items: () => [] as string[] });
const moved = defineEventLog<{ entity: number; distance: number }>("movement:completed");

const sim = createSimWorld({ gen: "map-42", events: "run-1" });

try {
  const scout = sim.world.spawn(Position({ x: 4, y: 9 }), Inventory());

  advanceClock(sim, 1 / 60);
  const distance = nextInt(sim.rng.events, 1, 5);
  const position = scout.get(Position);
  if (position) scout.set(Position, { ...position, x: position.x + distance });
  moved.push(sim, { entity: Number(scout), distance });

  // The owning system consumes each event once.
  for (const event of moved.drain(sim)) {
    console.log(event);
  }

  // Save this beside your own serialized entity/trait state.
  const header = snapshotWorld(sim);
  const serializedHeader = JSON.stringify(header);
  console.log(serializedHeader);
} finally {
  destroySimWorld(sim);
}
```

Runnable ESM and CommonJS versions live in [`examples/`](./examples).

## Core concepts

### One handle owns one simulation

`createSimWorld` creates a Koota world, immutable seed values, independent RNG
streams, a fixed-step clock, and a scratch map. `destroySimWorld` clears the
scratch map and releases Koota's world ID; it is safe to call more than once.

The scratch map is for derived, non-serializable caches and short-lived
coordination state. Namespace keys by system, for example `pathfinding:grid`
or `combat:hits`.

### Randomness has two jobs

- `rng.gen` defines stable world content: terrain, layouts, initial spawns.
- `rng.events` defines play history: combat rolls, weather, runtime events.

Never key per-entity randomness on packed Koota entity IDs or consume a shared
stream in query iteration order. Entity IDs contain process-global world and
generation bits. Derive a local stream from a stable domain key instead:

```ts
import { createRng, nextU32 } from "@jbdevprimary/koota-kit/rng";

const tileRng = createRng({
  gen: `${String(sim.seeds.gen)}/tile:12,8`,
  events: 0,
});
const terrainVariant = nextU32(tileRng.gen);
```

### Object-valued traits need factories

Koota's structure-of-arrays layout can alias a bare object literal across
entities. koota-kit rejects that form at compile time and runtime:

```ts
defineTrait({ storage: () => ({ logs: 0 }) }); // correct: one object per entity
defineTrait({ storage: { logs: 0 } });         // TypeError: shared object footgun
```

Declare traits once in a leaf module and export each trait from one location.
Koota identifies traits by reference, not by a string name.

### Event logs have one consuming owner

`push` appends, `drain` returns every pending event and empties the log, and
`peek` returns a copy without consuming. A devtool, HUD, or test should peek;
the system responsible for acting on the event should drain.

## Persistence boundary

`snapshotWorld` stores the clock and both RNG states. It intentionally does not
serialize entities or traits: those are application data with application-
specific schemas and migrations. `restoreWorldHeader` validates a parsed save
before changing the handle and restores atomically.

Persist a version beside the header and your ECS state so the application can
migrate its own schema.

## API and architecture

The root package exports the full API. Focused entry points are also available:

| Entry point | Purpose |
| --- | --- |
| `@jbdevprimary/koota-kit/world` | World lifecycle, clock, Koota facade, world snapshots |
| `@jbdevprimary/koota-kit/rng` | Seeded streams, bounded draws, snapshots |
| `@jbdevprimary/koota-kit/traits` | Safe trait declaration |
| `@jbdevprimary/koota-kit/eventLog` | World-scoped publish/drain logs |

See the [API reference](./docs/API.md) for signatures and validation behavior,
and [architecture notes](./docs/ARCHITECTURE.md) for module boundaries and
invariants.

## Errors and edge cases

- Seeds must be strings or finite numbers.
- `advanceClock` accepts finite, non-negative `dt`; `0` is a valid paused tick.
- `nextInt` requires safe-integer bounds with `maxExclusive > minInclusive` and
  a range no larger than `2**32`.
- `chance` accepts only finite probabilities in `[0, 1]`.
- Restores reject malformed RNG or clock state before mutating the handle.
- Event-log keys must be non-empty and cannot reuse a scratch key holding a
  non-array cache.

Invalid caller input raises `TypeError` or `RangeError` with the API name in the
message. No validation failure consumes RNG state or partially restores a
world header.

## Development

```sh
mise install   # or: corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Node and pnpm versions live in `mise.toml`; CI verifies against the full
supported Node range (22, 24, 26).

`pnpm verify` runs formatting/lint checks, strict TypeScript, the full test
suite with 100% coverage thresholds, dual-format builds, both runnable
examples, `publint`, Are The Types Wrong, and package-content/runtime checks.

Useful individual commands:

```sh
pnpm test             # fast behavior suite
pnpm test:watch       # local watch mode
pnpm coverage         # tests plus enforced coverage thresholds
pnpm build            # dist/esm and dist/cjs
pnpm package:check    # exports, declarations, packed files, ESM/CJS parity
pnpm audit --prod     # registry-backed production dependency audit
```

## Releases and support

Release Please maintains versions and `CHANGELOG.md` from Conventional
Commits. A release tag triggers a clean verification and npm publication with
provenance. The latest `0.x` release receives fixes; pre-1.0 APIs may evolve,
with breaking changes called out in the changelog.

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Report
security issues privately according to [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Jon Bogaty.
