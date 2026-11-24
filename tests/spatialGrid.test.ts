import { describe, expect, it } from "vitest";
import { createRng, nextFloat, nextInt, type RngStream } from "../src/rng.js";
import {
  buildGridOccupancy,
  createGridMask,
  enclosedGridRegions,
  floodGrid,
  GRID_MAX_CELLS,
  type GridCell,
  type GridConnectivity,
  type GridPredicate,
  type GridRect,
  type GridSize,
  gridMaskCells,
  gridMaskHas,
  largestClearGridSquare,
} from "../src/spatial.js";

/** `.` is an open cell and `#` is a blocked one; every row has the same length. */
function sketch(rows: readonly string[]): { size: GridSize; open: GridPredicate } {
  return {
    size: { width: rows[0]?.length ?? 0, height: rows.length },
    open: (x, y) => rows[y]?.[x] === ".",
  };
}

function randomGrid(
  stream: RngStream,
  width: number,
  height: number,
  blockedChance: number,
): { size: GridSize; open: GridPredicate; blocked: boolean[][] } {
  const blocked = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => nextFloat(stream) < blockedChance),
  );
  return { size: { width, height }, open: (x, y) => !blocked[y]?.[x], blocked };
}

/** The reference flood: no typed arrays, no shared code with the module. */
function referenceReach(
  { width, height }: GridSize,
  open: GridPredicate,
  seeds: readonly GridCell[],
  step: GridConnectivity,
): Set<string> {
  const diagonal = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
  const reached = new Set<string>();
  const stack: GridCell[] = [];
  for (const seed of seeds) {
    if (open(seed.x, seed.y) && !reached.has(`${seed.x},${seed.y}`)) {
      reached.add(`${seed.x},${seed.y}`);
      stack.push(seed);
    }
  }
  for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
    for (const [dx, dy] of diagonal.slice(0, step)) {
      const x = cell.x + (dx as number);
      const y = cell.y + (dy as number);
      if (x < 0 || y < 0 || x >= width || y >= height || !open(x, y)) continue;
      if (reached.has(`${x},${y}`)) continue;
      reached.add(`${x},${y}`);
      stack.push({ x, y });
    }
  }
  return reached;
}

function keys(mask: ReturnType<typeof floodGrid>): Set<string> {
  return new Set(gridMaskCells(mask).map(({ x, y }) => `${x},${y}`));
}

function borderCells({ width, height }: GridSize): GridCell[] {
  const cells: GridCell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) cells.push({ x, y });
    }
  }
  return cells;
}

