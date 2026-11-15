// Diagnostic only: no timing gate and no dependency on built output.
import { performance } from "node:perf_hooks";
import { deterministicAcos, deterministicCubeRoot, deterministicSinCos } from "../src/numeric.ts";

console.log(
  JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch }),
);
for (const [name, iterations, operation] of [
  ["sinCos", 10000, (index) => deterministicSinCos((index % 601) / 100 - 3).sin],
  ["acos", 1000, (index) => deterministicAcos((index % 999) / 1000)],
  ["cubeRoot", 10000, (index) => deterministicCubeRoot(index % 15001)],
]) {
  let checksum = 0;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) checksum += operation(index);
  const milliseconds = performance.now() - start;
  console.log(
    JSON.stringify({
      name,
      iterations,
      milliseconds,
      microsecondsPerCall: (milliseconds * 1000) / iterations,
      checksum,
    }),
  );
}
console.log(
  JSON.stringify({
    sinCos: deterministicSinCos(-Math.PI / 2),
    acos: deterministicAcos(0.5),
    cubeRoots: [deterministicCubeRoot(15000), deterministicCubeRoot(4294967295)],
  }),
);
