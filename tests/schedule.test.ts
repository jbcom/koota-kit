import { describe, expect, it } from "vitest";
import { createSchedule } from "../src/schedule.js";
import type { WorldHandle } from "../src/world.js";
import { createSimWorld, destroySimWorld } from "../src/world.js";

const STEP = 1 / 60;

function world(): WorldHandle {
  return createSimWorld({ gen: "g", events: "e" });
}

describe("createSchedule", () => {
  it("runs every system in declaration order, once per step", () => {
    const h = world();
    const calls: string[] = [];
    const schedule = createSchedule(
      [() => calls.push("a"), () => calls.push("b"), () => calls.push("c")],
      { step: STEP, maxSteps: 6 },
    );

    expect(schedule.tick(h, STEP * 2)).toBe(2);
    expect(calls).toEqual(["a", "b", "c", "a", "b", "c"]);
    destroySimWorld(h);
  });

  it("calls each system with the handle and dt equal to the step, never the frame dt", () => {
    const h = world();
    const seen: Array<[WorldHandle, number]> = [];
    const schedule = createSchedule([(handle, dt) => seen.push([handle, dt])], {
      step: 0.01,
      maxSteps: 10,
    });

    schedule.tick(h, 0.035);
    expect(seen).toHaveLength(3);
    for (const [handle, dt] of seen) {
      expect(handle).toBe(h);
      expect(dt).toBe(0.01);
    }
    destroySimWorld(h);
  });

  it("carries the sub-step remainder across ticks", () => {
    const h = world();
    let runs = 0;
    const schedule = createSchedule([() => runs++], { step: 0.1, maxSteps: 6 });

    expect(schedule.tick(h, 0.06)).toBe(0);
    expect(schedule.remainder(h)).toBeCloseTo(0.06, 12);
    expect(schedule.tick(h, 0.06)).toBe(1); // 0.12 -> one step, 0.02 left
    expect(schedule.remainder(h)).toBeCloseTo(0.02, 12);
    expect(schedule.tick(h, 0.08)).toBe(1); // 0.10 -> exactly one step
    expect(schedule.remainder(h)).toBeCloseTo(0, 12);
    expect(runs).toBe(2);
    destroySimWorld(h);
  });

  it("drops the excess beyond maxSteps instead of carrying a backlog", () => {
    const h = world();
    let runs = 0;
    const schedule = createSchedule([() => runs++], { step: STEP, maxSteps: 6 });

    // A hidden WebView returns after a minute: one huge dt, no catch-up storm.
    expect(schedule.tick(h, 60)).toBe(6);
    expect(runs).toBe(6);
    // The backlog is gone: a normal frame afterwards runs one step, not six more.
    expect(schedule.tick(h, STEP)).toBe(1);
    expect(runs).toBe(7);
    // Nothing whole is left over to leak into later ticks.
    expect(schedule.remainder(h)).toBeLessThan(STEP);
    destroySimWorld(h);
  });

  it("keeps the fractional phase when it drops whole steps", () => {
    const h = world();
    const schedule = createSchedule([() => {}], { step: 0.1, maxSteps: 2 });

    schedule.tick(h, 1.05); // 10 whole steps worth + 0.05; 2 run, rest dropped
    expect(schedule.remainder(h)).toBeCloseTo(0.05, 9);
    destroySimWorld(h);
  });

  it("does not keep a near-whole step as the remainder after a drop", () => {
    const h = world();
    const schedule = createSchedule([() => {}], { step: 0.1, maxSteps: 1 });

    // Three steps owed minus a hair of float error: one runs, the rest are
    // dropped, and a fraction a hair under a step must not survive as a phantom.
    schedule.tick(h, 0.3 - 1e-12);
    expect(schedule.remainder(h)).toBe(0);
    expect(schedule.tick(h, 0.1)).toBe(1);
    destroySimWorld(h);
  });

  it("advances the clock by one tick and one step per step run", () => {
    const h = world();
    const schedule = createSchedule([() => {}], { step: STEP, maxSteps: 6 });

    const ran = schedule.tick(h, STEP * 4);
    expect(ran).toBe(4);
    expect(h.clock.tickIndex).toBe(4);
    expect(h.clock.simSeconds).toBeCloseTo(4 * STEP, 12);
    destroySimWorld(h);
  });

  it("advances the clock before the systems run, so they see the tick they run in", () => {
    const h = world();
    const seenTicks: number[] = [];
    const schedule = createSchedule([(handle) => seenTicks.push(handle.clock.tickIndex)], {
      step: STEP,
      maxSteps: 6,
    });

    schedule.tick(h, STEP * 3);
    expect(seenTicks).toEqual([1, 2, 3]);
    destroySimWorld(h);
  });

  it("is a valid pause at frameDt 0: no steps, clock untouched", () => {
    const h = world();
    let runs = 0;
    const schedule = createSchedule([() => runs++], { step: STEP, maxSteps: 6 });

    expect(schedule.tick(h, 0)).toBe(0);
    expect(runs).toBe(0);
    expect(h.clock).toEqual({ tickIndex: 0, simSeconds: 0 });
    destroySimWorld(h);
  });

  it("treats negative, NaN and infinite frame dt as 0", () => {
    const h = world();
    let runs = 0;
    const schedule = createSchedule([() => runs++], { step: STEP, maxSteps: 6 });

    schedule.tick(h, STEP / 2);
    for (const bad of [-1, -Infinity, Number.NaN, Infinity]) {
      expect(schedule.tick(h, bad)).toBe(0);
      // A bad frame neither runs a step nor disturbs the stored remainder.
      expect(schedule.remainder(h)).toBeCloseTo(STEP / 2, 12);
    }
    expect(runs).toBe(0);
    expect(h.clock.tickIndex).toBe(0);
    destroySimWorld(h);
  });

  it("is deterministic across frame rates: 60 x 1/60 equals 30 x 1/30 equals 120 x 1/120", () => {
    function run(frames: number, frameDt: number) {
      const h = world();
      const log: number[] = [];
      const schedule = createSchedule(
        [
          (handle, dt) => {
            // A system that draws from a named stream and integrates dt.
            log.push(handle.clock.tickIndex, dt);
          },
        ],
        { step: STEP, maxSteps: 6 },
      );
      for (let i = 0; i < frames; i++) schedule.tick(h, frameDt);
      const out = { log, clock: { ...h.clock } };
      destroySimWorld(h);
      return out;
    }

    const at60 = run(60, 1 / 60);
    const at30 = run(30, 1 / 30);
    const at120 = run(120, 1 / 120);
    expect(at60.clock.tickIndex).toBe(60);
    expect(at30).toEqual(at60);
    expect(at120).toEqual(at60);
  });

  it("does not lose a step to float drift over many small frames", () => {
    const h = world();
    let runs = 0;
    const schedule = createSchedule([() => runs++], { step: STEP, maxSteps: 6 });

    // 3 seconds at 144 Hz is 432 frames; the sim owes exactly 180 steps.
    for (let i = 0; i < 432; i++) schedule.tick(h, 1 / 144);
    expect(runs).toBe(180);
    destroySimWorld(h);
  });

  it("keeps its accumulator in the handle's scratch, so it dies with the run", () => {
    const h = world();
    const schedule = createSchedule([() => {}], { step: STEP, maxSteps: 6 });

    schedule.tick(h, STEP * 0.5);
    expect(schedule.remainder(h)).toBeCloseTo(STEP * 0.5, 12);
    expect([...h.scratch.keys()]).toContain(schedule.key);

    h.scratch.clear(); // what destroySimWorld does to a run
    expect(schedule.remainder(h)).toBe(0);
    destroySimWorld(h);
  });

  it("isolates two handles from each other", () => {
    const a = world();
    const b = world();
    let runs = 0;
    const schedule = createSchedule([() => runs++], { step: STEP, maxSteps: 6 });

    schedule.tick(a, STEP * 0.75);
    schedule.tick(b, STEP * 0.75);
    // Each run owes 3/4 of a step; neither borrowed the other's remainder.
    expect(runs).toBe(0);
    expect(schedule.tick(a, STEP * 0.5)).toBe(1);
    expect(schedule.remainder(b)).toBeCloseTo(STEP * 0.75, 12);
    expect(b.clock.tickIndex).toBe(0);
    destroySimWorld(a);
    destroySimWorld(b);
  });

  it("isolates two schedules driving one handle", () => {
    const h = world();
    const fast = createSchedule([() => {}], { step: 0.01, maxSteps: 100 });
    const slow = createSchedule([() => {}], { step: 0.5, maxSteps: 4 });

    expect(fast.key).not.toBe(slow.key);
    fast.tick(h, 0.005);
    slow.tick(h, 0.25);
    expect(fast.remainder(h)).toBeCloseTo(0.005, 12);
    expect(slow.remainder(h)).toBeCloseTo(0.25, 12);
    destroySimWorld(h);
  });

  it("lets a caller namespace the scratch key", () => {
    const h = world();
    const schedule = createSchedule([() => {}], { step: STEP, maxSteps: 6, key: "run:schedule" });

    expect(schedule.key).toBe("run:schedule");
    schedule.tick(h, STEP / 2);
    expect(h.scratch.has("run:schedule")).toBe(true);
    destroySimWorld(h);
  });

  it("refuses a scratch key already holding something that is not its accumulator", () => {
    const h = world();
    h.scratch.set("taken", { not: "a number" });
    const schedule = createSchedule([() => {}], { step: STEP, maxSteps: 6, key: "taken" });

    expect(() => schedule.tick(h, STEP)).toThrow(TypeError);
    expect(h.clock.tickIndex).toBe(0);
    destroySimWorld(h);
  });

  it("keeps the time a failed step consumed: a throwing system does not replay it", () => {
    const h = world();
    let boom = true;
    let runs = 0;
    const schedule = createSchedule(
      [
        () => {
          runs++;
          if (boom) throw new Error("system failed");
        },
      ],
      { step: STEP, maxSteps: 6 },
    );

    expect(() => schedule.tick(h, STEP * 3)).toThrow("system failed");
    expect(runs).toBe(1);
    boom = false;
    // The two steps that never ran are still owed.
    expect(schedule.tick(h, 0)).toBe(2);
    expect(runs).toBe(3);
    destroySimWorld(h);
  });

  it("snapshots its systems: later mutation of the array changes nothing", () => {
    const h = world();
    const calls: string[] = [];
    const systems = [() => calls.push("a")];
    const schedule = createSchedule(systems, { step: STEP, maxSteps: 6 });
    systems.push(() => calls.push("b"));

    schedule.tick(h, STEP);
    expect(calls).toEqual(["a"]);
    destroySimWorld(h);
  });

  it("exposes its configuration", () => {
    const schedule = createSchedule([], { step: STEP, maxSteps: 6 });
    expect(schedule.step).toBe(STEP);
    expect(schedule.maxSteps).toBe(6);
  });

  it("rejects bad configuration before building anything", () => {
    const ok = [() => {}];
    expect(() => createSchedule(ok, { step: 0, maxSteps: 6 })).toThrow(RangeError);
    expect(() => createSchedule(ok, { step: -1, maxSteps: 6 })).toThrow(RangeError);
    expect(() => createSchedule(ok, { step: Number.NaN, maxSteps: 6 })).toThrow(RangeError);
    expect(() => createSchedule(ok, { step: Infinity, maxSteps: 6 })).toThrow(RangeError);
    expect(() => createSchedule(ok, { step: STEP, maxSteps: 0 })).toThrow(RangeError);
    expect(() => createSchedule(ok, { step: STEP, maxSteps: 1.5 })).toThrow(RangeError);
    expect(() => createSchedule(ok, { step: STEP, maxSteps: Infinity })).toThrow(RangeError);
    expect(() => createSchedule(ok, { step: STEP, maxSteps: 6, key: "" })).toThrow(TypeError);
    expect(() => createSchedule([42 as never], { step: STEP, maxSteps: 6 })).toThrow(TypeError);
    expect(() => createSchedule(null as never, { step: STEP, maxSteps: 6 })).toThrow(TypeError);
  });
});