describe("createGridMask and its readers", () => {
  it("reads the predicate once per cell in row-major order", () => {
    const calls: string[] = [];
    const mask = createGridMask({ width: 3, height: 2 }, (x, y) => {
      calls.push(`${x},${y}`);
      return (x + y) % 2 === 0;
    });
    expect(calls).toEqual(["0,0", "1,0", "2,0", "0,1", "1,1", "2,1"]);
    expect(mask.count).toBe(3);
    expect(Array.from(mask.cells)).toEqual([1, 0, 1, 0, 1, 0]);
    expect(gridMaskCells(mask)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it("never reports a cell outside the grid as a member", () => {
    const mask = createGridMask({ width: 2, height: 2 }, () => true);
    expect(gridMaskHas(mask, 1, 1)).toBe(true);
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [2, 0],
      [0, 2],
    ] as const) {
      expect(gridMaskHas(mask, x, y)).toBe(false);
    }
  });

  it("rejects malformed sizes and predicates before allocating", () => {
    const yes = () => true;
    expect(() => createGridMask(null as never, yes)).toThrow(TypeError);
    expect(() => createGridMask(3 as never, yes)).toThrow(TypeError);
    expect(() => createGridMask({ width: 0, height: 2 }, yes)).toThrow(RangeError);
    expect(() => createGridMask({ width: 2, height: -1 }, yes)).toThrow(RangeError);
    expect(() => createGridMask({ width: 1.5, height: 2 }, yes)).toThrow(RangeError);
    expect(() => createGridMask({ width: 2, height: Number.NaN }, yes)).toThrow(RangeError);
    expect(() => createGridMask({ width: 2048, height: 2049 }, yes)).toThrow(/at most/);
    expect(() => createGridMask({ width: 2, height: 2 }, "no" as never)).toThrow(TypeError);
    expect(GRID_MAX_CELLS).toBe(2048 * 2048);
  });
});

describe("buildGridOccupancy", () => {
  const size = { width: 5, height: 4 };

  it("gives each cell to the first footprint that covers it", () => {
    const occupancy = buildGridOccupancy(size, [
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 3, y: 1, width: 1, height: 3 },
    ]);
    expect(occupancy.occupied.count).toBe(7);
    expect(gridMaskHas(occupancy.occupied, 1, 1)).toBe(true);
    expect(gridMaskHas(occupancy.occupied, 2, 2)).toBe(false);
    expect(occupancy.occupant[0]).toBe(0);
    expect(occupancy.occupant[1 * 5 + 3]).toBe(1);
    expect(occupancy.occupant[0 * 5 + 4]).toBe(-1);
    expect(occupancy.overlapping).toEqual([]);
    expect(occupancy.outOfBounds).toEqual([]);
  });

  it("reports overlaps once per later footprint and lays only the first claim", () => {
    const occupancy = buildGridOccupancy(size, [
      { x: 0, y: 0, width: 3, height: 3 },
      { x: 2, y: 2, width: 2, height: 2 },
      { x: 2, y: 0, width: 1, height: 3 },
      { x: 4, y: 3, width: 1, height: 1 },
    ]);
    expect(occupancy.overlapping).toEqual([1, 2]);
    expect(occupancy.occupant[2 * 5 + 2]).toBe(0);
    expect(occupancy.occupant[3 * 5 + 3]).toBe(1);
    expect(occupancy.occupied.count).toBe(9 + 3 + 1);
  });

  it("reports footprints that leave the grid and still lays their inside", () => {
    const occupancy = buildGridOccupancy(size, [
      { x: -1, y: -1, width: 2, height: 2 },
      { x: 4, y: 3, width: 3, height: 3 },
      { x: 9, y: 9, width: 2, height: 2 },
      { x: 4, y: 3, width: 1, height: 1 },
    ]);
    expect(occupancy.outOfBounds).toEqual([0, 1, 2]);
    expect(occupancy.occupant[0]).toBe(0);
    expect(occupancy.occupant[3 * 5 + 4]).toBe(1);
    expect(occupancy.occupied.count).toBe(2);
    expect(occupancy.overlapping).toEqual([3]);
  });

  it("accepts no footprints", () => {
    const occupancy = buildGridOccupancy(size, []);
    expect(occupancy.occupied.count).toBe(0);
    expect(Array.from(occupancy.occupant).every((owner) => owner === -1)).toBe(true);
  });

  it("rejects malformed footprints", () => {
    expect(() => buildGridOccupancy(size, null as never)).toThrow(TypeError);
    expect(() => buildGridOccupancy(size, [null as never])).toThrow(TypeError);
    expect(() => buildGridOccupancy(size, [{ x: 0.5, y: 0, width: 1, height: 1 }])).toThrow(
      RangeError,
    );
    expect(() => buildGridOccupancy(size, [{ x: 0, y: 0, width: 0, height: 1 }])).toThrow(
      RangeError,
    );
    expect(() => buildGridOccupancy(size, [{ x: 0, y: 0, width: 1, height: 1.5 }])).toThrow(
      RangeError,
    );
    expect(() => buildGridOccupancy({ width: 0, height: 1 }, [])).toThrow(RangeError);
  });

  it("agrees with a per-cell reference on random footprints", () => {
    const { gen } = createRng({ gen: "occupancy", events: "occupancy" });
    for (let round = 0; round < 40; round++) {
      const grid = { width: nextInt(gen, 1, 9), height: nextInt(gen, 1, 9) };
      const rects: GridRect[] = Array.from({ length: nextInt(gen, 0, 6) }, () => ({
        x: nextInt(gen, -2, 9),
        y: nextInt(gen, -2, 9),
        width: nextInt(gen, 1, 4),
        height: nextInt(gen, 1, 4),
      }));
      const owner = new Map<string, number>();
      const overlapping = new Set<number>();
      const outOfBounds = new Set<number>();
      rects.forEach((rect, index) => {
        for (let y = rect.y; y < rect.y + rect.height; y++) {
          for (let x = rect.x; x < rect.x + rect.width; x++) {
            if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
              outOfBounds.add(index);
            } else if (owner.has(`${x},${y}`)) {
              overlapping.add(index);
            } else {
              owner.set(`${x},${y}`, index);
            }
          }
        }
      });
      const occupancy = buildGridOccupancy(grid, rects);
      expect(occupancy.occupied.count).toBe(owner.size);
      expect(occupancy.overlapping).toEqual([...overlapping].sort((a, b) => a - b));
      expect(occupancy.outOfBounds).toEqual([...outOfBounds].sort((a, b) => a - b));
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          expect(occupancy.occupant[y * grid.width + x]).toBe(owner.get(`${x},${y}`) ?? -1);
        }
      }
    }
  });
});

