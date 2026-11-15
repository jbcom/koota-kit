/** Renderer-independent grounded walking over authored rectangular planes. */
export type WalkerPoint = { x: number; y: number; z: number };
export type WalkerSolid = { id: string; min: WalkerPoint; max: WalkerPoint };
/** y is the height at (minX,minZ); slopes are rise per horizontal unit. */
export type WalkerSupport = {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  slopeX: number;
  slopeZ: number;
};
/** IDs are nonempty and unique across both solids and supports. */
export type WalkerWorld = { supports: readonly WalkerSupport[]; solids: readonly WalkerSolid[] };
/** Position is the centre of the feet. The body is an upright square prism. */
export type WalkerState = {
  position: WalkerPoint;
  halfWidth: number;
  height: number;
  maxStep: number;
  supportId: string | null;
};
export type WalkerSupportHit = { id: string; y: number };
export type WalkerSegmentHit = { id: string; fraction: number; point: WalkerPoint };
export type WalkerResult = {
  state: WalkerState;
  status: "moved" | "blocked" | "invalid-support";
  contacts: string[];
};
/** A straight horizontal path certificate; state is its last reached supported point. */
export type WalkerPathResult = WalkerResult & { walkable: boolean };
const EPS = 1e-9;
const axes = ["x", "y", "z"] as const;
function finite(...values: number[]): void {
  if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9)) {
    throw new RangeError("walker: numbers must be finite and within +/- 1e9.");
  }
}
function point(p: WalkerPoint): void {
  finite(p.x, p.y, p.z);
}
function validate(world: WalkerWorld): void {
  const ids = new Set<string>();
  for (const item of [...world.solids, ...world.supports]) {
    if (!item.id || ids.has(item.id))
      throw new TypeError("walker: IDs must be nonempty and unique across solids and supports.");
    ids.add(item.id);
  }
  for (const s of world.solids) {
    point(s.min);
    point(s.max);
    if (axes.some((axis) => s.min[axis] >= s.max[axis]))
      throw new RangeError("walker: solid bounds must have positive volume.");
  }
  for (const s of world.supports) {
    finite(s.minX, s.maxX, s.minZ, s.maxZ, s.y, s.slopeX, s.slopeZ);
    if (s.minX >= s.maxX || s.minZ >= s.maxZ || Math.hypot(s.slopeX, s.slopeZ) > 1)
      throw new RangeError("walker: support bounds must have area and slope at most one.");
  }
}
function validateState(state: WalkerState): void {
  point(state.position);
  finite(state.halfWidth, state.height, state.maxStep);
  if (state.halfWidth <= EPS || state.height <= EPS || state.maxStep < 0)
    throw new RangeError("walker: body dimensions must be positive and maxStep nonnegative.");
}
function height(s: WalkerSupport, p: WalkerPoint): number {
  return s.y + (p.x - s.minX) * s.slopeX + (p.z - s.minZ) * s.slopeZ;
}
function contains(s: WalkerSupport, p: WalkerPoint): boolean {
  return p.x >= s.minX && p.x <= s.maxX && p.z >= s.minZ && p.z <= s.maxZ;
}
function expanded(s: WalkerSolid, state: WalkerState): WalkerSolid {
  return {
    id: s.id,
    min: { x: s.min.x - state.halfWidth, y: s.min.y - state.height, z: s.min.z - state.halfWidth },
    max: { x: s.max.x + state.halfWidth, y: s.max.y, z: s.max.z + state.halfWidth },
  };
}
function clear(p: WalkerPoint, state: WalkerState, world: WalkerWorld): boolean {
  return !world.solids.some((solid) => {
    const s = expanded(solid, state);
    return axes.every((axis) => p[axis] > s.min[axis] + EPS && p[axis] < s.max[axis] - EPS);
  });
}
function supports(p: WalkerPoint, world: WalkerWorld): WalkerSupport[] {
  return world.supports
    .filter((s) => contains(s, p))
    .sort((a, b) => height(b, p) - height(a, p) || compareId(a.id, b.id));
}
function compareId(a: string, b: string): number {
  return a < b ? -1 : 1;
}
/** Exact current support, including whole-body clearance; never relocates a body. */
export function queryWalkerSupport(
  state: WalkerState,
  world: WalkerWorld,
): WalkerSupportHit | null {
  validate(world);
  validateState(state);
  const support = supports(state.position, world).find(
    (s) => Math.abs(height(s, state.position) - state.position.y) <= EPS,
  );
  if (!support || !clear(state.position, state, world)) return null;
  return { id: support.id, y: height(support, state.position) };
}
function interpolate(from: WalkerPoint, to: WalkerPoint, t: number): WalkerPoint {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}
function withinSlab(value: number, min: number, max: number, open: boolean): boolean {
  if (open) return value > min + EPS && value < max - EPS;
  return value >= min && value <= max;
}
// Exact slab interval ordering prevents a long sweep collapsing a thin hit.
// Open interiors for body sweeps let a touching body slide.
function intersect(
  from: WalkerPoint,
  to: WalkerPoint,
  solid: WalkerSolid,
  open: boolean,
  exact: ExactNumbers,
): PathBoundary | null {
  let enter = PATH_START,
    leave = PATH_END;
  for (const axis of axes) {
    if (from[axis] === to[axis]) {
      if (!withinSlab(from[axis], solid.min[axis], solid.max[axis], open)) return null;
    } else {
      const [lower, upper] = axisBoundaries(
        from,
        to,
        axis,
        solid.min[axis],
        solid.max[axis],
        exact,
      );
      if (compareBoundary(lower, enter) > 0) enter = lower;
      if (compareBoundary(upper, leave) < 0) leave = upper;
    }
  }
  const order = compareBoundary(enter, leave);
  const overlaps = open ? order < 0 : order <= 0;
  return overlaps ? enter : null;
}
function firstHit(
  from: WalkerPoint,
  to: WalkerPoint,
  solids: readonly WalkerSolid[],
  open: boolean,
  exact: ExactNumbers = exactNumbers(),
): WalkerSegmentHit | null {
  let nearest: { boundary: PathBoundary; id: string } | null = null;
  for (const solid of solids) {
    const boundary = intersect(from, to, solid, open, exact);
    if (boundary === null) continue;
    if (
      !nearest ||
      compareBoundary(boundary, nearest.boundary) < 0 ||
      (compareBoundary(boundary, nearest.boundary) === 0 && compareId(solid.id, nearest.id) < 0)
    ) {
      nearest = { boundary, id: solid.id };
    }
  }
  if (!nearest) return null;
  const { boundary, id } = nearest;
  return {
    id,
    fraction: boundary.fraction,
    point: { ...interpolate(from, to, boundary.fraction), ...boundary.coordinates },
  };
}
/** Closed segment: starts inside/on a solid hit at zero; endpoints count. */
export function querySegmentOcclusion(
  from: WalkerPoint,
  to: WalkerPoint,
  world: WalkerWorld,
): WalkerSegmentHit | null {
  validate(world);
  point(from);
  point(to);
  return firstHit(from, to, world.solids, false);
}
function supportCuts(
  origin: WalkerPoint,
  axis: "x" | "z",
  distance: number,
  world: WalkerWorld,
): number[] {
  const cuts = new Set([0, 1]);
  for (const support of world.supports) {
    const edges = axis === "x" ? [support.minX, support.maxX] : [support.minZ, support.maxZ];
    for (const edge of edges) {
      const t = (edge - origin[axis]) / distance;
      if (t > 0 && t < 1) cuts.add(t);
    }
  }
  return [...cuts].sort((a, b) => a - b);
}
function advanceInterval(
  state: WalkerState,
  axis: "x" | "z",
  middleCoordinate: number,
  endCoordinate: number,
  world: WalkerWorld,
  solids: readonly WalkerSolid[],
): WalkerResult {
  const position = state.position;
  const middle = { ...position, [axis]: middleCoordinate };
  // maxStep limits the discontinuity at the entry boundary, not a ramp's
  // continuous rise across the interval. Testing the midpoint height here
  // would incorrectly turn a long traversable ramp into an impassable step.
  const support = supports(middle, world).find(
    (s) => Math.abs(height(s, position) - position.y) <= state.maxStep + EPS,
  );
  return advanceOnSupport(state, support, { ...position, [axis]: endCoordinate }, solids);
}
function advanceOnSupport(
  state: WalkerState,
  support: WalkerSupport | undefined,
  destination: WalkerPoint,
  solids: readonly WalkerSolid[],
  exact: ExactNumbers = exactNumbers(),
): WalkerResult {
  if (!support) return { state, status: "blocked", contacts: [] };
  const position = state.position;
  const raised = { ...position, y: height(support, position) };
  const verticalHit = firstHit(position, raised, solids, true, exact);
  if (verticalHit) return { state, status: "blocked", contacts: [verticalHit.id] };
  const target = { ...destination, y: height(support, destination) };
  const hit = firstHit(raised, target, solids, true, exact);
  return {
    state: { ...state, position: hit ? hit.point : target, supportId: support.id },
    status: hit ? "blocked" : "moved",
    contacts: hit ? [hit.id] : [],
  };
}

