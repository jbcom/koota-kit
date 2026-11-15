import { performance } from "node:perf_hooks";
import { queryWalkerPath } from "../../dist/esm/walker.js";
const state = {
  position: { x: 0, y: 0, z: 0 },
  halfWidth: 0.3,
  height: 2.1,
  maxStep: 0.25,
  supportId: "ground",
};
const target = { x: 24, y: 0, z: 0 };
const world = {
  supports: Array.from({ length: 24 }, (_, i) => ({
    id: `floor-${i}`,
    minX: i,
    maxX: i + 1,
    minZ: -2,
    maxZ: 2,
    y: 0,
    slopeX: 0,
    slopeZ: 0,
  })),
  solids: Array.from({ length: 24 }, (_, i) => ({
    id: `solid-${i}`,
    min: { x: i + 0.1, y: 0, z: 4 },
    max: { x: i + 0.2, y: 2, z: 5 },
  })),
};
let result;
for (let i = 0; i < 30; i++) result = queryWalkerPath(state, target, world);
const samples = [];
const cpuBefore = process.cpuUsage();
const heapBefore = process.memoryUsage().heapUsed;
for (let i = 0; i < 400; i++) {
  const before = performance.now();
  result = queryWalkerPath(state, target, world);
  samples.push(performance.now() - before);
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    count: samples.length,
    p50Ms: samples[200],
    p95Ms: samples[380],
    totalMs: samples.reduce((a, b) => a + b, 0),
    cpu: process.cpuUsage(cpuBefore),
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    result,
  }),
);
if (!result.walkable || result.state.position.x !== 24) throw new Error("Incorrect benchmark path");
