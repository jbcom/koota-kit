// Scratch-backed event logs — the publish/drain seam between sim systems.
//
// A fixed-timestep sim needs one system to tell another that something HAPPENED,
// not merely that some state now differs. The distinction is load-bearing: a
// system cannot infer an event from state a lower priority band has already
// consumed, so "a demon was struck this tick" has to be published as a fact
// rather than reconstructed from health that has already changed.
//
// Every such log is the same shape: an array under a well-known scratch key,
// appended by the owner, drained by exactly one consumer. Consuming systems
// drain (the log must empty, or a cue plays twice); OBSERVERS — a dev harness, a
// test, a HUD — must peek instead, because a reader that consumes what a consumer
// needs is a race, and whichever runs first wins.
//
// That distinction is why this is a package module rather than a snippet. It was
// re-derived ELEVEN times in one consuming game, and three of those sites had no
// peek at all until an observer silently stole records from the audio bridge and
// the missing sound was misdiagnosed as a missing swing. The pattern is not hard;
// getting it wrong is quiet, and it costs a debugging session every time.

import type { WorldHandle } from "./world.js";

/**
 * A published event log: append here, drain or peek from the other side.
 *
 * Returned as an object rather than loose functions so a system declares its log
 * ONCE at module scope and the key is written in exactly one place. Two string
 * literals for the same log is the typo that produces an event stream nobody
 * receives, and no type checker can catch it.
 */
export type EventLog<T> = {
  /** The scratch key, exposed for debugging and for snapshot tooling. */
  readonly key: string;
  /** Append an event. Called by the system that owns the fact. */
  push: (handle: WorldHandle, event: T) => void;
  /**
   * Take every event and EMPTY the log — for the single consuming system.
   *
   * If two systems both need the same events, that is a design question and not
   * a reason to drain twice: publish two logs, or have the second peek. A log
   * drained by two consumers delivers each event to whichever ran first.
   */
  drain: (handle: WorldHandle) => T[];
  /**
   * Read every event WITHOUT emptying — for observers: harnesses, tests, HUDs.
   *
   * Returns a readonly copy, so a caller cannot mutate the live array and
   * cannot hold a reference that changes underneath them.
   */
  peek: (handle: WorldHandle) => readonly T[];
  /** Drop everything without reading. For run teardown and test setup. */
  clear: (handle: WorldHandle) => void;
  /** How many events are pending, without allocating a copy. */
  size: (handle: WorldHandle) => number;
};

/**
 * Declare an event log under `key`.
 *
 * The array is created lazily on first use and lives in `handle.scratch`, so it
 * lifecycles with the world: a new run starts with empty logs and cannot inherit
 * the last one's events. That is not a detail — a log at module scope survives
 * the world that produced it, and stale events replay into a fresh run.
 *
 * Keys should be namespaced by system (`"combat:hits"`, `"voices:events"`) for
 * the same reason trait names are: scratch is one flat map shared by every
 * system in the world.
 */
export function defineEventLog<T>(key: string): EventLog<T> {
  const arrayFor = (handle: WorldHandle): T[] => {
    let log = handle.scratch.get(key) as T[] | undefined;
    if (!log) {
      log = [];
      handle.scratch.set(key, log);
    }
    return log;
  };

  return {
    key,
    push: (handle, event) => {
      arrayFor(handle).push(event);
    },
    drain: (handle) => {
      const log = arrayFor(handle);
      // Copy, then truncate IN PLACE rather than replacing the array: another
      // system may already hold this reference, and swapping in a new array
      // would leave that holder appending into an orphan nobody drains.
      const out = log.slice();
      log.length = 0;
      return out;
    },
    peek: (handle) => arrayFor(handle).slice(),
    clear: (handle) => {
      arrayFor(handle).length = 0;
    },
    size: (handle) => arrayFor(handle).length,
  };
}