describe("floodGrid", () => {
  it("fills a room and stops at its walls", () => {
    const { size, open } = sketch(["..#..", "..#..", "###..", "....."]);
    const room = floodGrid(size, open, [{ x: 0, y: 0 }], 4);
    expect(room.count).toBe(4);
    expect(gridMaskHas(room, 1, 1)).toBe(true);
    expect(gridMaskHas(room, 3, 0)).toBe(false);
    expect(room.width).toBe(5);
    expect(room.height).toBe(4);
  });

  it("never enters a blocked seed and skips repeated seeds", () => {
    const { size, open } = sketch(["#.", ".."]);
    expect(floodGrid(size, open, [{ x: 0, y: 0 }], 8).count).toBe(0);
    const twice = floodGrid(
      size,
      open,
      [
        { x: 1, y: 0 },
        { x: 1, y: 0 },
      ],
      4,
    );
    expect(twice.count).toBe(3);
    expect(floodGrid(size, open, [], 4).count).toBe(0);
  });

  it("steps to side neighbours only under 4 and through corner gaps under 8", () => {
    const { size, open } = sketch(["..#", ".#.", "#.."]);
    const seeds = [{ x: 0, y: 0 }];
    expect(floodGrid(size, open, seeds, 4).count).toBe(3);
    // (2,1) and (1,2) touch the reached cells only at a corner, between two blocked cells.
    expect(gridMaskHas(floodGrid(size, open, seeds, 4), 2, 1)).toBe(false);
    const eight = floodGrid(size, open, seeds, 8);
    expect(eight.count).toBe(6);
    expect(gridMaskHas(eight, 2, 1)).toBe(true);
    expect(gridMaskHas(eight, 1, 2)).toBe(true);
    const crossed = sketch([".#", "#."]);
    expect(floodGrid(crossed.size, crossed.open, seeds, 4).count).toBe(1);
    expect(floodGrid(crossed.size, crossed.open, seeds, 8).count).toBe(2);
  });

  it("rejects bad input before searching", () => {
    const { size, open } = sketch(["..", ".."]);
    const seed = [{ x: 0, y: 0 }];
    expect(() => floodGrid(size, open, seed, 5 as never)).toThrow(RangeError);
    expect(() => floodGrid(size, "open" as never, seed, 4)).toThrow(TypeError);
    expect(() => floodGrid(size, open, null as never, 4)).toThrow(TypeError);
    expect(() => floodGrid(size, open, [null as never], 4)).toThrow(TypeError);
    expect(() => floodGrid(size, open, [{ x: 0.5, y: 0 }], 4)).toThrow(RangeError);
    expect(() => floodGrid(size, open, [{ x: 0, y: Number.NaN }], 4)).toThrow(RangeError);
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [2, 0],
      [0, 2],
    ] as const) {
      expect(() => floodGrid(size, open, [{ x, y }], 4)).toThrow(/outside the grid/);
    }
    const sparse = new Array(2);
    sparse[1] = { x: 0, y: 0 };
    expect(() => floodGrid(size, open, sparse, 4)).toThrow(/sparse/);
    const inherited = Object.setPrototypeOf(new Array(1), [{ x: 0, y: 0 }]);
    expect(() => floodGrid(size, open, inherited, 4)).toThrow(/sparse/);
  });

  it("reads the predicate once per cell, row-major, whatever the search does", () => {
    const calls: string[] = [];
    const open: GridPredicate = (x, y) => {
      calls.push(`${x},${y}`);
      return (x * 7 + y * 3) % 5 !== 0;
    };
    floodGrid({ width: 4, height: 3 }, open, [{ x: 1, y: 0 }], 8);
    expect(calls).toEqual(
      Array.from({ length: 12 }, (_, index) => `${index % 4},${Math.floor(index / 4)}`),
    );
  });

  it("matches a reference flood on random grids and is deterministic", () => {
    const { gen } = createRng({ gen: "flood", events: "flood" });
    for (let round = 0; round < 120; round++) {
      const grid = randomGrid(gen, nextInt(gen, 1, 12), nextInt(gen, 1, 12), nextFloat(gen) * 0.7);
      const seeds: GridCell[] = Array.from({ length: nextInt(gen, 0, 4) }, () => ({
        x: nextInt(gen, 0, grid.size.width),
        y: nextInt(gen, 0, grid.size.height),
      }));
      for (const step of [4, 8] as const) {
        const first = floodGrid(grid.size, grid.open, seeds, step);
        const again = floodGrid(grid.size, grid.open, seeds, step);
        expect(Array.from(again.cells)).toEqual(Array.from(first.cells));
        expect(keys(first)).toEqual(referenceReach(grid.size, grid.open, seeds, step));
        expect(first.count).toBe(keys(first).size);
      }
    }
  });

  it("is symmetric: b is reachable from a exactly when a is reachable from b", () => {
    const { gen } = createRng({ gen: "symmetry", events: "symmetry" });
    for (let round = 0; round < 60; round++) {
      const grid = randomGrid(gen, nextInt(gen, 2, 9), nextInt(gen, 2, 9), 0.35);
      const cells = gridMaskCells(createGridMask(grid.size, grid.open));
      for (const step of [4, 8] as const) {
        for (let pair = 0; pair < 12 && cells.length > 0; pair++) {
          const a = cells[nextInt(gen, 0, cells.length)] as GridCell;
          const b = cells[nextInt(gen, 0, cells.length)] as GridCell;
          const fromA = floodGrid(grid.size, grid.open, [a], step);
          const fromB = floodGrid(grid.size, grid.open, [b], step);
          expect(gridMaskHas(fromA, b.x, b.y)).toBe(gridMaskHas(fromB, a.x, a.y));
        }
      }
    }
  });

  it("reaches at least as far under 8 as under 4, and the same set from any member", () => {
    const { gen } = createRng({ gen: "monotone", events: "monotone" });
    for (let round = 0; round < 60; round++) {
      const grid = randomGrid(gen, nextInt(gen, 2, 10), nextInt(gen, 2, 10), 0.4);
      const seed = [{ x: 0, y: 0 }];
      const four = floodGrid(grid.size, grid.open, seed, 4);
      const eight = floodGrid(grid.size, grid.open, seed, 8);
      for (let i = 0; i < four.cells.length; i++) {
        expect((eight.cells[i] as number) >= (four.cells[i] as number)).toBe(true);
      }
      for (const member of gridMaskCells(four)) {
        expect(Array.from(floodGrid(grid.size, grid.open, [member], 4).cells)).toEqual(
          Array.from(four.cells),
        );
      }
    }
  });
});

