import { performance } from "node:perf_hooks";
import { queryWalkerPath } from "../../dist/esm/walker.js";
const world = {
  supports: [
    { id: "ground", minX: 0, maxX: 48, minZ: 0, maxZ: 32, y: 0, slopeX: 0, slopeZ: 0 },
    ...Array.from({ length: 24 }, (_, i) => ({
      id: `support-${i}`,
      minX: 34 + i / 100,
      maxX: 35 + i / 100,
      minZ: 14,
      maxZ: 18,
      y: 0.72,
      slopeX: 0,
      slopeZ: 0,
    })),
  ],
  solids: [
    { id: "trunk", min: { x: 9.76, y: 0, z: 5.96 }, max: { x: 10.24, y: 4, z: 6.44 } },
    ...Array.from({ length: 24 }, (_, i) => ({
      id: `solid-${i}`,
      min: { x: 34 + i / 100, y: 0, z: 14 },
      max: { x: 35 + i / 100, y: 1, z: 18 },
    })),
  ],
};
const points = [
  { x: 8, y: 0, z: 6.2 },
  { x: 9.4, y: 0, z: 5.4 },
  { x: 10.6, y: 0, z: 5.4 },
  { x: 12, y: 0, z: 6.2 },
];
const state = (position) => ({
  position,
  halfWidth: 0.18,
  height: 0.45,
  maxStep: 0.25,
  supportId: "ground",
});
function decision() {
  let clear = 0,
    blocked = 0;
  for (let i = 0; i < 7; i++) {
    if (queryWalkerPath(state(points[0]), points[3], world).walkable) clear++;
    else blocked++;
    for (let j = 1; j < points.length; j++)
      if (queryWalkerPath(state(points[j - 1]), points[j], world).walkable) clear++;
      else blocked++;
  }
  if (clear !== 21 || blocked !== 7) throw new Error("Unexpected physical result");
  return { clear, blocked };
}
for (let i = 0; i < 30; i++) decision();
const samples = [],
  cpu = process.cpuUsage();
let result;
for (let i = 0; i < 400; i++) {
  const start = performance.now();
  result = decision();
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    decisions: 400,
    pathQueriesPerDecision: 28,
    p50Ms: samples[200],
    p95Ms: samples[380],
    totalMs: samples.reduce((a, b) => a + b, 0),
    cpu: process.cpuUsage(cpu),
    result,
  }),
);
