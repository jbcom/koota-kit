/**
 * Pure, deterministic queries over a finite grid of unit cells.
 *
 * A grid is `width` by `height` cells. Cell `(x, y)` has the row-major index
 * `y * width + x`; `x` grows along a row and `y` grows between rows. Callers
 * own what a cell means and describe it with a predicate. This module owns no
 * game state: it never retains a predicate, a mask or a seed list, and it
 * allocates only typed arrays sized to the grid (or to the query window).
 *
 * Every predicate is read exactly once per cell it needs, in row-major order,
 * before any search begins. Results therefore never depend on how often or in
 * what order a search happens to ask, and an impure predicate cannot make two
 * identical calls disagree.
 */

export type GridSize = Readonly<{ width: number; height: number }>;

export type GridCell = Readonly<{ x: number; y: number }>;

/** `width` by `height` cells whose lowest-index corner is `(x, y)`. */
export type GridRect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** A `side` by `side` block of cells whose lowest-index corner is `(x, y)`. */
export type GridSquare = Readonly<{ x: number; y: number; side: number }>;

/** Reports one cell. Which polarity it has (open, clear, occupied) is named by each caller. */
export type GridPredicate = (x: number, y: number) => boolean;

/** The cells a flood may step to: the 4 side neighbours, or those and the 4 diagonals. */
export type GridConnectivity = 4 | 8;

/** A set of cells. `cells[y * width + x]` is `1` for a member and `0` otherwise. */
export type GridMask = Readonly<{
  width: number;
  height: number;
  cells: Uint8Array;
  /** The number of member cells. */
  count: number;
}>;

/** One connected group of enclosed cells; `cells` are in ascending row-major order. */
export type GridRegion = Readonly<{ cells: readonly GridCell[] }>;

export type GridEnclosure = Readonly<{
  /** The cells the outside flood reached. */
  outside: GridMask;
  /** Open cells the outside flood did not reach, grouped; ordered by each group's first cell. */
  regions: readonly GridRegion[];
}>;

export type GridEnclosureOptions = Readonly<{
  /** The step the outside flood takes. Required: it decides what counts as a seal. */
  step: GridConnectivity;
  /** The step that groups enclosed cells into regions. Defaults to `step`. */
  regionStep?: GridConnectivity;
  /**
   * Where the outside begins. Defaults to every open cell on the grid's border,
   * which is the same as an open ring just outside the grid. Pass the open cells
   * at the edge of the land when the grid is a bounding box of irregular land.
   */
  seeds?: readonly GridCell[];
}>;

export type GridOccupancy = Readonly<{
  width: number;
  height: number;
  /** `occupant[y * width + x]` is the index of the first footprint to cover the cell, or `-1`. */
  occupant: Int32Array;
  occupied: GridMask;
  /** Ascending indices of footprints that cover a cell an earlier footprint already covers. */
  overlapping: readonly number[];
  /** Ascending indices of footprints with any cell outside the grid. */
  outOfBounds: readonly number[];
}>;

export type GridSquareOptions = Readonly<{
  /** The smallest side accepted. Defaults to 1. */
  minSide?: number;
  /** The largest side considered. Defaults to the shorter side of the grid. */
  maxSide?: number;
}>;

/** The largest grid, in cells, this module will allocate for (a 2048 by 2048 grid). */
export const GRID_MAX_CELLS = 4_194_304;

// The first four steps are the side neighbours, the last four the diagonals.
const STEP_X = Int8Array.of(0, 1, 0, -1, 1, 1, -1, -1);
const STEP_Y = Int8Array.of(-1, 0, 1, 0, -1, 1, 1, -1);

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`spatial: ${label} must be a safe integer.`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const checked = integer(value, label);
  if (checked < 1) throw new RangeError(`spatial: ${label} must be at least 1.`);
  return checked;
}

function readSize(size: unknown): GridSize {
  if (typeof size !== "object" || size === null) {
    throw new TypeError("spatial: size must be an object with width and height.");
  }
  const { width, height } = size as GridSize;
  const checkedWidth = positiveInteger(width, "size.width");
  const checkedHeight = positiveInteger(height, "size.height");
  if (checkedWidth * checkedHeight > GRID_MAX_CELLS) {
    throw new RangeError(`spatial: a grid may hold at most ${GRID_MAX_CELLS} cells.`);
  }
  return { width: checkedWidth, height: checkedHeight };
}

function readPredicate(predicate: unknown, label: string): GridPredicate {
  if (typeof predicate !== "function") {
    throw new TypeError(`spatial: ${label} must be a function.`);
  }
  return predicate as GridPredicate;
}