describe("enclosedGridRegions", () => {
  const farm = (rows: readonly string[], options: Parameters<typeof enclosedGridRegions>[2]) => {
    const { size, open } = sketch(rows);
    return enclosedGridRegions(size, open, options);
  };

  it("encloses the inside of a ring whose pieces join side to side", () => {
    const { regions, outside } = farm(
      [".......", ".#####.", ".#...#.", ".#...#.", ".#####.", "......."],
      { step: 8 },
    );
    expect(regions).toHaveLength(1);
    expect(regions[0]?.cells).toHaveLength(6);
    expect(regions[0]?.cells[0]).toEqual({ x: 2, y: 2 });
    expect(gridMaskHas(outside, 0, 0)).toBe(true);
    expect(gridMaskHas(outside, 3, 2)).toBe(false);
  });

  it("is not closed by a ring that is missing a corner piece", () => {
    const rows = [".......", "..###..", ".#...#.", ".#...#.", ".#####.", "......."];
    // The cell at (1,1) is missing: the pieces at (2,1) and (1,2) meet only at a corner.
    expect(farm(rows, { step: 8 }).regions).toEqual([]);
    expect(farm(rows, { step: 4 }).regions).toHaveLength(1);
  });

  it("is open under 8 and closed under 4 for a diamond", () => {
    const rows = [".......", "...#...", "..#.#..", "...#...", "......."];
    expect(farm(rows, { step: 8 }).regions).toEqual([]);
    const closed = farm(rows, { step: 4 });
    expect(closed.regions).toHaveLength(1);
    expect(closed.regions[0]?.cells).toEqual([{ x: 3, y: 2 }]);
  });

  it("does not treat the grid's edge as a fence, but a barrier along it as one", () => {
    // Three sides of wire against the edge leave the border cells open.
    expect(farm(["###.", "#...", "###."], { step: 8 }).regions).toEqual([]);
    expect(farm(["#####", "#...#", "#...#", "#...#"], { step: 8 }).regions).toEqual([]);
    expect(farm([".....", "#####", "#...#", "#...#"], { step: 8 }).regions).toEqual([]);
    // Wire on all four sides, the fourth lying on the border row, does close it.
    expect(farm(["#####", "#...#", "#...#", "#####"], { step: 8 }).regions).toHaveLength(1);
  });

  it("groups pockets that touch only at a corner by the region step", () => {
    const rows = ["####", "#.##", "##.#", "####"];
    const together = farm(rows, { step: 8 });
    expect(together.regions).toHaveLength(1);
    expect(together.regions[0]?.cells).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    const apart = farm(rows, { step: 8, regionStep: 4 });
    expect(apart.regions.map((region) => region.cells)).toEqual([
      [{ x: 1, y: 1 }],
      [{ x: 2, y: 2 }],
    ]);
  });

  it("orders regions by their first cell, row-major", () => {
    const { regions } = farm(["#######", "#.#...#", "###.#.#", "#.#...#", "#######"], { step: 8 });
    expect(regions.map((region) => region.cells[0])).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 3 },
    ]);
    expect(regions[1]?.cells).toHaveLength(8);
  });

  it("starts the outside where the seeds say", () => {
    const rows = ["#####", "#...#", "#.#.#", "#...#", "#####"];
    // Without seeds the whole ring is closed; seeding inside makes that room the outside.
    expect(farm(rows, { step: 8 }).regions).toHaveLength(1);
    const seeded = farm(rows, { step: 8, seeds: [{ x: 1, y: 1 }] });
    expect(seeded.regions).toEqual([]);
    expect(seeded.outside.count).toBe(8);
    const none = farm(rows, { step: 8, seeds: [] });
    expect(none.outside.count).toBe(0);
    expect(none.regions[0]?.cells).toHaveLength(8);
    // A blocked seed leaves nothing outside; one on land beyond the fence is the outside.
    expect(farm(rows, { step: 8, seeds: [{ x: 0, y: 0 }] }).outside.count).toBe(0);
  });

  it("handles one-cell-wide and one-cell-tall grids", () => {
    expect(farm(["."], { step: 8 }).regions).toEqual([]);
    expect(farm(["#"], { step: 8 }).regions).toEqual([]);
    expect(farm(["...."], { step: 4 }).regions).toEqual([]);
    expect(farm([".", ".", "."], { step: 4 }).regions).toEqual([]);
    // Every cell of a one-cell-wide grid is on its border, so none can be enclosed.
    expect(farm(["#", ".", "#"], { step: 4 }).regions).toEqual([]);
    expect(farm(["#.#"], { step: 4 }).regions).toEqual([]);
  });

  it("rejects bad input", () => {
    const { size, open } = sketch(["..", ".."]);
    expect(() => enclosedGridRegions(size, open, null as never)).toThrow(TypeError);
    expect(() => enclosedGridRegions(size, open, {} as never)).toThrow(RangeError);
    expect(() => enclosedGridRegions(size, open, { step: 8, regionStep: 3 as never })).toThrow(
      RangeError,
    );
    expect(() => enclosedGridRegions(size, open, { step: 8, seeds: [{ x: 5, y: 0 }] })).toThrow(
      /outside the grid/,
    );
    expect(() => enclosedGridRegions(size, "no" as never, { step: 8 })).toThrow(TypeError);
  });

  it("matches a reference on random grids: enclosed = open and not reached from the border", () => {
    const { gen } = createRng({ gen: "enclosure", events: "enclosure" });
    let enclosedSeen = 0;
    for (let round = 0; round < 150; round++) {
      const grid = randomGrid(gen, nextInt(gen, 1, 12), nextInt(gen, 1, 12), 0.45);
      for (const step of [4, 8] as const) {
        for (const regionStep of [4, 8] as const) {
          const result = enclosedGridRegions(grid.size, grid.open, { step, regionStep });
          const outside = referenceReach(grid.size, grid.open, borderCells(grid.size), step);
          expect(keys(result.outside)).toEqual(outside);
          const enclosed = new Set<string>();
          for (let y = 0; y < grid.size.height; y++) {
            for (let x = 0; x < grid.size.width; x++) {
              if (grid.open(x, y) && !outside.has(`${x},${y}`)) enclosed.add(`${x},${y}`);
            }
          }
          const grouped = result.regions.flatMap((region) => region.cells);
          expect(new Set(grouped.map(({ x, y }) => `${x},${y}`))).toEqual(enclosed);
          expect(grouped).toHaveLength(enclosed.size);
          enclosedSeen += enclosed.size;
          const regionKeys = result.regions.map((region) => {
            const [first] = region.cells;
            const flooded = referenceReach(
              grid.size,
              (x, y) => enclosed.has(`${x},${y}`),
              [first as GridCell],
              regionStep,
            );
            expect(new Set(region.cells.map(({ x, y }) => `${x},${y}`))).toEqual(flooded);
            return (first as GridCell).y * grid.size.width + (first as GridCell).x;
          });
          expect(regionKeys).toEqual([...regionKeys].sort((a, b) => a - b));
          for (const region of result.regions) {
            const order = region.cells.map(({ x, y }) => y * grid.size.width + x);
            expect(order).toEqual([...order].sort((a, b) => a - b));
          }
        }
      }
    }
    expect(enclosedSeen).toBeGreaterThan(0);
  });

  it("answers identically on every call", () => {
    const { gen } = createRng({ gen: "enclosure-repeat", events: "enclosure-repeat" });
    const grid = randomGrid(gen, 10, 9, 0.45);
    const first = enclosedGridRegions(grid.size, grid.open, { step: 8 });
    const second = enclosedGridRegions(grid.size, grid.open, { step: 8 });
    expect(second.regions).toEqual(first.regions);
    expect(Array.from(second.outside.cells)).toEqual(Array.from(first.outside.cells));
  });
});

