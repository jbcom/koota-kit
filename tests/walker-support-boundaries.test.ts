import { describe, expect, it } from "vitest";
import {
  advanceWalker,
  queryWalkerSupport,
  type WalkerState,
  type WalkerWorld,
} from "../src/walker.js";

const floor = { id: "ground", minX: 0, maxX: 48, minZ: 0, maxZ: 32, y: 0, slopeX: 0, slopeZ: 0 };
const world: WalkerWorld = { supports: [floor], solids: [] };
const actor = (x: number, z: number): WalkerState => ({
  position: { x, y: 0, z },
  halfWidth: 0.3,
  height: 2.1,
  maxStep: 0.25,
  supportId: "ground",
});

describe("literal continuous support boundaries", () => {
  it("retains the exact zero edge in the captured decimal displacement and permits tangential motion", () => {
    const start = actor(0.013485608845335381, 12.323638789216345);
    const displacement = { x: -0.04464686048024068, z: 0.037542450999311444 };
    const result = advanceWalker(start, displacement, world);
    expect(result.state.position).toEqual({ x: 0, y: 0, z: start.position.z + displacement.z });
    expect(result.status).toBe("blocked");
    expect(queryWalkerSupport(result.state, world)).toEqual({ id: "ground", y: 0 });
  });
  it.each(["x", "z"] as const)("keeps the literal minimum and maximum on axis %s", (axis) => {
    for (const [edge, offset, distance] of [
      [0, 0.00031, -1 / 60],
      [axis === "x" ? 48 : 32, -0.00031, 1 / 60],
    ] as const) {
      const state = actor(16, 16);
      state.position[axis] = edge + offset;
      const result = advanceWalker(
        state,
        { x: axis === "x" ? distance : 0, z: axis === "z" ? distance : 0 },
        world,
      );
      expect(result.state.position[axis]).toBe(edge);
      expect(result.status).toBe("blocked");
      expect(queryWalkerSupport(result.state, world)).not.toBeNull();
    }
  });
  it("does not bridge an unsupported interval whose midpoint rounds onto a boundary", () => {
    const left = 0.1,
      right = 0.10000000000000002;
    expect((left + right) / 2 === left || (left + right) / 2 === right).toBe(true);
    const gap: WalkerWorld = {
      supports: [
        { ...floor, id: "left", minX: -1, maxX: left },
        { ...floor, id: "right", minX: right, maxX: 2 },
      ],
      solids: [],
    };
    const result = advanceWalker(actor(0, 16), { x: 1, z: 0 }, gap);
    expect(result.state.position.x).toBe(left);
    expect(result.status).toBe("blocked");
    expect(queryWalkerSupport(result.state, gap)).toEqual({ id: "left", y: 0 });
  });
  it("leaves an unrepresentable displacement at the current supported point", () => {
    const state = actor(1, 16);
    expect(advanceWalker(state, { x: Number.MIN_VALUE, z: 0 }, world).state.position).toEqual(
      state.position,
    );
  });
  it("orders distinct support planes even when their fractional parameters round equal", () => {
    const left = 0.1,
      right = 0.10000000000000002;
    expect((left + 1e8) / 2e8).toBe((right + 1e8) / 2e8);
    const gap: WalkerWorld = {
      supports: [
        { ...floor, id: "left", minX: -1e8, maxX: left },
        { ...floor, id: "right", minX: right, maxX: 1e8 },
      ],
      solids: [],
    };
    expect(advanceWalker(actor(-1e8, 16), { x: 2e8, z: 0 }, gap).state.position.x).toBe(left);
    expect(advanceWalker(actor(1e8, 16), { x: -2e8, z: 0 }, gap).state.position.x).toBe(right);
  });
});
