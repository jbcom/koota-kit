import { describe, expect, it } from "vitest";
import { defineTrait } from "../src/traits/index.js";
import { createSimWorld } from "../src/world.js";

describe("defineTrait AoS-aliasing guard", () => {
  it("accepts primitive-only SoA schemas", () => {
    const T = defineTrait({ count: 0, label: "x", active: true, maybe: null });
    const h = createSimWorld({ gen: "g", events: "e" });
    const e = h.world.spawn(T({ count: 3 }));
    expect(e.get(T)?.count).toBe(3);
    h.world.destroy();
  });

  it("accepts per-field AoS factories and gives each entity its own instance", () => {
    const T = defineTrait({ pos: () => ({ x: 0, y: 0 }) });
    const h = createSimWorld({ gen: "g", events: "e" });
    const e1 = h.world.spawn(T());
    const e2 = h.world.spawn(T());
    const p1 = e1.get(T)?.pos;
    const p2 = e2.get(T)?.pos;
    expect(p1).toBeDefined();
    expect(p1).not.toBe(p2); // no aliasing: distinct object instances
    if (p1) p1.x = 99;
    expect(e2.get(T)?.pos.x).toBe(0); // mutating one entity leaves the other untouched
    h.world.destroy();
  });

  it("accepts a whole-trait AoS factory", () => {
    const T = defineTrait(() => ({ x: 1, y: 2 }));
    const h = createSimWorld({ gen: "g", events: "e" });
    const e = h.world.spawn(T());
    expect(e.get(T)).toEqual({ x: 1, y: 2 });
    h.world.destroy();
  });

  it("throws on a bare object-literal field (the aliasing footgun)", () => {
    expect(() =>
      // @ts-expect-error — SafeSchema maps the object-literal field to `never`
      defineTrait({ storage: { logs: 0, planks: 0 } }),
    ).toThrow(/AoS factory/);
  });

  it("throws on a bare array-literal field", () => {
    expect(() =>
      // @ts-expect-error — SafeSchema maps the array-literal field to `never`
      defineTrait({ items: [] as string[] }),
    ).toThrow(/AoS factory/);
  });
});
