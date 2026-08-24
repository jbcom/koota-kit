---
title: koota-kit
description: Deterministic Koota simulation conventions for lifecycle, randomness, traits, and event logs.
---

koota-kit is a small, production-derived convention layer for deterministic
simulations built with [Koota](https://github.com/pmndrs/koota). It gives a
simulation one lifecycle boundary, two independent seeded random streams, safe
object-valued traits, and world-scoped event logs.

It is deliberately **not a game engine**. Koota queries, entities, relations,
and actions stay visible; koota-kit addresses the recurring failure modes
around deterministic lifecycle and state ownership.

## Why use it?

| Problem | koota-kit convention |
| --- | --- |
| World generation changes after unrelated gameplay draws | Separate `gen` and `events` RNG streams |
| A loaded save no longer reproduces the next random result | Byte-exact, JSON-safe RNG snapshots |
| Object state leaks between entities | `defineTrait` requires per-entity factories |
| A HUD or test consumes an event before its real system sees it | Single-consumer `drain`, non-consuming `peek` |
| Replaced worlds retain caches or Koota IDs | `createSimWorld` / idempotent `destroySimWorld` lifecycle |

Start with [Getting started](./getting-started/), then use the
[API reference](./API/) for signatures and the
[architecture notes](./ARCHITECTURE/) for the invariants behind them.
