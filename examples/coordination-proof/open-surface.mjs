const point = (x, y, z) => Object.freeze({ x, y, z });
const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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
    output[i] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    output[i + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    output[i + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
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
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return [0, 1 - w, w];
  }
  const inverse = 1 / (va + vb + vc),
    v = vb * inverse,
    w = vc * inverse;
  return [1 - v - w, v, w];
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
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const area = Math.hypot(...cross);
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
            : Math.max(0, Math.min(1, dot(sub(query, vertices[start]), edge) / length));
        const weights = [0, 0, 0];
        weights[start] = 1 - t;
        weights[end] = t;
        const projected = point(
          ...["x", "y", "z"].map(
            (axis) => vertices[start][axis] + t * (vertices[end][axis] - vertices[start][axis]),
          ),
        );
        return { weights, distance: Math.hypot(...sub(query, projected)) };
      });
      candidates.sort((left, right) => left.distance - right.distance);
      barycentric = candidates[0].weights;
    } else {
      barycentric = closestTriangle(query, a, b, c);
    }
    const hit = point(
      ...["x", "y", "z"].map((axis) =>
        vertices.reduce((sum, vertex, corner) => sum + vertex[axis] * barycentric[corner], 0),
      ),
    );
    const distance = Math.hypot(...sub(query, hit));
    const face = sourceFaceIds?.[offset / 3] ?? offset / 3;
    if (!best || distance < best.distance || (distance === best.distance && face < best.face)) {
      best = Object.freeze({
        face,
        point: hit,
        distance,
        barycentric: Object.freeze(barycentric),
        geometricNormal: area === 0 ? undefined : point(...cross.map((value) => value / area)),
      });
    }
  }
  return best;
}
