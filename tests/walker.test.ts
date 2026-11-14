import { describe, expect, it } from "vitest";
import {
  advanceWalker,
  querySegmentOcclusion,
  queryWalkerSupport,
  queryWalkerPath,
  type WalkerState,
  type WalkerWorld,
} from "../src/walker.js";
import { createSchedule } from "../src/schedule.js";
import { createSimWorld, destroySimWorld } from "../src/world.js";
const state: WalkerState = {
  position: { x: 0, y: 0, z: 0 },
  halfWidth: 0.3,
  height: 1.8,
  maxStep: 0.25,
  supportId: "ground",
};
const ground = {
  id: "ground",
  minX: -10,
  maxX: 10,
  minZ: -10,
  maxZ: 10,
  y: 0,
  slopeX: 0,
  slopeZ: 0,
};
const world: WalkerWorld = { supports: [ground], solids: [] };
const wall = { id: "wall", min: { x: 1, y: 0, z: -10 }, max: { x: 1.1, y: 3, z: 10 } };
describe("grounded walker", () => {
  it("sweeps thin walls and slides without body penetration", () => {
    const result = advanceWalker(state, { x: 3, z: 2 }, { ...world, solids: [wall] });
    expect(result.state.position.x).toBeCloseTo(0.7);
    expect(result.state.position.z).toBe(2);
    expect(result.contacts).toEqual(["wall"]);
  });
  it("passes a one metre passage with a 0.6 metre body", () => {
    const solids = [-1, 1].map((side) => ({
      id: `${side}`,
      min: { x: side < 0 ? -2 : 0.5, y: 0, z: -2 },
      max: { x: side < 0 ? -0.5 : 2, y: 3, z: 2 },
    }));
    expect(
      advanceWalker(
        { ...state, position: { x: 0, y: 0, z: -3 } },
        { x: 0, z: 6 },
        { ...world, solids },
      ).state.position.z,
    ).toBe(3);
  });
  it("ascends and descends steps and refuses insufficient headroom", () => {
    const supports = [
      { ...ground, maxX: 1 },
      { ...ground, id: "step", minX: 1, maxX: 2, y: 0.2 },
      { ...ground, id: "landing", minX: 2, y: 0.4 },
    ];
    const stairs = { supports, solids: [] };
    const top = advanceWalker(state, { x: 3, z: 0 }, stairs);
    expect(top.state.position).toEqual({ x: 3, y: 0.4, z: 0 });
    expect(advanceWalker(top.state, { x: -3, z: 0 }, stairs).state.position).toEqual(
      state.position,
    );
    const ceiling = { id: "ceiling", min: { x: 0.8, y: 1.9, z: -2 }, max: { x: 4, y: 2.1, z: 2 } };
    expect(
      advanceWalker(state, { x: 3, z: 0 }, { supports, solids: [ceiling] }).state.position.x,
    ).toBeLessThanOrEqual(1);
  });
  it("refuses absent, blocked, or unreachable support", () => {
    expect(queryWalkerSupport(state, { supports: [], solids: [] })).toBeNull();
    expect(advanceWalker(state, { x: 2, z: 0 }, { supports: [], solids: [] }).status).toBe(
      "invalid-support",
    );
    expect(
      queryWalkerSupport(
        { ...state, position: { x: 1, y: 0, z: 0 } },
        { ...world, solids: [wall] },
      ),
    ).toBeNull();
    expect(
      advanceWalker(
        state,
        { x: 3, z: 0 },
        {
          supports: [
            { ...ground, maxX: 1 },
            { ...ground, id: "high", minX: 1, y: 2 },
          ],
          solids: [],
        },
      ).state.position.x,
    ).toBeLessThanOrEqual(1);
  });
  it("uses stable IDs for equal hits regardless of world order", () => {
    const solids = [wall, { ...wall, id: "aaa" }];
    const from = { x: 0, y: 1, z: 0 },
      to = { x: 2, y: 1, z: 0 };
    expect(querySegmentOcclusion(from, to, { ...world, solids })?.id).toBe("aaa");
    expect(querySegmentOcclusion(from, to, { ...world, solids: [...solids].reverse() })?.id).toBe(
      "aaa",
    );
  });
  it("is identical at 30, 60 and 120 Hz when advanced on fixed ticks", () => {
    const results = [30, 60, 120].map((hz) => {
      let current = state;
      const handle = createSimWorld({ gen: "walker", events: "events" });
      const schedule = createSchedule(
        [
          () => {
            current = advanceWalker(
              current,
              { x: 0.01, z: 0.005 },
              { ...world, solids: [wall] },
            ).state;
          },
        ],
        { step: 1 / 60, maxSteps: 4 },
      );
      for (let frame = 0; frame < hz * 2; frame++) schedule.tick(handle, 1 / hz);
      expect(handle.clock.tickIndex).toBe(120);
      expect(current.position.z).toBeCloseTo(0.6);
      destroySimWorld(handle);
      return current;
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });
});

describe("walker numeric and boundary policy", () => {
  it("rejects invalid numbers, dimensions, identities and geometry without mutation", () => {
    const original = JSON.stringify({ state, world });
    for (const bad of [NaN, Infinity, -Infinity, 1e10])
      expect(() => advanceWalker(state, { x: bad, z: 0 }, world)).toThrow(RangeError);
    for (const change of [{ halfWidth: 0 }, { height: 0 }, { maxStep: -1 }])
      expect(() => queryWalkerSupport({ ...state, ...change }, world)).toThrow(RangeError);
    for (const supports of [[{ ...ground, id: "" }], [ground, ground]])
      expect(() => queryWalkerSupport(state, { supports, solids: [] })).toThrow(TypeError);
    expect(() =>
      queryWalkerSupport(state, { ...world, solids: [{ ...wall, max: wall.min }] }),
    ).toThrow(RangeError);
    for (const change of [{ maxX: -10 }, { maxZ: -10 }, { slopeX: 2 }])
      expect(() =>
        queryWalkerSupport(state, { supports: [{ ...ground, ...change }], solids: [] }),
      ).toThrow(RangeError);
    expect(JSON.stringify({ state, world })).toBe(original);
  });
  it("resolves overlapping support heights and equal-height IDs deterministically", () => {
    const supports = [
      { ...ground, id: "z" },
      { ...ground, id: "a" },
      { ...ground, id: "upper", y: 4 },
    ];
    expect(queryWalkerSupport(state, { supports, solids: [] })).toEqual({ id: "a", y: 0 });
    expect(queryWalkerSupport(state, { supports: [...supports].reverse(), solids: [] })).toEqual({
      id: "a",
      y: 0,
    });
    expect(
      advanceWalker({ ...state, supportId: null }, { x: 0, z: 0 }, { supports, solids: [] }).state
        .supportId,
    ).toBe("a");
  });
  it("blocks narrow support gaps without tunnelling and stays at the last supported edge", () => {
    const supports = [
      { ...ground, maxX: 1 },
      { ...ground, id: "far", minX: 1.001 },
    ];
    const result = advanceWalker(state, { x: 8, z: 0 }, { supports, solids: [] });
    expect(result.state.position).toEqual({ x: 1, y: 0, z: 0 });
    expect(result.status).toBe("blocked");
    expect(queryWalkerSupport(result.state, { supports, solids: [] })).not.toBeNull();
  });
  it("follows inclined surfaces and sweeps headroom over the entire ascent", () => {
    const ramp = { ...ground, minX: 0, minZ: -2, maxZ: 2, slopeX: 0.5 };
    const roof = { id: "roof", min: { x: 2, y: 2.5, z: -1 }, max: { x: 3, y: 2.6, z: 1 } };
    expect(
      advanceWalker(state, { x: 4, z: 0 }, { supports: [ramp], solids: [] }).state.position.y,
    ).toBe(2);
    const blocked = advanceWalker(state, { x: 4, z: 0 }, { supports: [ramp], solids: [roof] });
    expect(blocked.status).toBe("blocked");
    expect(blocked.state.position.x).toBeCloseTo(1.7);
    expect(blocked.state.position.y).toBeCloseTo(0.85);
  });
  it("uses closed occlusion segments, with stable nearest hits and no imaginary support occlusion", () => {
    const boxes = {
      ...world,
      solids: [
        wall,
        { ...wall, id: "near", min: { ...wall.min, x: 0.5 }, max: { ...wall.max, x: 0.6 } },
      ],
    };
    expect(querySegmentOcclusion({ x: 0, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }, boxes)?.id).toBe(
      "near",
    );
    expect(
      querySegmentOcclusion(
        { x: 0, y: 1, z: 0 },
        { x: 3, y: 1, z: 0 },
        { ...boxes, solids: [...boxes.solids].reverse() },
      )?.id,
    ).toBe("near");
    expect(querySegmentOcclusion({ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, boxes)?.fraction).toBe(
      0,
    );
    expect(
      querySegmentOcclusion({ x: 0, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0 }, boxes)?.fraction,
    ).toBe(1);
    expect(querySegmentOcclusion({ x: 0, y: 1, z: 0 }, { x: -3, y: 1, z: 0 }, boxes)).toBeNull();
    expect(querySegmentOcclusion({ x: 0, y: 4, z: 0 }, { x: 3, y: 4, z: 0 }, boxes)).toBeNull();
    expect(querySegmentOcclusion({ x: 0, y: -1, z: 0 }, { x: 3, y: -1, z: 0 }, boxes)).toBeNull();
    expect(querySegmentOcclusion({ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }, world)).toBeNull();
  });
  it("does not mutate caller data or return caller-owned position objects", () => {
    const before = JSON.stringify({ state, world });
    const result = advanceWalker(state, { x: 0.1, z: -0.1 }, world);
    result.state.position.x = 42;
    expect(JSON.stringify({ state, world })).toBe(before);
  });
});

describe("swept body invariants", () => {
  it("never crosses a thin solid, even with a large displacement", () => {
    const thin = { id: "thin", min: { x: 1, y: 0, z: -2 }, max: { x: 1.000001, y: 3, z: 2 } };
    const large = { supports: [{ ...ground, maxX: 1e8 }], solids: [thin] };
    expect(advanceWalker(state, { x: 1e7, z: 0 }, large).state.position.x).toBeCloseTo(0.7);
  });
  it("keeps full body clearance across repeated signed movement and corner contacts", () => {
    const solids = [
      { id: "east", min: { x: 2, y: 0, z: -5 }, max: { x: 3, y: 4, z: 5 } },
      { id: "west", min: { x: -3, y: 0, z: -5 }, max: { x: -2, y: 4, z: 5 } },
      { id: "north", min: { x: -5, y: 0, z: 2 }, max: { x: 5, y: 4, z: 3 } },
      { id: "south", min: { x: -5, y: 0, z: -3 }, max: { x: 5, y: 4, z: -2 } },
    ];
    let current = state;
    for (let i = 0; i < 200; i++) {
      const movement = { x: (((i * 17) % 23) - 11) / 3, z: (((i * 31) % 19) - 9) / 3 };
      const result = advanceWalker(current, movement, { ...world, solids });
      const reverseOrder = advanceWalker(current, movement, {
        ...world,
        solids: [...solids].reverse(),
      });
      expect(result).toEqual(reverseOrder);
      current = result.state;
      expect(Math.abs(current.position.x) + current.halfWidth).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(current.position.z) + current.halfWidth).toBeLessThanOrEqual(2 + 1e-9);
      expect(queryWalkerSupport(current, { ...world, solids })).not.toBeNull();
    }
  });
});

describe("straight walker paths", () => {
  it("rejects an unsupported diagonal even when both axis legs are walkable", () => {
    const start = { ...state, position: { x: 0.5, y: 0, z: 0.5 } };
    const target = { x: 3.5, y: 0, z: 3.5 };
    const lWorld = {
      supports: [
        { ...ground, id: "horizontal", minX: 0, maxX: 4, minZ: 0, maxZ: 1 },
        { ...ground, id: "vertical", minX: 3, maxX: 4, minZ: 0, maxZ: 4 },
      ],
      solids: [],
    };
    expect(advanceWalker(start, { x: 3, z: 3 }, lWorld).status).toBe("moved");
    expect(queryWalkerPath(start, target, lWorld).walkable).toBe(false);
  });
  it("accepts an exact decimal target without relying on subtraction-addition identity", () => {
    const start = { ...state, position: { x: 8, y: 0, z: 8 } };
    const target = { x: 0.1, y: 0, z: 8 };
    expect(start.position.x + (target.x - start.position.x)).not.toBe(target.x);
    const result = queryWalkerPath(start, target, {
      ...world,
      supports: [{ ...ground, minX: 0.1 }],
    });
    expect(result.walkable).toBe(true);
    expect(result.state.position).toEqual(target);
  });
  it("never turns endpoint tolerance into support-gap tolerance", () => {
    const gapWorld = {
      ...world,
      supports: [
        { ...ground, maxX: 1 },
        { ...ground, id: "far", minX: 1 + 1e-10 },
      ],
    };
    expect(queryWalkerPath(state, { x: 2, y: 0, z: 2 }, gapWorld).walkable).toBe(false);
  });
});

describe("straight path certification boundaries", () => {
  it("sweeps diagonal body clearance rather than an unexpanded point ray", () => {
    const diagonalWorld = {
      ...world,
      solids: [{ id: "corner", min: { x: 1, y: 0, z: 1.2 }, max: { x: 1.1, y: 3, z: 2 } }],
    };
    const target = { x: 3, y: 0, z: 3 };
    expect(
      querySegmentOcclusion({ x: 0, y: 1, z: 0 }, { ...target, y: 1 }, diagonalWorld),
    ).toBeNull();
    const result = queryWalkerPath(state, target, diagonalWorld);
    expect(result.walkable).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.contacts).toEqual(["corner"]);
    expect(result.state.position.x).toBeCloseTo(0.9);
    expect(result.state.position.z).toBeCloseTo(0.9);
  });
  it("covers the full interval even across many tiny supports in either direction", () => {
    const supports = Array.from({ length: 100 }, (_, index) => ({
      ...ground,
      id: `${index}`,
      minX: index / 100,
      maxX: (index + 1) / 100,
    }));
    const routeWorld = { supports, solids: [] };
    const target = { x: 1, y: 0, z: 1 };
    const result = queryWalkerPath(state, target, routeWorld);
    expect(result.walkable).toBe(true);
    expect(queryWalkerPath(result.state, state.position, routeWorld).walkable).toBe(true);
  });
  it("validates support transitions and inclined ground along the actual diagonal", () => {
    const ramp = { ...ground, minX: 0, minZ: 0, slopeX: 0.25, slopeZ: 0.25 };
    const rampWorld = { supports: [ramp], solids: [] };
    expect(queryWalkerPath(state, { x: 4, y: 2, z: 4 }, rampWorld).walkable).toBe(true);
    const steps = {
      supports: [
        { ...ground, maxX: 1 },
        { ...ground, id: "step", minX: 1, y: 0.2 },
      ],
      solids: [],
    };
    const top = queryWalkerPath(state, { x: 2, y: 0.2, z: 2 }, steps);
    expect(top.walkable).toBe(true);
    expect(queryWalkerPath(top.state, state.position, steps).walkable).toBe(true);
    expect(
      queryWalkerPath(
        state,
        { x: 2, y: 1, z: 2 },
        {
          ...steps,
          supports: [
            { ...ground, maxX: 1 },
            { ...ground, id: "high", minX: 1, y: 1 },
          ],
        },
      ).walkable,
    ).toBe(false);
    const ceiling = { id: "ceiling", min: { x: 0.8, y: 1.9, z: 0.8 }, max: { x: 3, y: 2.5, z: 3 } };
    expect(
      queryWalkerPath(state, { x: 2, y: 0.2, z: 2 }, { ...steps, solids: [ceiling] }).contacts,
    ).toEqual(["ceiling"]);
  });
  it("handles invalid starting support, zero length and target height tolerance", () => {
    expect(queryWalkerPath(state, state.position, world).walkable).toBe(true);
    expect(queryWalkerPath(state, { x: 1, y: 5e-10, z: 1 }, world).walkable).toBe(true);
    expect(queryWalkerPath(state, { x: 1, y: 2e-9, z: 1 }, world).walkable).toBe(false);
    const result = queryWalkerPath(state, state.position, { supports: [], solids: [] });
    expect(result.status).toBe("invalid-support");
    expect(result.walkable).toBe(false);
    expect(() => queryWalkerPath(state, { x: NaN, y: 0, z: 0 }, world)).toThrow(RangeError);
  });
  it("ignores irrelevant and point-contact support rectangles and orders equal support deterministically", () => {
    const supports = [
      ground,
      { ...ground, id: "lower", y: -0.2 },
      { ...ground, id: "a" },
      { ...ground, id: "left", minX: -4, maxX: -3 },
      { ...ground, id: "right", minX: 3, maxX: 4 },
      { ...ground, id: "corner", minX: 1, maxX: 2, minZ: -1, maxZ: 1 },
    ];
    const target = { x: 0, y: 0, z: 2 };
    const result = queryWalkerPath(state, target, { supports, solids: [] });
    expect(result.walkable).toBe(true);
    expect(result.state.supportId).toBe("a");
    expect(
      queryWalkerPath(state, target, { supports: [...supports].reverse(), solids: [] }),
    ).toEqual(result);
    expect(queryWalkerPath(state, { x: 2, y: 0, z: 2 }, { supports, solids: [] }).walkable).toBe(
      true,
    );
  });
  it("returns detached state and leaves caller geometry unchanged", () => {
    const before = JSON.stringify({ state, world });
    const result = queryWalkerPath(state, { x: 1, y: 0, z: 1 }, world);
    result.state.position.x = 100;
    expect(JSON.stringify({ state, world })).toBe(before);
  });
});

it("refuses a real gap even when distinct boundaries round to the same path parameter", () => {
  const start = { ...state, position: { x: -1e9, y: 0, z: 0 } };
  const target = { x: 1e9, y: 0, z: 0 };
  const firstEdge = 1,
    nextEdge = 1 + 1e-10;
  expect(firstEdge).not.toBe(nextEdge);
  expect((firstEdge - start.position.x) / (target.x - start.position.x)).toBe(
    (nextEdge - start.position.x) / (target.x - start.position.x),
  );
  const supports = [
    { ...ground, minX: -1e9, maxX: firstEdge },
    { ...ground, id: "far", minX: nextEdge, maxX: 1e9 },
  ];
  expect(queryWalkerPath(start, target, { supports, solids: [] }).walkable).toBe(false);
});

it("keeps stationary paths on current support instead of stepping onto an overlapping plane", () => {
  const overlap = { ...world, supports: [ground, { ...ground, id: "upper", y: 0.2 }] };
  const unchanged = queryWalkerPath(state, state.position, overlap);
  expect(unchanged.walkable).toBe(true);
  expect(unchanged.state.position).toEqual(state.position);
  expect(unchanged.state.supportId).toBe("ground");
  const upward = queryWalkerPath(state, { ...state.position, y: 0.2 }, overlap);
  expect(upward.walkable).toBe(false);
  expect(upward.state.position).toEqual(state.position);
});

it("does not collapse a thin solid hit into a zero-width slab interval on a long route", () => {
  const start = { ...state, halfWidth: 2e-9, position: { x: -1e9, y: 0, z: 0 } };
  const target = { x: 1e9, y: 0, z: 0 };
  const thin = { id: "thin", min: { x: 1, y: 0, z: -1 }, max: { x: 1 + 1e-10, y: 3, z: 1 } };
  const longWorld = { supports: [{ ...ground, minX: -1e9, maxX: 1e9 }], solids: [thin] };
  const path = queryWalkerPath(start, target, longWorld);
  expect(path.walkable).toBe(false);
  expect(path.contacts).toEqual(["thin"]);
  expect(path.state.position.x).toBe(1 - start.halfWidth);
  expect(
    advanceWalker({ ...start, position: { x: -5e8, y: 0, z: 0 } }, { x: 1e9, z: 0 }, longWorld)
      .state.position.x,
  ).toBe(1 - start.halfWidth);
  const ray = querySegmentOcclusion({ ...start.position, y: 1 }, { ...target, y: 1 }, longWorld);
  expect(ray?.id).toBe("thin");
  expect(ray?.point.x).toBe(1);
});

it("orders distinct solid hits exactly even when their numeric fractions are equal", () => {
  const from = { x: -1e9, y: 1, z: 0 },
    to = { x: 1e9, y: 1, z: 0 };
  const solids = [
    { id: "a-far", min: { x: 1 + 1e-10, y: 0, z: -1 }, max: { x: 2, y: 3, z: 1 } },
    { id: "z-near", min: { x: 1, y: 0, z: -1 }, max: { x: 2, y: 3, z: 1 } },
  ];
  const forward = querySegmentOcclusion(from, to, { ...world, solids });
  expect(forward?.id).toBe("z-near");
  expect(querySegmentOcclusion(from, to, { ...world, solids: [...solids].reverse() })).toEqual(
    forward,
  );
});