function readConnectivity(value: unknown, label: string): GridConnectivity {
  if (value !== 4 && value !== 8) throw new RangeError(`spatial: ${label} must be 4 or 8.`);
  return value;
}

function readCell(value: unknown, label: string): GridCell {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`spatial: ${label} must be a cell.`);
  }
  const { x, y } = value as GridCell;
  return { x: integer(x, `${label}.x`), y: integer(y, `${label}.y`) };
}

/** Reads `predicate` once per cell, row-major, into a 0/1 array. */
function rasterize(size: GridSize, predicate: GridPredicate): Uint8Array {
  const { width, height } = size;
  const cells = new Uint8Array(width * height);
  let index = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells[index++] = predicate(x, y) ? 1 : 0;
    }
  }
  return cells;
}

function countMembers(cells: Uint8Array): number {
  let count = 0;
  for (const cell of cells) count += cell;
  return count;
}

function toCell(index: number, width: number): GridCell {
  const x = index % width;
  return { x, y: (index - x) / width };
}

/**
 * Grows `reached` from the first `tail` entries of `queue` across `open` cells
 * and returns the new `tail`. A cell joins `reached` and `queue` at most once.
 */
function spread(
  open: Uint8Array,
  reached: Uint8Array,
  queue: Int32Array,
  start: number,
  tail: number,
  size: GridSize,
  step: GridConnectivity,
): number {
  const { width, height } = size;
  let end = tail;
  for (let head = start; head < end; head++) {
    const index = queue[head] as number;
    const x = index % width;
    const y = (index - x) / width;
    for (let k = 0; k < step; k++) {
      const nx = x + (STEP_X[k] as number);
      const ny = y + (STEP_Y[k] as number);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (open[next] === 1 && reached[next] === 0) {
        reached[next] = 1;
        queue[end++] = next;
      }
    }
  }
  return end;
}

/** Seeds that are not open are skipped, so a flood never begins on a blocked cell. */
function flood(
  open: Uint8Array,
  size: GridSize,
  seedIndices: readonly number[],
  step: GridConnectivity,
): GridMask {
  const reached = new Uint8Array(open.length);
  const queue = new Int32Array(open.length);
  let tail = 0;
  for (const seed of seedIndices) {
    if (open[seed] === 1 && reached[seed] === 0) {
      reached[seed] = 1;
      queue[tail++] = seed;
    }
  }
  const count = spread(open, reached, queue, 0, tail, size, step);
  return { width: size.width, height: size.height, cells: reached, count };
}

function readSeedIndices(size: GridSize, seeds: unknown): number[] {
  if (!Array.isArray(seeds)) throw new TypeError("spatial: seeds must be an array of cells.");
  const hasOwn = Object.prototype.hasOwnProperty;
  const indices: number[] = new Array(seeds.length);
  for (let i = 0; i < seeds.length; i++) {
    if (!hasOwn.call(seeds, i)) throw new TypeError(`spatial: seeds[${i}] is sparse.`);
    const { x, y } = readCell(seeds[i], `seeds[${i}]`);
    if (x < 0 || y < 0 || x >= size.width || y >= size.height) {
      throw new RangeError(`spatial: seeds[${i}] lies outside the grid.`);
    }
    indices[i] = y * size.width + x;
  }
  return indices;
}

/** Collects the cells of `predicate` into a mask. The predicate is read once per cell. */
export function createGridMask(size: GridSize, predicate: GridPredicate): GridMask {
  const checked = readSize(size);
  const cells = rasterize(checked, readPredicate(predicate, "predicate"));
  return { width: checked.width, height: checked.height, cells, count: countMembers(cells) };
}

/** Whether `(x, y)` is a member. A cell outside the grid is never a member. */
export function gridMaskHas(mask: GridMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.cells[y * mask.width + x] === 1;
}

/** The member cells in ascending row-major order. */
export function gridMaskCells(mask: GridMask): GridCell[] {
  const cells: GridCell[] = [];
  for (let index = 0; index < mask.cells.length; index++) {
    if (mask.cells[index] === 1) cells.push(toCell(index, mask.width));
  }
  return cells;
}

/**
 * Lays footprints on the grid. Footprints are applied in order: the first to
 * cover a cell owns it in `occupant`. A footprint that covers an owned cell is
 * listed in `overlapping`, and one that leaves the grid in `outOfBounds`; both
 * are data, never an exception, and a footprint's in-bounds cells are still
 * laid. Rotation is the caller's: pass the footprint already turned.
 */