function advanceAxis(
  state: WalkerState,
  axis: "x" | "z",
  distance: number,
  world: WalkerWorld,
  solids: readonly WalkerSolid[],
): WalkerResult {
  let result: WalkerResult = { state, status: "moved", contacts: [] };
  if (distance === 0) return result;
  const origin = state.position;
  const ordered = supportCuts(origin, axis, distance, world);
  for (let i = 1; i < ordered.length; i++) {
    const start = ordered[i - 1] as number,
      end = ordered[i] as number;
    result = advanceInterval(
      result.state,
      axis,
      origin[axis] + (distance * (start + end)) / 2,
      origin[axis] + distance * end,
      world,
      solids,
    );
    if (result.status === "blocked") break;
  }
  return result;
}
/**
 * One fixed-tick world-space displacement. X then Z gives stable wall sliding.
 * Support-boundary subdivision and continuous body sweeps prevent tunnelling;
 * no integration, gravity, stepping clock, input or renderer is owned here.
 */
export function advanceWalker(
  state: WalkerState,
  displacement: { x: number; z: number },
  world: WalkerWorld,
): WalkerResult {
  validate(world);
  validateState(state);
  finite(displacement.x, displacement.z);
  let next = { ...state, position: { ...state.position } };
  const currentSupport = queryWalkerSupport(state, world);
  if (!currentSupport) return { state: next, status: "invalid-support", contacts: [] };
  next.supportId = currentSupport.id;
  const solids = world.solids.map((s) => expanded(s, state));
  const contacts = new Set<string>();
  let blocked = false;
  for (const axis of ["x", "z"] as const) {
    const result = advanceAxis(next, axis, displacement[axis], world, solids);
    next = result.state;
    if (result.status === "blocked") blocked = true;
    for (const id of result.contacts) contacts.add(id);
  }
  return {
    state: next,
    status: blocked ? "blocked" : "moved",
    contacts: [...contacts].sort(compareId),
  };
}