describe("largestClearGridSquare", () => {
  const sketchSquare = (rows: readonly string[]) => sketch(rows);

  /** The reference: every square, largest first, then lowest y, then lowest x. */
  function reference(
    { width, height }: GridSize,
    clear: GridPredicate,
    target: GridRect,
    minSide: number,
    maxSide: number,
  ) {
    for (let side = Math.min(maxSide, width, height); side >= minSide; side--) {
      for (let y = 0; y + side <= height; y++) {
        for (let x = 0; x + side <= width; x++) {
          const holds =
            x <= target.x &&
            y <= target.y &&
            target.x + target.width <= x + side &&
            target.y + target.height <= y + side;
          if (!holds) continue;
          let every = true;
          for (let dy = 0; dy < side && every; dy++) {
            for (let dx = 0; dx < side && every; dx++) every = clear(x + dx, y + dy);
          }
          if (every) return { x, y, side };
        }
      }
    }
    return null;
  }

  it("finds the largest square around a cell and breaks ties by lowest y, then x", () => {
    const { size, open } = sketchSquare(["....", "....", "....", "...."]);
    expect(largestClearGridSquare(size, open, { x: 1, y: 1 })).toEqual({ x: 0, y: 0, side: 4 });
    const bed = sketchSquare(["#....", "#....", "#....", "....."]);
    // Of the two 3x3 squares that hold (2,2) the one with the lower corner wins.
    expect(largestClearGridSquare(bed.size, bed.open, { x: 2, y: 2 }, { maxSide: 3 })).toEqual({
      x: 1,
      y: 0,
      side: 3,
    });
    const lower = sketchSquare(["#####", ".....", ".....", ".....", "....."]);
    expect(largestClearGridSquare(lower.size, lower.open, { x: 0, y: 4 })).toEqual({
      x: 0,
      y: 1,
      side: 4,
    });
  });

  it("returns null for a blocked, outside or oversize target", () => {
    const { size, open } = sketchSquare(["..#", "...", "..."]);
    expect(largestClearGridSquare(size, open, { x: 2, y: 0 })).toBeNull();
    expect(largestClearGridSquare(size, open, { x: 3, y: 0 })).toBeNull();
    expect(largestClearGridSquare(size, open, { x: -1, y: 0 })).toBeNull();
    expect(largestClearGridSquare(size, open, { x: 0, y: -1 })).toBeNull();
    expect(largestClearGridSquare(size, open, { x: 0, y: 3 })).toBeNull();
    expect(largestClearGridSquare(size, open, { x: 0, y: 0, width: 4, height: 1 })).toBeNull();
    expect(largestClearGridSquare(size, open, { x: 1, y: 0, width: 2, height: 2 })).toBeNull();
    expect(largestClearGridSquare(size, open, { x: 0, y: 1, width: 1, height: 4 })).toBeNull();
  });

  it("honours minSide and maxSide", () => {
    const { size, open } = sketchSquare(["...#", "...#", "...#", "####"]);
    const cell = { x: 1, y: 1 };
    expect(largestClearGridSquare(size, open, cell)).toEqual({ x: 0, y: 0, side: 3 });
    expect(largestClearGridSquare(size, open, cell, { maxSide: 2 })).toEqual({
      x: 0,
      y: 0,
      side: 2,
    });
    expect(largestClearGridSquare(size, open, cell, { minSide: 3 })).toEqual({
      x: 0,
      y: 0,
      side: 3,
    });
    expect(largestClearGridSquare(size, open, cell, { minSide: 4 })).toBeNull();
    expect(largestClearGridSquare(size, open, cell, { minSide: 3, maxSide: 2 })).toBeNull();
    expect(largestClearGridSquare(size, open, { x: 0, y: 0 }, { maxSide: 1 })).toEqual({
      x: 0,
      y: 0,
      side: 1,
    });
  });

  it("contains a whole rectangle when given one, so a bed can ask whether it may grow", () => {
    const { size, open } = sketchSquare(["....#", "....#", "....#", "....#", "#####"]);
    const bed = { x: 1, y: 1, width: 2, height: 2 };
    expect(largestClearGridSquare(size, open, bed)).toEqual({ x: 0, y: 0, side: 4 });
    expect(largestClearGridSquare(size, open, bed, { minSide: 5 })).toBeNull();
    const cramped = sketchSquare(["....", "..#.", "....", "...."]);
    expect(
      largestClearGridSquare(
        cramped.size,
        cramped.open,
        { x: 0, y: 0, width: 2, height: 2 },
        {
          minSide: 3,
        },
      ),
    ).toBeNull();
    // A tall rectangle needs a square at least as large as its longer side.
    expect(
      largestClearGridSquare(size, open, { x: 0, y: 0, width: 1, height: 3 }, { maxSide: 2 }),
    ).toBeNull();
  });

  it("reads only the cells a qualifying square could cover, once each, row-major", () => {
    const calls: string[] = [];
    const size = { width: 100, height: 100 };
    const found = largestClearGridSquare(
      size,
      (x, y) => {
        calls.push(`${x},${y}`);
        return true;
      },
      { x: 50, y: 50 },
      { maxSide: 3 },
    );
    expect(found).toEqual({ x: 48, y: 48, side: 3 });
    expect(calls).toHaveLength(25);
    expect(new Set(calls).size).toBe(25);
    expect(calls[0]).toBe("48,48");
    expect(calls[24]).toBe("52,52");
  });

  it("clips the window at the grid's edges", () => {
    const { size, open } = sketchSquare([".....", ".....", "....."]);
    expect(largestClearGridSquare(size, open, { x: 4, y: 2 }, { maxSide: 3 })).toEqual({
      x: 2,
      y: 0,
      side: 3,
    });
    expect(largestClearGridSquare(size, open, { x: 0, y: 0 }, { maxSide: 3 })).toEqual({
      x: 0,
      y: 0,
      side: 3,
    });
  });

  it("rejects bad input", () => {
    const { size, open } = sketchSquare(["..", ".."]);
    const cell = { x: 0, y: 0 };
    expect(() => largestClearGridSquare(size, "no" as never, cell)).toThrow(TypeError);
    expect(() => largestClearGridSquare(size, open, null as never)).toThrow(TypeError);
    expect(() => largestClearGridSquare(size, open, cell, null as never)).toThrow(TypeError);
    expect(() => largestClearGridSquare(size, open, { x: 0.5, y: 0 })).toThrow(RangeError);
    expect(() => largestClearGridSquare(size, open, { x: 0, y: Number.NaN })).toThrow(RangeError);
    expect(() => largestClearGridSquare(size, open, { x: 0, y: 0, width: 0, height: 1 })).toThrow(
      RangeError,
    );
    expect(() => largestClearGridSquare(size, open, { x: 0, y: 0, width: 1, height: 0 })).toThrow(
      RangeError,
    );
    expect(() => largestClearGridSquare(size, open, cell, { minSide: 0 })).toThrow(RangeError);
    expect(() => largestClearGridSquare(size, open, cell, { maxSide: 1.5 })).toThrow(RangeError);
    expect(() => largestClearGridSquare({ width: 0, height: 1 }, open, cell)).toThrow(RangeError);
  });

  it("matches a brute-force search on random grids, targets and bounds", () => {
    const { gen } = createRng({ gen: "square", events: "square" });
    let found = 0;
    for (let round = 0; round < 400; round++) {
      const grid = randomGrid(gen, nextInt(gen, 1, 10), nextInt(gen, 1, 10), nextFloat(gen) * 0.35);
      const target: GridRect = {
        x: nextInt(gen, 0, grid.size.width),
        y: nextInt(gen, 0, grid.size.height),
        width: nextInt(gen, 1, 3),
        height: nextInt(gen, 1, 3),
      };
      const minSide = nextInt(gen, 1, 4);
      const maxSide = nextInt(gen, 1, 12);
      const expected = (() => {
        const inside =
          target.x + target.width <= grid.size.width &&
          target.y + target.height <= grid.size.height;
        if (!inside) return null;
        for (let y = target.y; y < target.y + target.height; y++) {
          for (let x = target.x; x < target.x + target.width; x++) {
            if (!grid.open(x, y)) return null;
          }
        }
        return reference(
          grid.size,
          grid.open,
          target,
          Math.max(minSide, target.width, target.height),
          maxSide,
        );
      })();
      const actual = largestClearGridSquare(grid.size, grid.open, target, { minSide, maxSide });
      expect(actual).toEqual(expected);
      expect(largestClearGridSquare(grid.size, grid.open, target, { minSide, maxSide })).toEqual(
        actual,
      );
      if (actual !== null) found++;
    }
    expect(found).toBeGreaterThan(50);
  });

  it("matches brute force for a single cell with default bounds", () => {
    const { gen } = createRng({ gen: "square-cell", events: "square-cell" });
    for (let round = 0; round < 200; round++) {
      const grid = randomGrid(gen, nextInt(gen, 1, 9), nextInt(gen, 1, 9), 0.25);
      const cell = {
        x: nextInt(gen, 0, grid.size.width),
        y: nextInt(gen, 0, grid.size.height),
      };
      const expected = grid.open(cell.x, cell.y)
        ? reference(
            grid.size,
            grid.open,
            { ...cell, width: 1, height: 1 },
            1,
            Number.MAX_SAFE_INTEGER,
          )
        : null;
      expect(largestClearGridSquare(grid.size, grid.open, cell)).toEqual(expected);
    }
  });
});
