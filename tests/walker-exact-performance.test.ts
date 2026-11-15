import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  advanceWalker,
  querySegmentOcclusion,
  queryWalkerPath,
  type WalkerPoint,
  type WalkerState,
  type WalkerWorld,
} from "../src/walker.js";

type Golden = {
  state: WalkerState;
  to: WalkerPoint;
  world: WalkerWorld;
  path: ReturnType<typeof queryWalkerPath>;
  advance: ReturnType<typeof advanceWalker>;
  segment: ReturnType<typeof querySegmentOcclusion>;
};
const goldens = JSON.parse(
  readFileSync(new URL("./fixtures/walker-v0.13.0-goldens.json", import.meta.url), "utf8"),
) as Golden[];

describe("query-owned exact conversion scratch", () => {
  it("preserves released paths/segments and admits only supported axis intervals", () => {
    expect(goldens).toHaveLength(48);
    for (const g of goldens) {
      expect(queryWalkerPath(g.state, g.to, g.world)).toEqual(g.path);
      // This corpus is exactly two coplanar rectangles, with the wall away from the
      // axis itinerary. Its independent analytic oracle stops at the first gap,
      // then permits Z sliding. The frozen old output intentionally remains in the
      // fixture: 0.13.1 incorrectly bridged one-ULP gaps at large coordinates.
      const [left, right] = g.world.supports;
      if (!left || !right) throw new Error("missing corpus support rectangles");
      const gap = left.maxX < right.minX;
      expect(advanceWalker(g.state, { x: 8, z: g.to.z }, g.world)).toEqual({
        state: {
          ...g.state,
          position: { x: gap ? left.maxX : g.to.x, y: 0, z: g.to.z },
          supportId: gap ? left.id : right.id,
        },
        status: gap ? "blocked" : "moved",
        contacts: [],
      });
      expect(querySegmentOcclusion(g.state.position, g.to, g.world)).toEqual(g.segment);
    }
  });
  it("keeps exact nearest hits after the bounded memo fills", () => {
    const world: WalkerWorld = {
      supports: [],
      solids: Array.from({ length: 400 }, (_, i) => ({
        id: `wall-${i}`,
        min: { x: i + 1, y: -1, z: -1 },
        max: { x: i + 1.25, y: 1, z: 1 },
      })),
    };
    const from = { x: 0, y: 0, z: 0 },
      to = { x: 1000, y: 0, z: 0 };
    expect(querySegmentOcclusion(from, to, world)).toEqual({
      id: "wall-0",
      fraction: 0.001,
      point: { x: 1, y: 0, z: 0 },
    });
    expect(querySegmentOcclusion(to, from, world)).toEqual({
      id: "wall-399",
      fraction: (1000 - 400.25) / 1000,
      point: { x: 400.25, y: 0, z: 0 },
    });
  });
  it("does not retain converted coordinates across changed worlds or nested queries", () => {
    const world: WalkerWorld = {
      supports: [],
      solids: [{ id: "wall", min: { x: 2, y: -1, z: -1 }, max: { x: 3, y: 1, z: 1 } }],
    };
    const from = { x: 0, y: 0, z: 0 };
    let nested = 0;
    const to = {
      get x() {
        nested++;
        expect(
          querySegmentOcclusion({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, world)?.point.x,
        ).toBe(3);
        return 10;
      },
      y: 0,
      z: 0,
    };
    expect(querySegmentOcclusion(from, to, world)?.point.x).toBe(2);
    expect(nested).toBeGreaterThan(0);
    const wall = world.solids[0];
    if (!wall) throw new Error("missing controlled wall");
    wall.min.x = 4;
    wall.max.x = 5;
    expect(querySegmentOcclusion(from, { x: 10, y: 0, z: 0 }, world)?.point.x).toBe(4);
  });
});
