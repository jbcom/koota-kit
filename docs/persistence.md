---
title: Save and restore simulation headers
description: Persist clocks and deterministic RNG streams without taking ownership of application entities.
---

A `WorldHandle` owns the simulation header, not your game's full save format.
The header contains the simulation clock and both RNG streams. Its immutable
seeds are deliberately separate: they identify the world and are needed to
construct a fresh handle before a header can be restored. Entities, traits,
relations, inventories, and application migrations remain your data.

## Save a header beside application state

```ts
import { snapshotWorld } from "koota-kit";

const save = {
  version: 1,
  seeds: sim.seeds,
  header: snapshotWorld(sim),
  entities: serializeApplicationEntities(sim.world),
};

await writeSave(JSON.stringify(save));
```

Persist `sim.seeds` with every save: a restored header resumes stream positions
but does not replace `sim.seeds`, which systems may use for stable derived
randomness. Keep an application-owned `version` alongside your entity data.
That lets you migrate your domain schema without making `koota-kit` guess how
traits should be represented.

## Restore atomically

Stage a fresh handle, restore application entities into it, then restore the
header. Do not load over a live handle: its scratch map may contain stale event
logs or derived caches from the previous timeline.

```ts
import { createSimWorld, destroySimWorld, restoreWorldHeader } from "koota-kit";

const parsed = JSON.parse(await readSave());
validateApplicationSave(parsed);

function stageLoadedWorld(save: typeof parsed) {
  const loaded = createSimWorld(save.seeds);
  try {
    restoreApplicationEntities(loaded.world, save.entities);
    restoreWorldHeader(loaded, save.header);
    return loaded;
  } catch (error) {
    destroySimWorld(loaded);
    throw error;
  }
}

let activeSim = sim;
const next = stageLoadedWorld(parsed);
destroySimWorld(activeSim); // only after staging completed successfully
activeSim = next;
```

`restoreWorldHeader` validates the complete clock and both ARC4 RNG states
before it changes the handle. A malformed snapshot throws and leaves the
staged handle untouched; callers never receive a half-restored world. Switch
the application's active handle only after all application validation and
restoration succeeds.

## What not to persist here

Do not extend a `WorldSnapshot` with entities or trait values. That would blur
the deliberate ownership boundary and couples your persistence format to this
small convention layer. Persist only `snapshotWorld(sim)` as the header, then
keep application data, schema validation, and migrations in the application.

See [deterministic randomness](../determinism/) for stream semantics and the
[architecture notes](../ARCHITECTURE/) for the package boundary.
