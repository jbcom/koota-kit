// Determinism conformance for the koota entity-id-reuse footgun.
//
// The WorldHandle.seeds doc comment (src/world.ts) states the contract:
// "koota entity ids are not reset between worlds, so iteration-order rng
// draws are non-deterministic across two runs in one process. Derive from
// `seeds.gen`, never a lazy draw." These tests pin (a) the footgun's premise
// against the pinned koota version, and (b) that the recommended
// derive-from-seeds pattern stays deterministic where lazy draws would not.

import { unpackEntity } from "koota";
import { describe, expect, it } from "vitest";
import { createRng, nextU32 } from "../src/rng.js";
import { createSimWorld, trait } from "../src/world.js";

describe("entity-id-reuse footgun (premise)", () => {
  it("a world created while a previous world is still live gets different entity identities", () => {
    // Typical app scenario: a world is replaced (React remount, "new game")
    // without an explicit world.destroy(). koota's world/entity bookkeeping
    // is process-global — the replacement world's entities carry a different
    // worldId, so the packed Entity values differ across the two runs even
    // for an identical seed + spawn sequence.
    const Tag = trait({ v: 0 });
    const a = createSimWorld({ gen: "same", events: "same" });
    const rawA = [a.world.spawn(Tag()), a.world.spawn(Tag()), a.world.spawn(Tag())].map(Number);

    const b = createSimWorld({ gen: "same", events: "same" }); // `a` still live
    const rawB = [b.world.spawn(Tag()), b.world.spawn(Tag()), b.world.spawn(Tag())].map(Number);

    expect(rawB).not.toEqual(rawA);

    b.world.destroy();
    a.world.destroy();
  });

  it("entity destroy+respawn recycles the id with a bumped generation", () => {
    // Within one world, unrelated churn (a temp entity spawned then
    // destroyed) changes the identity bits of later spawns: the recycled
    // slot comes back with generation+1. Two same-seeded runs whose churn
    // history differs therefore disagree on packed Entity values for the
    // "same" logical entity — which is why per-entity randomness must be
    // keyed on stable domain keys derived from seeds.gen, never on entity
    // ids or on lazy draws whose order/count depends on churn history.
    const Tag = trait({ v: 0 });
    const h = createSimWorld({ gen: "same", events: "same" });
    const first = h.world.spawn(Tag());
    const recycledSlot = unpackEntity(first).entityId + 1;
    const tmp = h.world.spawn(Tag());
    expect(unpackEntity(tmp)).toMatchObject({ entityId: recycledSlot, generation: 0 });
    tmp.destroy();
    const respawn = h.world.spawn(Tag());
    expect(unpackEntity(respawn)).toMatchObject({ entityId: recycledSlot, generation: 1 });
    expect(Number(respawn)).not.toBe(Number(tmp));
    h.world.destroy();
  });
});

describe("derive-from-seeds pattern (the fix)", () => {
  it("per-entity streams derived from seeds.gen replay identically across worlds", () => {
    // Simulates two boots of the same world in one process. Per-entity
    // randomness is keyed on a STABLE domain key (e.g. grid coordinates)
    // combined with seeds.gen — never on entity id, never a lazy draw from
    // the shared gen stream in query-iteration order.
    const run = () => {
      const h = createSimWorld({ gen: "world-42", events: "play-0" });
      const out = new Map<string, number>();
      for (const key of ["tile:0,0", "tile:0,1", "tile:5,3"]) {
        const stream = createRng({ gen: `${String(h.seeds.gen)}/${key}`, events: 0 }).gen;
        out.set(key, nextU32(stream));
      }
      h.world.destroy();
      return out;
    };
    expect(run()).toEqual(run());
  });

  it("two handles with the same seeds produce byte-identical stream sequences", () => {
    const a = createSimWorld({ gen: "world-42", events: "play-7" });
    const b = createSimWorld({ gen: "world-42", events: "play-7" });
    const seq = (h: typeof a) => ({
      gen: Array.from({ length: 8 }, () => nextU32(h.rng.gen)),
      events: Array.from({ length: 8 }, () => nextU32(h.rng.events)),
    });
    expect(seq(a)).toEqual(seq(b));
    a.world.destroy();
    b.world.destroy();
  });
});