type PathBoundary = {
  fraction: number;
  numerator: bigint;
  denominator: bigint;
  coordinates: Partial<WalkerPoint>;
};
type SupportInterval = { support: WalkerSupport; start: PathBoundary; end: PathBoundary };
const PATH_START: PathBoundary = { fraction: 0, numerator: 0n, denominator: 1n, coordinates: {} };
const PATH_END: PathBoundary = { fraction: 1, numerator: 1n, denominator: 1n, coordinates: {} };
// Each synchronous sweep owns its scratch bytes and bounded conversion memo. No world,
// coordinates or mutable result survives the query, and nested queries cannot share scratch.
type ExactNumbers = { view: DataView; values: Map<number, bigint> };
function exactNumbers(): ExactNumbers {
  return { view: new DataView(new ArrayBuffer(8)), values: new Map() };
}
/** Exact integer value in units of the smallest IEEE-754 subnormal, 2^-1074. */
function exactNumber(value: number, exact: ExactNumbers): bigint {
  const previous = exact.values.get(value);
  if (previous !== undefined) return previous;
  const view = exact.view;
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = (bits >> 52n) & 0x7ffn;
  let mantissa = bits & 0xfffffffffffffn;
  if (exponent !== 0n) mantissa = (mantissa | 0x10000000000000n) << (exponent - 1n);
  const result = bits >> 63n ? -mantissa : mantissa;
  if (exact.values.size < 256) exact.values.set(value, result);
  return result;
}
function boundaryAt(
  from: WalkerPoint,
  to: WalkerPoint,
  axis: "x" | "y" | "z",
  coordinate: number,
  exact: ExactNumbers,
): PathBoundary {
  let numerator = exactNumber(coordinate, exact) - exactNumber(from[axis], exact);
  let denominator = exactNumber(to[axis], exact) - exactNumber(from[axis], exact);
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  return {
    fraction: (coordinate - from[axis]) / (to[axis] - from[axis]),
    numerator,
    denominator,
    coordinates: { [axis]: coordinate },
  };
}
function compareBoundary(a: PathBoundary, b: PathBoundary): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  if (difference === 0n) return 0;
  return difference < 0n ? -1 : 1;
}
function axisBoundaries(
  from: WalkerPoint,
  to: WalkerPoint,
  axis: "x" | "y" | "z",
  min: number,
  max: number,
  exact: ExactNumbers,
): [PathBoundary, PathBoundary] {
  const a = boundaryAt(from, to, axis, min, exact),
    b = boundaryAt(from, to, axis, max, exact);
  return compareBoundary(a, b) < 0 ? [a, b] : [b, a];
}
/** Analytic XZ slab interval. Exact ordering cannot collapse a real support gap. */
function supportInterval(
  from: WalkerPoint,
  to: WalkerPoint,
  support: WalkerSupport,
  exact: ExactNumbers,
): SupportInterval | null {
  let start = PATH_START,
    end = PATH_END;
  for (const [axis, min, max] of [
    ["x", support.minX, support.maxX],
    ["z", support.minZ, support.maxZ],
  ] as const) {
    if (from[axis] === to[axis]) {
      if (from[axis] < min || from[axis] > max) return null;
    } else {
      const [lower, upper] = axisBoundaries(from, to, axis, min, max, exact);
      if (compareBoundary(lower, start) > 0) start = lower;
      if (compareBoundary(upper, end) < 0) end = upper;
    }
  }
  return compareBoundary(start, end) < 0 ? { support, start, end } : null;
}
function pathCuts(intervals: readonly SupportInterval[]): PathBoundary[] {
  const sorted = [
    PATH_START,
    PATH_END,
    ...intervals.flatMap((interval) => [interval.start, interval.end]),
  ].sort(compareBoundary);
  const cuts: PathBoundary[] = [];
  for (const boundary of sorted) {
    const previous = cuts[cuts.length - 1];
    if (previous && compareBoundary(previous, boundary) === 0) {
      Object.assign(previous.coordinates, boundary.coordinates);
    } else cuts.push({ ...boundary, coordinates: { ...boundary.coordinates } });
  }
  return cuts;
}
function pathSupport(
  intervals: readonly SupportInterval[],
  start: PathBoundary,
  end: PathBoundary,
  state: WalkerState,
): WalkerSupport | undefined {
  return intervals
    .filter(
      (interval) =>
        compareBoundary(interval.start, start) <= 0 && compareBoundary(interval.end, end) >= 0,
    )
    .map((interval) => interval.support)
    .sort((a, b) => height(b, state.position) - height(a, state.position) || compareId(a.id, b.id))
    .find(
      (support) =>
        Math.abs(height(support, state.position) - state.position.y) <= state.maxStep + EPS,
    );
}
/**
 * Certify the actual straight XZ path while following support heights. Unlike
 * advanceWalker, this never substitutes an axis-ordered route or wall sliding.
 * Target Y must agree with reached support height within 1e-9 world units.
 */