export function buildGridOccupancy(size: GridSize, footprints: readonly GridRect[]): GridOccupancy {
  const { width, height } = readSize(size);
  if (!Array.isArray(footprints)) {
    throw new TypeError("spatial: footprints must be an array of rectangles.");
  }
  const hasOwn = Object.prototype.hasOwnProperty;
  const rects: GridRect[] = new Array(footprints.length);
  for (let i = 0; i < footprints.length; i++) {
    if (!hasOwn.call(footprints, i)) throw new TypeError(`spatial: footprints[${i}] is sparse.`);
    const value: unknown = footprints[i];
    if (typeof value !== "object" || value === null) {
      throw new TypeError(`spatial: footprints[${i}] must be a rectangle.`);
    }
    const rect = value as GridRect;
    rects[i] = {
      x: integer(rect.x, `footprints[${i}].x`),
      y: integer(rect.y, `footprints[${i}].y`),
      width: positiveInteger(rect.width, `footprints[${i}].width`),
      height: positiveInteger(rect.height, `footprints[${i}].height`),
    };
  }
  const occupant = new Int32Array(width * height).fill(-1);
  const overlapping: number[] = [];
  const outOfBounds: number[] = [];
  let count = 0;
  rects.forEach((rect, owner) => {
    const x1 = rect.x + rect.width;
    const y1 = rect.y + rect.height;
    if (rect.x < 0 || rect.y < 0 || x1 > width || y1 > height) outOfBounds.push(owner);
    let overlaps = false;
    for (let y = Math.max(rect.y, 0); y < Math.min(y1, height); y++) {
      for (let x = Math.max(rect.x, 0); x < Math.min(x1, width); x++) {
        const index = y * width + x;
        if (occupant[index] === -1) {
          occupant[index] = owner;
          count++;
        } else {
          overlaps = true;
        }
      }
    }
    if (overlaps) overlapping.push(owner);
  });
  const cells = new Uint8Array(width * height);
  for (let i = 0; i < cells.length; i++) cells[i] = occupant[i] === -1 ? 0 : 1;
  return {
    width,
    height,
    occupant,
    occupied: { width, height, cells, count },
    overlapping,
    outOfBounds,
  };
}

/**
 * Every open cell reachable from `seeds` by steps through open cells, in one
 * flood: the cell sets of `step` 4 and 8 are the two reachability rules.
 *
 * A flood under `step` 8 passes between two blocked cells that touch only at a
 * corner; there is deliberately no corner-cutting rule, so a barrier seals only
 * when its pieces join side to side (`step` 4 respects such a gap). A seed that
 * is not open is never entered. A seed outside the grid is an error.
 */
export function floodGrid(
  size: GridSize,
  open: GridPredicate,
  seeds: readonly GridCell[],
  step: GridConnectivity,
): GridMask {
  const checked = readSize(size);
  const reader = readPredicate(open, "open");
  const rule = readConnectivity(step, "step");
  const seedIndices = readSeedIndices(checked, seeds);
  return flood(rasterize(checked, reader), checked, seedIndices, rule);
}

/**
 * Floods the outside through open cells and returns the open cells it never
 * reached, grouped into connected regions. The outside begins at the grid's
 * border unless `seeds` say otherwise, which is the same as an open ring just
 * beyond the grid. A barrier lying on the border row or column therefore closes
 * a region, while barrier cells beside open border cells do not.
 *
 * Regions are numbered by the row-major order of their first cell, and each
 * region's cells ascend in row-major order. Grouping uses `regionStep`, which
 * defaults to `step`: two pockets that touch only at a corner are one region
 * when it is 8. Deciding which barrier cells bound a region is the caller's;
 * a barrier cell may touch a region only diagonally.
 */
export function enclosedGridRegions(
  size: GridSize,
  open: GridPredicate,
  options: GridEnclosureOptions,
): GridEnclosure {
  const checked = readSize(size);
  const reader = readPredicate(open, "open");
  if (typeof options !== "object" || options === null) {
    throw new TypeError("spatial: options must be an object with a step.");
  }
  const step = readConnectivity(options.step, "options.step");
  const regionStep = readConnectivity(options.regionStep ?? step, "options.regionStep");
  const { width, height } = checked;
  const seedIndices =
    options.seeds === undefined
      ? borderIndices(width, height)
      : readSeedIndices(checked, options.seeds);

  const cells = rasterize(checked, reader);
  const outside = flood(cells, checked, seedIndices, step);
  // What remains open is exactly the enclosed cells. Outside cells are retired
  // so a region flood stays inside the enclosure whatever `regionStep` is.
  for (let i = 0; i < cells.length; i++) {
    if (outside.cells[i] === 1) cells[i] = 0;
  }
  const seen = new Uint8Array(cells.length);
  const queue = new Int32Array(cells.length);
  const regions: GridRegion[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== 1 || seen[start] === 1) continue;
    seen[start] = 1;
    queue[0] = start;
    const end = spread(cells, seen, queue, 0, 1, checked, regionStep);
    const members = queue.slice(0, end).sort();
    regions.push({ cells: Array.from(members, (index) => toCell(index, width)) });
  }
  return { outside, regions };
}

