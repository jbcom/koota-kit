---
title: Getting started
description: Install koota-kit and apply its deterministic simulation conventions.
---

## Install

```sh
pnpm add koota-kit koota
```

Use Node.js 22 or newer. Install Koota `^0.6.6` in the application: it is a
peer dependency. koota-kit ships native ESM and CommonJS entry points with
format-correct TypeScript declarations.

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
} from "koota-kit";

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
  for (const event of moved.drain(sim)) console.log(event);
  console.log(JSON.stringify(snapshotWorld(sim)));
} finally {
  destroySimWorld(sim);
}
```

Runnable ESM and CommonJS examples are in the
[repository](https://github.com/jbcom/koota-kit/tree/main/examples).

## The conventions

- One handle owns one simulation: it contains a Koota world, a fixed-step
  clock, immutable seeds, independent streams, and a scratch map for derived
  non-serializable state.
- `rng.gen` defines stable world content; `rng.events` defines play history.
  Never share the two streams or key stable randomness to packed entity IDs.
- Object and array trait fields use factories, such as
  `defineTrait({ items: () => [] as string[] })`; bare literals are rejected.
- An event log has one consuming owner. Use `drain` for that system and
  `peek` for HUDs, tools, and tests.

`snapshotWorld` records the clock and RNG streams only. Persist it beside your
own versioned entity/trait data; entity serialization remains application
specific. See the [API reference](../API/) and
[architecture](../ARCHITECTURE/) for exact validation and boundaries.
