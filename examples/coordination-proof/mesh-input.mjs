export function assertMesh(positions, indices, vertexCount) {
  if (positions.length !== vertexCount * 3 || indices.length % 3 !== 0) {
    throw new Error("fixture: malformed mesh layout");
  }
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error("fixture: index out of range");
    }
  }
}

/** Preserve authored full-source face ordinals even for render-visible selection. */
export function sourceFaceIds(full, visible) {
  const faces = new Map();
  for (let offset = 0; offset < full.length; offset += 3) {
    const key = `${full[offset]},${full[offset + 1]},${full[offset + 2]}`;
    if (faces.has(key)) throw new Error("fixture: duplicate full source face");
    faces.set(key, offset / 3);
  }
  const selected = new Uint32Array(visible.length / 3);
  for (let offset = 0; offset < visible.length; offset += 3) {
    const id = faces.get(`${visible[offset]},${visible[offset + 1]},${visible[offset + 2]}`);
    if (id === undefined) throw new Error("fixture: visible face absent from full source");
    selected[offset / 3] = id;
  }
  return selected;
}
