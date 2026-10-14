import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadFigureFixture } from "./fixture.mjs";
import { IDENTITY, indexedBounds, nearestOpenSurface, worldPositions } from "./open-surface.mjs";

const directory = process.argv[2];
if (!directory)
  throw new Error(
    "Usage: node examples/coordination-proof/prepare.mjs <fixture-directory> [receipt.json]",
  );
const figure = await loadFigureFixture(directory);
const report = {
  scope: "copied-buffer/open-surface preparation; no live producer or rendered parity claim",
  inputs: figure.inputs,
  parts: [],
};
for (const part of figure.parts) {
  assert.equal(part.poses.relaxed.positions.length, part.rest.length);
  assert.notDeepEqual(part.poses.relaxed.positions, part.poses.overhead.positions);
  const before = part.poses.relaxed.positions[0];
  const copied = new Float32Array(part.poses.relaxed.positions);
  copied[0] += 1;
  assert.equal(part.poses.relaxed.positions[0], before);
  const positions = worldPositions(part.poses.relaxed.positions, IDENTITY);
  const bounds = indexedBounds(positions, part.full);
  const face = 0;
  const corners = [0, 1, 2].map((corner) => part.full[face * 3 + corner] * 3);
  const centroid = Object.fromEntries(
    ["x", "y", "z"].map((axis, index) => [
      axis,
      corners.reduce((sum, offset) => sum + positions[offset + index], 0) / 3,
    ]),
  );
  const witness = nearestOpenSurface(positions, part.full, centroid);
  assert.ok(witness.distance < 1e-12);
  assert.ok(Math.abs(witness.barycentric.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  let hiddenWitness;
  if (part.full.length !== part.visible.length) {
    const visibleIds = new Set(part.visibleFaceIds);
    const hiddenFace = Array.from({ length: part.full.length / 3 }, (_, face) => face).find(
      (face) => !visibleIds.has(face),
    );
    const offsets = [0, 1, 2].map((corner) => part.full[hiddenFace * 3 + corner] * 3);
    const point = Object.fromEntries(
      ["x", "y", "z"].map((axis, index) => [
        axis,
        offsets.reduce((sum, offset) => sum + positions[offset + index], 0) / 3,
      ]),
    );
    const full = nearestOpenSurface(positions, part.full, point);
    const visible = nearestOpenSurface(positions, part.visible, point, part.visibleFaceIds);
    assert.ok(full.distance < 1e-12);
    assert.ok(visible.distance > 1e-12);
    hiddenWitness = { hiddenFace, point, full, visible };
  }
  report.parts.push({
    id: part.id,
    fullTriangles: part.full.length / 3,
    visibleTriangles: part.visible.length / 3,
    hiddenTriangles: (part.full.length - part.visible.length) / 3,
    bounds,
    witness,
    hiddenWitness,
    grounding: "posed input bytes used unchanged; no additional lift",
  });
}
assert.equal(report.parts[0].fullTriangles, 107024);
assert.equal(report.parts[0].visibleTriangles, 80112);
assert.equal(report.parts[1].fullTriangles, 66688);
assert.equal(report.parts[1].visibleTriangles, 66688);
if (process.argv[3]) {
  await mkdir(dirname(process.argv[3]), { recursive: true });
  await writeFile(process.argv[3], `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
  JSON.stringify(
    { scope: report.scope, inputCount: report.inputs.length, parts: report.parts },
    null,
    2,
  ),
);
