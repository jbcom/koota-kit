// Fixed-step system schedule — the loop that turns "a frame passed" into
// "the sim advanced by whole steps".
//
// A simulation that integrates the frame's own dt drifts with the frame rate:
// a 120 Hz phone and a test that advances three seconds in one call disagree,
// and anything counted in real time (a save every 0.25 s) lands on different
// ticks. A fixed-step schedule removes the frame rate from the sim: the frame's
// dt fills an accumulator, and the sim only ever advances by whole `step`s.
//
// The loop is generic sim plumbing, so it lives here and not in the game: it
// knows nothing about React, a renderer, or what a system does. A renderer's
// frame callback calls `schedule.tick(handle, dt)` and that is the entire
// integration. The accumulator lives in the handle's `scratch`, so it dies with
// the run: a new world starts with nothing owed, and two schedules (or two
// worlds) never share one.

import type { WorldHandle } from "./world.js";
import { advanceClock } from "./world.js";

/**
 * One unit of sim work, run once per fixed step.
 *
 * `dt` is always the schedule's `step`, never the frame's dt, so a system can
 * integrate it without knowing the frame rate. Systems that need randomness
 * should draw from a named substream rather than the handle's positional `rng`,
 * so adding a system does not shift another system's draws.
 */
export type System = (handle: WorldHandle, dt: number) => void;

export type ScheduleOptions = {
  /** Seconds of sim time one step represents. Finite and greater than zero. */
  step: number;
  /**
   * The most steps a single `tick` may run. A safe integer of at least 1. Time
   * owed beyond this is dropped, not carried, so one huge frame dt (a hidden
   * tab returning after a minute) cannot trigger a catch-up storm.
   */
  maxSteps: number;
  /**
   * The `scratch` key holding this schedule's accumulator, for callers who want
   * to namespace it (`"run:schedule"`). Defaults to a key unique to this
   * schedule. Two schedules given the same key share one accumulator.
   */
  key?: string;
};

export type Schedule = {
  readonly step: number;
  readonly maxSteps: number;
  /** The `scratch` key holding this schedule's accumulator on a handle. */
  readonly key: string;
  /**
   * Add `frameDt` seconds to `handle`'s accumulator and run every whole step it
   * now covers, up to `maxSteps`: each step advances the clock by `step`, then
   * calls every system in order with `dt === step`. Returns how many steps ran.
   *
   * A `frameDt` that is negative, `NaN` or infinite counts as `0`, and `0` is a
   * valid pause: no step runs and the clock does not move. Whole steps beyond
   * `maxSteps` are dropped; the sub-step remainder is kept.
   *
   * If a system throws, the steps that had already started are consumed (the
   * clock moved for them) and the rest stay owed, so a retry does not replay
   * time the sim already spent.
   */
  tick: (handle: WorldHandle, frameDt: number) => number;
  /**
   * Seconds currently owed to the next step, in `[0, step)` between ticks.
   * Dividing it by `step` gives the interpolation alpha for a renderer drawing
   * between the previous and current sim state. `0` on a handle that has not
   * ticked.
   */
  remainder: (handle: WorldHandle) => number;
};

let nextScheduleId = 0;
// Keys are process-wide because schedules are declared once at module scope and
// used on many handles. An explicit key may be shared on purpose; a generated
// one must stay private to its schedule.
const claimedKeys = new Set<string>();
const generatedKeys = new Set<string>();

// Float accumulation: 432 frames of 1/144 add up to a hair under 3 s, and
// without a tolerance the sim would owe — and run — one step fewer than the
// same time delivered at 60 Hz. A billionth of a step is far below anything a
// frame clock can resolve, so treating "within it" as whole costs nothing.
const STEP_TOLERANCE = 1e-9;

/**
 * Build a fixed-step schedule over `systems`, run in the order given.
 *
 * ```ts
 * const schedule = createSchedule([intro, stove, mixer, serving], {
 *   step: 1 / 60,
 *   maxSteps: 6,
 * });
 * // once per rendered frame, with the frame's dt:
 * schedule.tick(run, frameDt);
 * ```
 *
 * The systems array is copied; later changes to it do not affect the schedule.
 */
export function createSchedule(
  systems: readonly System[],
  options: ScheduleOptions,
): Readonly<Schedule> {
  if (!Array.isArray(systems)) {
    throw new TypeError("createSchedule: systems must be an array of functions.");
  }
  const { step, maxSteps } = options;
  if (!Number.isFinite(step) || step <= 0) {
    throw new RangeError(
      `createSchedule: step must be finite and greater than zero; received ${step}.`,
    );
  }
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError(
      `createSchedule: maxSteps must be a safe integer of at least 1; received ${maxSteps}.`,
    );
  }
  if (options.key !== undefined && (typeof options.key !== "string" || options.key === "")) {
    throw new TypeError("createSchedule: key must be a non-empty string when provided.");
  }
  const ordered = Object.freeze([...systems]);
  for (const system of ordered) {
    if (typeof system !== "function") {
      throw new TypeError("createSchedule: every system must be a function.");
    }
  }
  let key: string;
  if (options.key === undefined) {
    // Skip any key a caller has already named, so a default never lands on one.
    do {
      key = `schedule:${nextScheduleId++}`;
    } while (claimedKeys.has(key));
    generatedKeys.add(key);
  } else {
    if (generatedKeys.has(options.key)) {
      throw new TypeError(
        `createSchedule: key "${options.key}" is already the generated key of another schedule.`,
      );
    }
    key = options.key;
  }
  claimedKeys.add(key);
  const tolerance = step * STEP_TOLERANCE;

  function read(handle: WorldHandle): number {
    const stored = handle.scratch.get(key);
    if (stored === undefined) return 0;
    if (typeof stored !== "number" || !Number.isFinite(stored) || stored < 0) {
      throw new TypeError(
        `createSchedule: scratch key "${key}" already holds something other than a schedule accumulator.`,
      );
    }
    return stored;
  }

  function tick(handle: WorldHandle, frameDt: number): number {
    const previous = read(handle);
    // A pause (and any frame dt that counts as 0) runs nothing, even if a
    // failed tick left whole steps owed: those wait for a frame that moves time.
    if (!(Number.isFinite(frameDt) && frameDt > 0)) return 0;
    const sum = previous + frameDt;
    // Two huge finite frames can sum past the double range; saturate instead of
    // letting Infinity poison the stored accumulator.
    let owed = Number.isFinite(sum) ? sum : Number.MAX_VALUE;
    let ran = 0;
    try {
      while (owed + tolerance >= step && ran < maxSteps) {
        // The clock moves first, so a step it refuses (an exhausted clock) is
        // never debited. After that the step is spent before any system runs:
        // if one throws, this step's time is gone with the tick it caused.
        advanceClock(handle, step);
        owed = Math.max(0, owed - step);
        ran++;
        for (const system of ordered) system(handle, step);
      }
      if (owed + tolerance >= step) {
        // Capped with whole steps still owed: drop them, keep the fraction.
        owed %= step;
        if (owed + tolerance >= step) owed = 0;
      }
    } finally {
      handle.scratch.set(key, owed);
    }
    return ran;
  }

  return Object.freeze({
    step,
    maxSteps,
    key,
    tick,
    remainder: read,
  });
}
