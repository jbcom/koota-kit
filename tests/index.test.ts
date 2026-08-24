// Exercises the package's ROOT entry point (`"."` in package.json's
// `exports` map) — what `import ... from "@jbdevprimary/koota-kit"` actually
// resolves to. The subpath tests (world.test.ts, rng.test.ts, etc.) import
// straight from `../src/*.js` and never touch this barrel, so without this
// file `src/index.ts` — the entry point most consumers use — has zero
// coverage: a re-export dropped or misspelled here would ship silently.
//
// Assertions are wiring checks, not re-tests of behavior already covered
// elsewhere: every name promised by the root export is (a) present and
// (b) the SAME function/value as its subpath source, so there is no
// accidental second copy or stale re-export.

import { describe, expect, it } from "vitest";
import * as eventLogModule from "../src/eventLog.js";
import * as indexModule from "../src/index.js";
import * as rngModule from "../src/rng.js";
import * as traitsModule from "../src/traits/index.js";
import * as worldModule from "../src/world.js";

describe("root barrel (src/index.ts) re-exports", () => {
  it("re-exports every world.js value by identity", () => {
    expect(indexModule.createSimWorld).toBe(worldModule.createSimWorld);
    expect(indexModule.destroySimWorld).toBe(worldModule.destroySimWorld);
    expect(indexModule.advanceClock).toBe(worldModule.advanceClock);
    expect(indexModule.snapshotWorld).toBe(worldModule.snapshotWorld);
    expect(indexModule.restoreWorldHeader).toBe(worldModule.restoreWorldHeader);
    expect(indexModule.createActions).toBe(worldModule.createActions);
    expect(indexModule.relation).toBe(worldModule.relation);
    expect(indexModule.trait).toBe(worldModule.trait);
  });

  it("re-exports every rng.js value by identity", () => {
    expect(indexModule.createRng).toBe(rngModule.createRng);
    expect(indexModule.nextU32).toBe(rngModule.nextU32);
    expect(indexModule.nextFloat).toBe(rngModule.nextFloat);
    expect(indexModule.nextInt).toBe(rngModule.nextInt);
    expect(indexModule.chance).toBe(rngModule.chance);
    expect(indexModule.snapshotStream).toBe(rngModule.snapshotStream);
    expect(indexModule.restoreStream).toBe(rngModule.restoreStream);
    expect(indexModule.snapshotLayers).toBe(rngModule.snapshotLayers);
    expect(indexModule.restoreLayers).toBe(rngModule.restoreLayers);
  });

  it("re-exports defineEventLog from eventLog.js by identity", () => {
    expect(indexModule.defineEventLog).toBe(eventLogModule.defineEventLog);
  });

  it("re-exports defineTrait from traits/index.js by identity", () => {
    expect(indexModule.defineTrait).toBe(traitsModule.defineTrait);
  });

  it("drives a full create -> spawn -> rng -> event log -> snapshot cycle through ONLY the root barrel", () => {
    // A consumer importing solely from "@jbdevprimary/koota-kit" (not a subpath)
    // must be able to do everything the README's usage example does.
    const Town = indexModule.defineTrait({
      name: "",
      population: 0,
      storage: () => ({ logs: 0, planks: 0 }),
    });
    const BelongsTo = indexModule.relation();
    const spawns = indexModule.defineEventLog<{ name: string }>("index-test:spawns");

    const h = indexModule.createSimWorld({ gen: "root-gen", events: "root-events" });
    const town = h.world.spawn(Town({ name: "Riverside" }));
    h.world.spawn(Town(), BelongsTo(town));
    spawns.push(h, { name: "Riverside" });

    indexModule.advanceClock(h, 1 / 60);
    const roll = indexModule.nextFloat(h.rng.events);
    expect(roll).toBeGreaterThanOrEqual(0);
    expect(roll).toBeLessThan(1);

    expect(town.get(Town)?.storage).toEqual({ logs: 0, planks: 0 });
    expect(spawns.drain(h)).toEqual([{ name: "Riverside" }]);

    const snap = indexModule.snapshotWorld(h);
    indexModule.advanceClock(h, 1 / 60);
    indexModule.restoreWorldHeader(h, snap);
    expect(h.clock.tickIndex).toBe(1);
    indexModule.destroySimWorld(h);
  });
});