function borderIndices(width: number, height: number): number[] {
  const indices: number[] = [];
  for (let x = 0; x < width; x++) {
    indices.push(x);
    if (height > 1) indices.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    indices.push(y * width);
    if (width > 1) indices.push(y * width + width - 1);
  }
  return indices;
}

/**
 * The largest square of clear cells that contains the whole `target` (a cell,
 * or a rectangle of cells), or `null` when none of side `minSide` to `maxSide`
 * does. A square may extend in any direction from the target. Among squares of
 * the largest side, the one whose corner has the lowest `y`, then the lowest
 * `x`, is returned. The target must lie inside the grid and be clear.
 *
 * The predicate is read only for the cells a qualifying square could cover,
 * once each, row-major. Pass `minSide` one above a current square's side to ask
 * whether it can grow, and `maxSide` to cap how large a square is worth having.
 */
export function largestClearGridSquare(
  size: GridSize,
  clear: GridPredicate,
  target: GridCell | GridRect,
  options: GridSquareOptions = {},
): GridSquare | null {
  const checked = readSize(size);
  const reader = readPredicate(clear, "clear");
  const { tx, ty, tw, th, minSide, maxSide } = readSquareRequest(target, options);
  const { width, height } = checked;
  const largest = Math.min(maxSide, width, height);
  const smallest = Math.max(minSide, tw, th);
  if (tx < 0 || ty < 0 || tx + tw > width || ty + th > height || smallest > largest) return null;

  // Only cells within `largest - 1` of the target can belong to a candidate.
  const x0 = Math.max(0, tx + tw - largest);
  const y0 = Math.max(0, ty + th - largest);
  const x1 = Math.min(width, tx + largest);
  const y1 = Math.min(height, ty + largest);
  const blockedIn = blockedCounter(reader, x0, y0, x1, y1);
  if (blockedIn(tx, ty, tw, th) > 0) return null;
  for (let side = largest; side >= smallest; side--) {
    const lastY = Math.min(ty, y1 - side);
    const lastX = Math.min(tx, x1 - side);
    for (let y = Math.max(y0, ty + th - side); y <= lastY; y++) {
      for (let x = Math.max(x0, tx + tw - side); x <= lastX; x++) {
        if (blockedIn(x, y, side, side) === 0) return { x, y, side };
      }
    }
  }
  return null;
}

function readSquareRequest(target: unknown, options: unknown) {
  if (typeof target !== "object" || target === null) {
    throw new TypeError("spatial: target must be a cell or a rectangle.");
  }
  if (typeof options !== "object" || options === null) {
    throw new TypeError("spatial: options must be an object.");
  }
  const cell = target as GridRect;
  const bounds = options as GridSquareOptions;
  return {
    tx: integer(cell.x, "target.x"),
    ty: integer(cell.y, "target.y"),
    tw: positiveInteger(cell.width ?? 1, "target.width"),
    th: positiveInteger(cell.height ?? 1, "target.height"),
    minSide: positiveInteger(bounds.minSide ?? 1, "options.minSide"),
    maxSide: positiveInteger(bounds.maxSide ?? Number.MAX_SAFE_INTEGER, "options.maxSide"),
  };
}

/**
 * Reads `clear` once per cell of the window `[x0, x1) x [y0, y1)`, row-major,
 * into a summed-area table, and returns a counter of the blocked cells in any
 * `w` by `h` rectangle whose corner `(x, y)` lies inside the window.
 */
function blockedCounter(
  clear: GridPredicate,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): (x: number, y: number, w: number, h: number) => number {
  const stride = x1 - x0 + 1;
  // table[(y - y0) * stride + (x - x0)] counts blocked cells above and left of (x, y).
  const table = new Int32Array(stride * (y1 - y0 + 1));
  for (let y = y0; y < y1; y++) {
    let row = 0;
    for (let x = x0; x < x1; x++) {
      row += clear(x, y) ? 0 : 1;
      const at = (y - y0 + 1) * stride + (x - x0 + 1);
      table[at] = (table[at - stride] as number) + row;
    }
  }
  return (x, y, w, h) => {
    const left = x - x0;
    const top = y - y0;
    return (
      (table[(top + h) * stride + left + w] as number) -
      (table[top * stride + left + w] as number) -
      (table[(top + h) * stride + left] as number) +
      (table[top * stride + left] as number)
    );
  };
}
