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
      throw new TypeError("walker: IDs must be nonempty and unique.");
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
// Slab intersection. Open interiors for body sweeps let a touching body slide.
function intersect(
  from: WalkerPoint,
  to: WalkerPoint,
  s: WalkerSolid,
  open: boolean,
): number | null {
  let enter = 0,
    leave = 1;
  for (const axis of axes) {
    const delta = to[axis] - from[axis];
    if (delta === 0) {
      if (
        open
          ? from[axis] <= s.min[axis] + EPS || from[axis] >= s.max[axis] - EPS
          : from[axis] < s.min[axis] || from[axis] > s.max[axis]
      )
        return null;
    } else {
      const a = (s.min[axis] - from[axis]) / delta,
        b = (s.max[axis] - from[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
    }
  }
  if (open ? enter >= leave : enter > leave) return null;
  return enter;
}
function firstHit(
  from: WalkerPoint,
  to: WalkerPoint,
  solids: readonly WalkerSolid[],
  open: boolean,
): WalkerSegmentHit | null {
  let hit: WalkerSegmentHit | null = null;
  for (const solid of solids) {
    const fraction = intersect(from, to, solid, open);
    if (
      fraction !== null &&
      (!hit ||
        fraction < hit.fraction ||
        (fraction === hit.fraction && compareId(solid.id, hit.id) < 0))
    ) {
      hit = { id: solid.id, fraction, point: interpolate(from, to, fraction) };
    }
  }
  return hit;
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
  let position = { ...state.position };
  let supportId = state.supportId;
  const contacts = new Set<string>();
  let blocked = false;
  const currentSupport = queryWalkerSupport(state, world);
  if (!currentSupport)
    return { state: { ...state, position }, status: "invalid-support", contacts: [] };
  supportId = currentSupport.id;
  const solids = world.solids.map((s) => expanded(s, state));
  for (const axis of ["x", "z"] as const) {
    const distance = displacement[axis];
    if (distance === 0) continue;
    const origin = { ...position };
    const cuts = [0, 1];
    for (const s of world.supports) {
      const edges = axis === "x" ? [s.minX, s.maxX] : [s.minZ, s.maxZ];
      for (const edge of edges) {
        const t = (edge - origin[axis]) / distance;
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
    const ordered = [...new Set(cuts)].sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i++) {
      const start = ordered[i - 1] as number,
        end = ordered[i] as number;
      const middle = { ...position, [axis]: origin[axis] + (distance * (start + end)) / 2 };
      const support = supports(middle, world).find(
        (s) => Math.abs(height(s, position) - position.y) <= state.maxStep + EPS,
      );
      if (!support) {
        blocked = true;
        break;
      }
      const raised = { ...position, y: height(support, position) };
      const verticalHit = firstHit(position, raised, solids, true);
      if (verticalHit) {
        blocked = true;
        contacts.add(verticalHit.id);
        break;
      }
      const target = { ...raised, [axis]: origin[axis] + distance * end };
      target.y = height(support, target);
      const hit = firstHit(raised, target, solids, true);
      position = hit ? hit.point : target;
      supportId = support.id;
      if (hit) {
        blocked = true;
        contacts.add(hit.id);
        break;
      }
    }
  }
  return {
    state: { ...state, position, supportId },
    status: blocked ? "blocked" : "moved",
    contacts: [...contacts].sort(compareId),
  };
}
