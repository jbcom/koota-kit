import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const fixtureModule = "../examples/coordination-proof/fixture.mjs";
const surfaceModule = "../examples/coordination-proof/open-surface.mjs";
const { decodeArray, assertMesh, sourceFaceIds } = await import(fixtureModule);
const { worldPositions, nearestOpenSurface, indexedBounds, IDENTITY } = await import(surfaceModule);

describe("caller-side copied-buffer proof", () => {
  it("decodes little-endian verified bytes without aliasing and fails closed on corruption", () => {
    const bytes = Buffer.alloc(8);
    bytes.writeFloatLE(1.25, 0);
    bytes.writeFloatLE(-2.5, 4);
    const descriptor = {
      type: "Float32Array",
      length: 2,
      byteLength: 8,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const array = decodeArray(bytes, descriptor);
    expect([...array]).toEqual([1.25, -2.5]);
    bytes.writeFloatLE(5, 0);
    expect(array[0]).toBe(1.25);
    expect(() => decodeArray(bytes, descriptor)).toThrow("SHA256");
    expect(() => decodeArray(bytes.subarray(0, 4), descriptor)).toThrow("byte length");
  });

  it("keeps visible witnesses tied to full source face IDs", () => {
    const full = new Uint32Array([0, 1, 2, 2, 1, 3]);
    expect([...sourceFaceIds(full, new Uint32Array([2, 1, 3]))]).toEqual([1]);
    expect(() => sourceFaceIds(full, new Uint32Array([0, 2, 1]))).toThrow("absent");
    expect(() => assertMesh(new Float32Array(12), new Uint32Array([0, 1, 4]), 4)).toThrow(
      "out of range",
    );
  });

  it("ranks all transformed triangles in the actual nonuniform world metric", () => {
    const positions = new Float32Array([
      1, -1, -1, 1, 1, -1, 1, 0, 1, -1, 2, -1, 1, 2, -1, 0, 2, 1,
    ]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const origin = { x: 0, y: 0, z: 0 };
    expect(nearestOpenSurface(positions, indices, origin).face).toBe(0);
    const matrix = [...IDENTITY];
    matrix[0] = 10;
    const world = worldPositions(positions, matrix);
    const witness = nearestOpenSurface(world, indices, origin);
    expect(witness.face).toBe(1);
    expect(witness.distance).toBe(2);
    expect(witness.barycentric.reduce((sum: number, value: number) => sum + value, 0)).toBeCloseTo(
      1,
    );
    expect(witness.geometricNormal).toEqual({ x: 0, y: -1, z: 0 });
    expect(indexedBounds(world, indices)).toEqual({
      min: { x: -10, y: -1, z: -1 },
      max: { x: 10, y: 2, z: 1 },
    });
    expect(() => worldPositions(positions, [...IDENTITY.slice(0, 15), 0])).toThrow("affine");
  });
});
