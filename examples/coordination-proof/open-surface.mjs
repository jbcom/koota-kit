export class NumericalOracleRangeError extends RangeError {
  constructor() {
    super("proof: numerical oracle range exceeded");
    this.name = "NumericalOracleRangeError";
  }
}
const MIN_NORMAL = 2 ** -1022;
const checked = (value) => {
  if (!Number.isFinite(value) || (value !== 0 && Math.abs(value) < MIN_NORMAL))
    throw new NumericalOracleRangeError();
  return value;
};
const sum = (...values) => values.reduce((total, value) => checked(total + value), 0);
const product = (left, right) => {
  const value = checked(left * right);
  if (value === 0 && left !== 0 && right !== 0) throw new NumericalOracleRangeError();
  return value;
};
const quotient = (numerator, denominator) => {
  if (denominator === 0) throw new NumericalOracleRangeError();
  const value = checked(numerator / denominator);
  if (value === 0 && numerator !== 0) throw new NumericalOracleRangeError();
  return value;
};
const point = (x, y, z) => Object.freeze({ x: checked(x), y: checked(y), z: checked(z) });
const sub = (a, b) => [checked(a.x - b.x), checked(a.y - b.y), checked(a.z - b.z)];
const dot = (a, b) => sum(product(a[0], b[0]), product(a[1], b[1]), product(a[2], b[2]));

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Column-major affine transformation, applied to every vertex before ranking. */
export function worldPositions(positions, matrix) {
  if (
    matrix.length !== 16 ||
    matrix.some((value) => !Number.isFinite(value)) ||
    matrix[3] !== 0 ||
    matrix[7] !== 0 ||
    matrix[11] !== 0 ||
    matrix[15] !== 1
  ) {
    throw new Error("proof: expected a finite column-major affine transform");
  }
  const output = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = positions.subarray(i, i + 3);
    output[i] = sum(
      product(matrix[0], x),
      product(matrix[4], y),
      product(matrix[8], z),
      matrix[12],
    );
    output[i + 1] = sum(
      product(matrix[1], x),
      product(matrix[5], y),
      product(matrix[9], z),
      matrix[13],
    );
    output[i + 2] = sum(
      product(matrix[2], x),
      product(matrix[6], y),
      product(matrix[10], z),
      matrix[14],
    );
  }
  if (output.some((value) => !Number.isFinite(value))) throw new Error("proof: transform overflow");
  return output;
}

export function indexedBounds(positions, indices) {
  if (indices.length === 0) throw new Error("proof: empty topology has no certified bounds");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const index of indices) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index * 3 + axis]);
      max[axis] = Math.max(max[axis], positions[index * 3 + axis]);
    }
  }
  return Object.freeze({ min: point(...min), max: point(...max) });
}

// Bounded reference oracle only; deliberately exhaustive, with no cache or BVH.
function closestTriangle(p, a, b, c) {
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a);
  const d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b),
    d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = checked(product(d1, d4) - product(d3, d2));
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = quotient(d1, checked(d1 - d3));
    return [checked(1 - v), v, 0];
  }
  const cp = sub(p, c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = checked(product(d5, d2) - product(d1, d6));
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = quotient(d2, checked(d2 - d6));
    return [checked(1 - w), 0, w];
  }
  const va = checked(product(d3, d6) - product(d5, d4));
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const numerator = checked(d4 - d3);
    const w = quotient(numerator, sum(numerator, checked(d5 - d6)));
    return [0, checked(1 - w), w];
  }
  const denominator = sum(va, vb, vc);
  if (denominator <= 0) throw new NumericalOracleRangeError();
  const inverse = quotient(1, denominator),
    v = product(vb, inverse),
    w = product(vc, inverse);
  return [sum(1, -v, -w), v, w];
}

export function nearestOpenSurface(positions, indices, query, sourceFaceIds) {
  let best;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices = [0, 1, 2].map((corner) => {
      const i = indices[offset + corner] * 3;
      return point(positions[i], positions[i + 1], positions[i + 2]);
    });
    const [a, b, c] = vertices,
      ab = sub(b, a),
      ac = sub(c, a);
    const cross = [
      checked(product(ab[1], ac[2]) - product(ab[2], ac[1])),
      checked(product(ab[2], ac[0]) - product(ab[0], ac[2])),
      checked(product(ab[0], ac[1]) - product(ab[1], ac[0])),
    ];
    const area = checked(Math.hypot(...cross));
    let barycentric;
    if (area === 0) {
      const candidates = [
        [0, 1],
        [1, 2],
        [2, 0],
      ].map(([start, end]) => {
        const edge = sub(vertices[end], vertices[start]);
        const length = dot(edge, edge);
        const t =
          length === 0
            ? 0
            : Math.max(0, Math.min(1, quotient(dot(sub(query, vertices[start]), edge), length)));
        const weights = [0, 0, 0];
        weights[start] = checked(1 - t);
        weights[end] = t;
        const projected = point(
          ...["x", "y", "z"].map((axis) =>
            sum(
              vertices[start][axis],
              product(t, checked(vertices[end][axis] - vertices[start][axis])),
            ),
          ),
        );
        return { weights, distance: checked(Math.hypot(...sub(query, projected))) };
      });
      candidates.sort((left, right) => left.distance - right.distance);
      barycentric = candidates[0].weights;
    } else {
      // Gram-region classification squares the aspect ratio. Below this
      // conservative roundoff margin, this bounded oracle cannot certify it.
      const longestEdge = checked(
        Math.max(Math.hypot(...ab), Math.hypot(...ac), Math.hypot(...sub(c, b))),
      );
      const quality = quotient(quotient(area, longestEdge), longestEdge);
      if (quality <= Math.sqrt(64 * Number.EPSILON)) throw new NumericalOracleRangeError();
      barycentric = closestTriangle(query, a, b, c);
    }
    const hit = point(
      ...["x", "y", "z"].map((axis) =>
        sum(...vertices.map((vertex, corner) => product(vertex[axis], barycentric[corner]))),
      ),
    );
    const distance = checked(Math.hypot(...sub(query, hit)));
    const face = sourceFaceIds?.[offset / 3] ?? offset / 3;
    if (!best || distance < best.distance || (distance === best.distance && face < best.face)) {
      best = Object.freeze({
        face,
        point: hit,
        distance,
        barycentric: Object.freeze(barycentric),
        geometricNormal:
          area === 0 ? undefined : point(...cross.map((value) => quotient(value, area))),
      });
    }
  }
  return best;
}
