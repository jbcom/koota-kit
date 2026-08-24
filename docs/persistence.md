---
title: Save and restore simulation headers
description: Persist clocks and deterministic RNG streams without taking ownership of application entities.
---

A `WorldHandle` owns the simulation header, not your game's full save format.
The header contains the simulation clock and both RNG streams. Entities,
traits, relations, inventories, and application migrations remain your data.

## Save a header beside application state

```ts
import { snapshotWorld } from "koota-kit";

const save = {
  version: 1,
  world: snapshotWorld(sim),
  entities: serializeApplicationEntities(sim.world),
};

await writeSave(JSON.stringify(save));
```

Keep an application-owned `version` alongside your entity data. That lets you
migrate your domain schema without making `koota-kit` guess how traits should
be represented.

## Restore atomically

Recreate or load application entities using your own schema, then restore the
header onto the appropriate handle:

```ts
import { restoreWorldHeader } from "koota-kit";

const parsed = JSON.parse(await readSave());
validateApplicationSave(parsed);
restoreApplicationEntities(sim.world, parsed.entities);
restoreWorldHeader(sim, parsed.world);
```

`restoreWorldHeader` validates the complete clock and both ARC4 RNG states
before it changes the handle. A malformed snapshot throws and leaves the
existing clock and streams untouched; callers never receive a half-restored
world.

## What not to persist here

Do not extend a `WorldSnapshot` with entities or trait values. That would blur
the deliberate ownership boundary and couples your persistence format to this
small convention layer. Persist only `snapshotWorld(sim)` as the header, then
keep application data, schema validation, and migrations in the application.

See [deterministic randomness](../determinism/) for stream semantics and the
[architecture notes](../ARCHITECTURE/) for the package boundary.
