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

const box = { id: "box", min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
const world: WalkerWorld = { supports: [], solids: [box] };
const axes = ["x", "y", "z"] as const;

describe("strict same-side slab rejection", () => {
  it.each(axes)("retains closed face contacts and endpoint hits on %s", (axis) => {
    for (const [start, end, hit] of [
      [-1, 0, 0],
      [2, 1, 1],
      [-1, 2, 0],
      [2, -1, 1],
    ] as const) {
      const from = { x: 0.5, y: 0.5, z: 0.5, [axis]: start };
      const to = { x: 0.5, y: 0.5, z: 0.5, [axis]: end };
      expect(querySegmentOcclusion(from, to, world)?.point[axis]).toBe(hit);
    }
    const tangent = { x: 0.5, y: 0.5, z: 0.5, [axis]: 0 };
    expect(querySegmentOcclusion(tangent, tangent, world)?.fraction).toBe(0);
    for (const side of [-1, 2]) {
      const from = { x: 0.5, y: 0.5, z: 0.5, [axis]: side };
      const to = { ...from, [axis]: side + (side < 0 ? -0.5 : 0.5) };
      expect(querySegmentOcclusion(from, to, world)).toBeNull();
    }
  });
  it("does not discard subnormal crossing or long thin-box intersection", () => {
    expect(
      querySegmentOcclusion(
        { x: -Number.MIN_VALUE, y: 0.5, z: 0.5 },
        { x: Number.MIN_VALUE, y: 0.5, z: 0.5 },
        world,
      )?.point.x,
    ).toBe(0);
    const thin = {
      supports: [],
      solids: [
        { ...box, min: { ...box.min, x: 0.1 }, max: { ...box.max, x: 0.10000000000000002 } },
      ],
    };
    expect(
      querySegmentOcclusion({ x: -1e8, y: 0.5, z: 0.5 }, { x: 1e8, y: 0.5, z: 0.5 }, thin)?.point.x,
    ).toBe(0.1);
  });
  it("validates unreachable geometry before rejecting candidates", () => {
    const state: WalkerState = {
      position: { x: 0, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      maxStep: 0.25,
      supportId: "ground",
    };
    const ground = {
      id: "ground",
      minX: -1,
      maxX: 2,
      minZ: -1,
      maxZ: 1,
      y: 0,
      slopeX: 0,
      slopeZ: 0,
    };
    const invalid: WalkerWorld = {
      supports: [ground, { ...ground, id: "far", minX: 100, maxX: 101, slopeX: 2 }],
      solids: [],
    };
    expect(() => queryWalkerPath(state, { x: 1, y: 0, z: 0 }, invalid)).toThrow(RangeError);
    expect(() => advanceWalker(state, { x: 1, z: 0 }, invalid)).toThrow(RangeError);
    expect(() => querySegmentOcclusion(state.position, { x: 1, y: 0, z: 0 }, invalid)).toThrow(
      RangeError,
    );
    const invalidSolid = {
      supports: [ground],
      solids: [{ id: "far", min: { x: 100, y: 0, z: 0 }, max: { x: 99, y: 1, z: 1 } }],
    };
    expect(() => queryWalkerPath(state, { x: 1, y: 0, z: 0 }, invalidSolid)).toThrow(RangeError);
  });
  it("preserves the frozen corpus with distant supported rectangles and solids present", () => {
    const corpus = JSON.parse(
      readFileSync(new URL("./fixtures/walker-v0.13.0-goldens.json", import.meta.url), "utf8"),
    ) as Array<{ state: WalkerState; to: WalkerPoint; world: WalkerWorld }>;
    for (const item of corpus) {
      const far: WalkerWorld = {
        supports: [
          ...item.world.supports,
          {
            id: "far-ground",
            minX: 5e8,
            maxX: 5e8 + 1,
            minZ: -1,
            maxZ: 1,
            y: 0,
            slopeX: 0,
            slopeZ: 0,
          },
          {
            id: "far-z-ground",
            minX: -2e8,
            maxX: 2e8,
            minZ: 5e8,
            maxZ: 5e8 + 1,
            y: 0,
            slopeX: 0,
            slopeZ: 0,
          },
        ],
        solids: [
          ...item.world.solids,
          { id: "far-solid", min: { x: 5e8, y: 0, z: -1 }, max: { x: 5e8 + 1, y: 2, z: 1 } },
        ],
      };
      expect(queryWalkerPath(item.state, item.to, far)).toEqual(
        queryWalkerPath(item.state, item.to, item.world),
      );
      expect(advanceWalker(item.state, { x: 8, z: item.to.z }, far)).toEqual(
        advanceWalker(item.state, { x: 8, z: item.to.z }, item.world),
      );
      expect(querySegmentOcclusion(item.state.position, item.to, far)).toEqual(
        querySegmentOcclusion(item.state.position, item.to, item.world),
      );
    }
  });
});
