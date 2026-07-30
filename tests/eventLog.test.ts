import { describe, expect, it } from "vitest";
import { defineEventLog } from "../src/eventLog.js";
import { createSimWorld } from "../src/world.js";

type Hit = { target: string; damage: number };

const seeds = { gen: "test:gen", events: "test:events" };
const hits = defineEventLog<Hit>("test:hits");

function world() {
  return createSimWorld(seeds);
}

describe("event log", () => {
  it("publishes and drains in order", () => {
    const h = world();
    hits.push(h, { target: "a", damage: 1 });
    hits.push(h, { target: "b", damage: 2 });
    expect(hits.drain(h)).toEqual([
      { target: "a", damage: 1 },
      { target: "b", damage: 2 },
    ]);
  });

  it("CRITICAL: drain EMPTIES the log — a cue must not play twice", () => {
    const h = world();
    hits.push(h, { target: "a", damage: 1 });
    expect(hits.drain(h)).toHaveLength(1);
    expect(hits.drain(h)).toEqual([]);
  });

  it("CRITICAL: peek does NOT consume — an observer must not starve a consumer", () => {
    // The failure this exists to prevent: a dev harness read the same log the
    // audio bridge drains, so whichever ran first won and the other saw nothing.
    // The empty read was misdiagnosed as a missing swing.
    const h = world();
    hits.push(h, { target: "a", damage: 1 });
    expect(hits.peek(h)).toHaveLength(1);
    expect(hits.peek(h)).toHaveLength(1);
    // ...and the real consumer still gets it.
    expect(hits.drain(h)).toHaveLength(1);
  });

  it("peek returns a COPY — a caller cannot mutate the live log", () => {
    const h = world();
    hits.push(h, { target: "a", damage: 1 });
    const seen = hits.peek(h) as Hit[];
    seen.push({ target: "forged", damage: 99 });
    expect(hits.size(h)).toBe(1);
    expect(hits.drain(h)).toEqual([{ target: "a", damage: 1 }]);
  });

  it("CRITICAL: drain truncates in place, so a held reference stays live", () => {
    // Replacing the array instead of truncating leaves any system that already
    // captured the reference appending into an orphan nobody drains — an event
    // stream that silently stops arriving.
    const h = world();
    hits.push(h, { target: "a", damage: 1 });
    const captured = h.scratch.get(hits.key) as Hit[];
    hits.drain(h);
    hits.push(h, { target: "b", damage: 2 });
    // the SAME array object received the new event
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({ target: "b", damage: 2 });
    expect(h.scratch.get(hits.key)).toBe(captured);
  });

  it("logs live on the WORLD — a new world starts empty", () => {
    // A log at module scope survives the world that produced it and replays
    // stale events into a fresh run.
    const a = world();
    hits.push(a, { target: "a", damage: 1 });
    const b = world();
    expect(hits.peek(b)).toEqual([]);
    expect(hits.peek(a)).toHaveLength(1);
  });

  it("two logs with different keys do not collide", () => {
    const other = defineEventLog<Hit>("test:other");
    const h = world();
    hits.push(h, { target: "a", damage: 1 });
    other.push(h, { target: "b", damage: 2 });
    expect(hits.peek(h)).toHaveLength(1);
    expect(other.peek(h)).toHaveLength(1);
  });

  it("clear and size work without allocating a read", () => {
    const h = world();
    expect(hits.size(h)).toBe(0);
    hits.push(h, { target: "a", damage: 1 });
    hits.push(h, { target: "b", damage: 2 });
    expect(hits.size(h)).toBe(2);
    hits.clear(h);
    expect(hits.size(h)).toBe(0);
  });

  it("exposes its key for debugging and snapshot tooling", () => {
    expect(hits.key).toBe("test:hits");
  });
});
