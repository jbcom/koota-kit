---
title: Event ownership and observation
description: Publish simulation facts once, consume them once, and observe without starving the owner.
---

Event logs communicate facts that occurred during simulation: a hit landed, a
door opened, a command completed. They are not a replacement for component
state. A log has exactly one consuming owner.

## Declare logs once

Create a log at module scope and give it a namespaced key. The events
themselves live in each world's `scratch` map, so starting a new world never
replays an old world's events.

```ts
import { defineEventLog } from "koota-kit/eventLog";

export const combatHits = defineEventLog<{
  attacker: string;
  target: string;
  damage: number;
}>("combat:hits");
```

Use distinct logs when two systems need independent consuming ownership. Two
calls to `drain` on the same log create a race: whichever system runs first
gets the events.

## Publish and consume

The producing system appends facts. The owning system drains them once:

```ts
combatHits.push(sim, { attacker: "scout", target: "slime", damage: 3 });

for (const hit of combatHits.drain(sim)) {
  playHitSound(hit);
}
```

`drain` returns a detached copy and empties the live array in place. In-place
truncation matters: a system that already holds an internal reference will not
append into an orphaned queue.

## Observe without consuming

HUDs, test harnesses, debug tools, and telemetry should use `peek`:

```ts
const pendingHits = combatHits.peek(sim); // detached readonly copy
console.table(pendingHits);

// The audio system can still consume every event.
combatHits.drain(sim);
```

`size` is a non-allocating count and `clear` discards pending records. Empty
reads do not allocate a scratch entry. A key collision with a non-array scratch
cache throws immediately, so namespace scratch keys by the system that owns
them.
