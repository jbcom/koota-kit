---
title: Deterministic randomness
description: Keep generated worlds stable while runtime decisions evolve independently.
---

`koota-kit` provides two streams because a simulation has two different kinds
of random decision. Treating them as one stream makes unrelated gameplay alter
the world that a seed is supposed to describe.

## Assign each decision to a stream

Use `sim.rng.gen` for decisions that define the world's stable identity:

- terrain, room layout, and initial spawn placement;
- procedural content derived at load time;
- stable cosmetic variants keyed by a domain identifier.

Use `sim.rng.events` for decisions driven by a particular playthrough:

- combat rolls, runtime spawns, weather, and AI choices;
- any draw whose count can change as the player acts;
- replay state that should resume from a save.

```ts
import { createSimWorld, nextFloat, nextInt } from "koota-kit";

const sim = createSimWorld({ gen: "world:river-valley", events: "run:42" });

const treeDensity = nextFloat(sim.rng.gen); // stable map content
const damage = nextInt(sim.rng.events, 4, 9); // this playthrough only
```

Consuming `events` never changes the next `gen` result, and vice versa.

## Derive local streams from stable keys

Do not use packed Koota entity IDs as a random seed, and do not consume a
shared stream while iterating a query. Entity IDs include process-global and
generation data; query order and entity churn can differ between runs.

Instead, derive a temporary stream from the immutable generation seed and a
stable domain key such as grid coordinates, a authored ID, or a content key:

```ts
import { createRng, nextU32 } from "koota-kit/rng";

function tileVariant(worldSeed: string | number, x: number, y: number) {
  const local = createRng({ gen: `${String(worldSeed)}/tile:${x},${y}`, events: 0 });
  return nextU32(local.gen) % 4;
}

const variant = tileVariant(sim.seeds.gen, 12, 8);
```

This makes the tile's result independent of entity allocation, query order,
and how many runtime events have happened.

## Preserve draw positions

All public draw helpers validate before drawing. Invalid bounds or
probabilities throw without advancing the stream. Valid `chance` calls always
draw once, including `chance(stream, 0)` and `chance(stream, 1)`, so later
draw positions remain predictable.

Use half-open integer bounds: `nextInt(stream, 1, 7)` can produce `1` through
`6`, never `7`. Bounds must be safe integers and the range may not exceed
`2 ** 32` values.

For exact signatures and error behaviour, see the [API reference](../API/).