export function queryWalkerPath(
  state: WalkerState,
  target: WalkerPoint,
  world: WalkerWorld,
): WalkerPathResult {
  const support = queryWalkerSupport(state, world);
  point(target);
  const initial = { ...state, position: { ...state.position } };
  if (!support) return { state: initial, status: "invalid-support", contacts: [], walkable: false };
  initial.supportId = support.id;
  if (state.position.x === target.x && state.position.z === target.z) {
    initial.position.y = support.y;
    const walkable = Math.abs(support.y - target.y) <= EPS;
    return { state: initial, status: walkable ? "moved" : "blocked", contacts: [], walkable };
  }
  const exact = exactNumbers();
  const intervals = world.supports
    .map((candidate) => supportInterval(state.position, target, candidate, exact))
    .filter((interval): interval is SupportInterval => interval !== null);
  const cuts = pathCuts(intervals);
  const solids = world.solids.map((solid) => expanded(solid, state));
  let result: WalkerResult = { state: initial, status: "moved", contacts: [] };
  for (let index = 1; index < cuts.length; index++) {
    const start = cuts[index - 1] as PathBoundary,
      end = cuts[index] as PathBoundary;
    const destination =
      compareBoundary(end, PATH_END) === 0
        ? { ...target }
        : { ...interpolate(state.position, target, end.fraction), ...end.coordinates };
    const nextSupport = pathSupport(intervals, start, end, result.state);
    result = advanceOnSupport(result.state, nextSupport, destination, solids, exact);
    if (result.status === "blocked") return { ...result, walkable: false };
  }
  const walkable = Math.abs(result.state.position.y - target.y) <= EPS;
  return { ...result, status: walkable ? "moved" : "blocked", walkable };
}
