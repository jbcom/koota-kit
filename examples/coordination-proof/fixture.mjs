import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const types = {
  Float32Array: [Float32Array, 4, "getFloat32"],
  Uint32Array: [Uint32Array, 4, "getUint32"],
  Uint16Array: [Uint16Array, 2, "getUint16"],
  Uint8Array: [Uint8Array, 1, "getUint8"],
};

/** Decode independently of host endianness and retain no aliases into file bytes. */
export function decodeArray(bytes, descriptor) {
  const type = types[descriptor.type];
  if (!type || !Number.isSafeInteger(descriptor.length) || descriptor.length < 0) {
    throw new TypeError("fixture: invalid array descriptor");
  }
  const [Constructor, width, getter] = type;
  if (
    bytes.byteLength !== descriptor.byteLength ||
    bytes.byteLength !== descriptor.length * width
  ) {
    throw new Error("fixture: array byte length mismatch");
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== descriptor.sha256) throw new Error("fixture: SHA256 mismatch");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const array = new Constructor(descriptor.length);
  for (let index = 0; index < array.length; index += 1) {
    array[index] = view[getter](index * width, true);
    if (!Number.isFinite(array[index])) throw new Error("fixture: nonfinite array value");
  }
  return array;
}

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

/** Fixture transport only: this does not evaluate poses or claim a live HK adapter. */
export async function loadFigureFixture(directory) {
  const manifestBytes = await readFile(join(directory, "fixture.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest.format !== 1 ||
    manifest.unit !== "metre" ||
    manifest.byteOrder !== "little-endian"
  ) {
    throw new Error("fixture: unsupported format, unit or byte order");
  }
  const inputs = [
    { file: "fixture.json", sha256: createHash("sha256").update(manifestBytes).digest("hex") },
  ];
  async function load(descriptor) {
    if (basename(descriptor.file) !== descriptor.file) throw new Error("fixture: unsafe file name");
    const array = decodeArray(await readFile(join(directory, descriptor.file)), descriptor);
    inputs.push({ file: descriptor.file, sha256: descriptor.sha256 });
    return array;
  }
  const parts = [];
  for (const part of manifest.parts) {
    const rest = await load(part.arrays.rest);
    const restNormals = await load(part.arrays.restNormals);
    const full = await load(part.arrays.fullIndex);
    const visible = await load(part.arrays.index);
    assertMesh(rest, full, part.vertexCount);
    assertMesh(rest, visible, part.vertexCount);
    if (full.length / 3 !== part.fullTriangleCount || visible.length / 3 !== part.triangleCount) {
      throw new Error("fixture: declared topology count mismatch");
    }
    if (restNormals.length !== rest.length) throw new Error("fixture: malformed normals");
    const visibleFaceIds = sourceFaceIds(full, visible);
    const poses = {};
    for (const pose of manifest.poses) {
      if (pose.grounding !== "already applied once to every part; do not apply again") {
        throw new Error("fixture: unknown grounding contract");
      }
      const source = pose.parts.find((candidate) => candidate.id === part.id);
      if (!source) throw new Error("fixture: pose part missing");
      const positions = await load(source.positions);
      const normals = await load(source.normals);
      assertMesh(positions, full, part.vertexCount);
      if (normals.length !== positions.length) throw new Error("fixture: malformed posed normals");
      poses[pose.name] = { positions, normals };
    }
    parts.push({
      id: part.id,
      geometryHash: part.geometryHash,
      rest,
      restNormals,
      full,
      visible,
      visibleFaceIds,
      poses,
    });
  }
  return { manifest, parts, inputs };
}
