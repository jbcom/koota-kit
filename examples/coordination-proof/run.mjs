import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createProofCohort, PROOF_FRAME } from "./cohort.mjs";
import { loadFigureFixture } from "./fixture.mjs";
import { IDENTITY } from "./open-surface.mjs";
import { observeCommittedUpdate } from "./react-observer.mjs";

const [fixtureDirectory, consumerDirectory, output] = process.argv.slice(2);
if (!fixtureDirectory || !consumerDirectory)
  throw new Error(
    "Usage: node examples/coordination-proof/run.mjs <fixture-dir> <registry-consumer-dir> [receipt.json]",
  );
const { registryImport: importInstalled, registryResolve } = await import(
  pathToFileURL(join(consumerDirectory, "registry-import.mjs")).href
);
const importedFiles = new Map();
async function registryImport(specifier) {
  const path = relative(consumerDirectory, fileURLToPath(registryResolve(specifier)));
  assert.ok(
    path.split(sep)[0] === "node_modules",
    "registry import escaped the independent consumer",
  );
  const module = await importInstalled(specifier);
  importedFiles.set(specifier, path);
  return module;
}
const { createWorld, trait } = await registryImport("koota");
const { bindCoordination } = await registryImport("koota-kit/coordination");
const { queryPointClearance } = await registryImport("koota-kit/spatial");
const { AIBridge } = await registryImport("yuka-kit/koota");
const { Vehicle } = await registryImport("yuka");
const { createSeededTerrainField } = await registryImport("strata-procedural/terrain");
const React = await registryImport("react");
const { renderToStaticMarkup } = await registryImport("react-dom/server");
const { WorldProvider, useWorld } = await registryImport("koota/react");

const Position = trait({ x: 0, y: 0, z: 0 });
const Velocity = trait({ x: 0, y: 0, z: 0 });
const Intent = trait({ clearance: "unqueried", geometry: 0, topology: 0, pose: 0, transform: 0 });
const ModelKind = trait({ value: "" });
const world = createWorld();
const proceduralEntity = world.spawn(
  Position,
  Velocity,
  Intent,
  ModelKind({ value: "procedural" }),
);
const figureEntity = world.spawn(Position, Velocity, Intent, ModelKind({ value: "figure" }));
const unrelated = world.spawn(Position({ x: 123, y: 456, z: 789 }));
const coordination = bindCoordination(world);
assert.equal(coordination.world, world);
const figure = await loadFigureFixture(fixtureDirectory);
const field = createSeededTerrainField({
  seed: "two-model-proof",
  biomes: [{ type: "marsh", center: [0, 0], radius: 10 }],
});
const terrain = field.createHeightfield({ width: 5, depth: 5, cellSize: 0.5 });
// An application anchor on real published Strata geometry, not a claimed Strata anchor API.
const anchorVertex = 12 * 3;
const anchor = Object.freeze({
  id: "caller-terrain-center",
  x: terrain.positions[anchorVertex],
  y: terrain.positions[anchorVertex + 1],
  z: terrain.positions[anchorVertex + 2],
});
const specifications = [
  {
    id: "model-a",
    entity: proceduralEntity,
    sourceId: "strata-procedural@0.1.0",
    instanceId: "terrain-a",
    providerGeneration: 1,
  },
  {
    id: "model-b",
    entity: figureEntity,
    sourceId: "copied-humanoid-fixture",
    instanceId: "figure-b",
    providerGeneration: 1,
  },
];
const cohort = createProofCohort(coordination, specifications);
const diagnostics = [];
const measurements = {
  candidateSelectionMs: 0,
  queryMs: 0,
  exactOracleMs: 0,
  queryExcludingOracleMs: 0,
  oracleCalls: 0,
  publicationMs: 0,
};
const selectionStart = performance.now();
assert.equal(world.query(ModelKind).length, 2);
measurements.candidateSelectionMs = performance.now() - selectionStart;
function publish(updates) {
  const start = performance.now();
  try {
    return cohort.publish(updates);
  } finally {
    measurements.publicationMs += performance.now() - start;
  }
}
function clearance(query) {
  const capture = cohort.capture();
  const start = performance.now();
  let oracleMs = 0;
  const oracle = {
    nearest(request) {
      const start = performance.now();
      measurements.oracleCalls += 1;
      try {
        return capture.oracle.nearest(request);
      } finally {
        oracleMs += performance.now() - start;
      }
    },
  };
  try {
    return queryPointClearance(capture.provider, oracle, query);
  } finally {
    const total = performance.now() - start;
    measurements.queryMs += total;
    measurements.exactOracleMs += oracleMs;
    measurements.queryExcludingOracleMs += total - oracleMs;
    diagnostics.push(...capture.getDiagnostics());
    capture.release();
  }
}
const partsForPose = (pose) =>
  figure.parts.map((part) => ({
    id: part.id,
    positions: part.poses[pose].positions,
    full: part.full,
    visible: part.visible,
    fullTopologyId: `${part.geometryHash}/full`,
    visibleTopologyId: `${part.geometryHash}/visible`,
  }));
let figureUpdate = {
  id: "model-b",
  revisions: { geometry: 0, topology: 0, pose: 0, transform: 0 },
  toWorld: [...IDENTITY],
  parts: partsForPose("relaxed"),
};
const terrainUpdate = {
  id: "model-a",
  revisions: { geometry: 0, topology: 0, pose: 0, transform: 0 },
  toWorld: [...IDENTITY],
  parts: [
    {
      id: "heightfield",
      positions: terrain.positions,
      full: terrain.indices,
      visible: terrain.indices,
      fullTopologyId: "seeded-heightfield/full",
      visibleTopologyId: "seeded-heightfield/visible",
    },
  ],
};
const start = performance.now();
publish([terrainUpdate, figureUpdate]);
assert.equal(coordination.getEntity("model-a"), proceduralEntity);
assert.equal(coordination.getEntity("model-b"), figureEntity);
const base = cohort.getSnapshot();
const terrainStamp = base.records.find((record) => record.identity.instanceId === "terrain-a");
const query = {
  point: { x: 0, y: 1, z: 0 },
  frame: PROOF_FRAME,
  minimumDistance: 3,
  searchDistance: 10,
};
const oldLease = cohort.capture();
const first = clearance(query);
assert.equal(first.status, "violated");
assert.ok(first.witnesses.length > 0);
const trace = [];
const bridge = new AIBridge({ Position, Velocity });
const vehicle = new Vehicle();
figureEntity.set(Position, { x: 0, y: 1, z: 0 });
trace.push("caller-position");
bridge.syncFromKoota(vehicle, figureEntity);
trace.push("bridge-sync-from");
assert.equal(vehicle.position.y, 1);
const figureStamp = first.checked.find((stamp) => stamp.identity.instanceId === "figure-b");
figureEntity.set(Intent, { clearance: first.status, ...figureStamp.revisions });
trace.push("caller-stamped-intent");
// The caller behavior reads the same stamped surface predicate; this is not navigation.
const intent = figureEntity.get(Intent);
assert.deepEqual(
  {
    geometry: intent.geometry,
    topology: intent.topology,
    pose: intent.pose,
    transform: intent.transform,
  },
  figureStamp.revisions,
);
vehicle.velocity.set(intent.clearance === "violated" ? -1 : 1, 0, 0);
trace.push("caller-ai-behavior");
bridge.syncToKoota(vehicle, figureEntity);
trace.push("bridge-sync-to");
assert.equal(figureEntity.get(Velocity).x, -1);
assert.equal(figureEntity.get(Position).y, 1);

const steps = [];
for (const epoch of ["pose", "transform", "topology", "geometry"]) {
  const revisions = { ...figureUpdate.revisions, [epoch]: figureUpdate.revisions[epoch] + 1 };
  // Topology affects geometry identity and is invalidated explicitly in both contracts.
  if (epoch === "topology") revisions.geometry += 1;
  figureUpdate = { ...figureUpdate, revisions };
  if (epoch === "pose") figureUpdate.parts = partsForPose("overhead");
  if (epoch === "transform") {
    figureUpdate.toWorld = [...IDENTITY];
    figureUpdate.toWorld[0] = 1.7;
    figureUpdate.toWorld[5] = 0.8;
    figureUpdate.toWorld[12] = 0.25;
  }
  if (epoch === "topology")
    figureUpdate.parts = figureUpdate.parts.map((part) => ({
      ...part,
      visible: part.visible.subarray(0, part.visible.length - 3),
      visibleTopologyId: `${part.visibleTopologyId}/mask-1`,
    }));
  publish([figureUpdate]);
  const currentTerrain = cohort
    .getSnapshot()
    .records.find((record) => record.identity.instanceId === "terrain-a");
  assert.equal(currentTerrain, terrainStamp);
  const stale = clearance({
    ...query,
    expected: first.checked,
  });
  assert.equal(stale.status, "stale");
  const fresh = clearance(query);
  assert.equal(fresh.status, "violated");
  steps.push({ epoch, revisions, stale: stale.status, fresh: fresh.status });
}
assert.deepEqual(queryPointClearance(oldLease.provider, oldLease.oracle, query), first);
oldLease.release();
const beforeFailed = cohort.getSnapshot();
assert.throws(() =>
  cohort.publish([{ ...figureUpdate, revisions: { ...figureUpdate.revisions, pose: -1 } }]),
);
assert.equal(cohort.getSnapshot(), beforeFailed);
assert.equal(coordination.getSnapshot(), beforeFailed.coordination);
const disabled = {
  ...figureUpdate,
  revisions: { ...figureUpdate.revisions, geometry: figureUpdate.revisions.geometry + 1 },
  parts: figureUpdate.parts.map((part) => ({ ...part, nearestSurface: false })),
};
publish([disabled]);
const exclusions = cohort
  .getSnapshot()
  .records.filter((record) => record.identity.instanceId === "terrain-a")
  .map((record) => record.identity);
assert.equal(clearance({ ...query, exclusions }).status, "unsupported");
figureUpdate = {
  ...figureUpdate,
  revisions: { ...disabled.revisions, geometry: disabled.revisions.geometry + 1 },
};
publish([figureUpdate]);
const selectedRecords = cohort.getSnapshot().records;
const bodyRecord = selectedRecords.find(
  (record) => record.identity.instanceId === "figure-b" && record.identity.partId === "body",
);
assert.ok(bodyRecord, "expected a body record for figure-b");
const bodyIdentity = bodyRecord.identity;
const partExclusion = clearance({ ...query, exclusions: [...exclusions, bodyIdentity] });
assert.equal(partExclusion.status, "violated");
assert.equal(partExclusion.checked.length, 1);
assert.equal(partExclusion.checked[0].identity.partId, figure.parts[1].id);
assert.ok(
  partExclusion.witnesses.every(
    (witness) => witness.consumed.identity.partId === figure.parts[1].id,
  ),
);

let observedWorld;
function Inspector() {
  observedWorld = useWorld();
  const snapshot = React.useSyncExternalStore(
    cohort.subscribe,
    cohort.getSnapshot,
    cohort.getSnapshot,
  );
  return React.createElement(
    "output",
    null,
    snapshot.coordination.entries.map((entry) => entry.id).join(","),
  );
}
const markup = renderToStaticMarkup(
  React.createElement(WorldProvider, { world }, React.createElement(Inspector)),
);
assert.equal(observedWorld, world);
assert.equal(markup, "<output>model-a,model-b</output>");
figureUpdate = {
  ...figureUpdate,
  revisions: { ...figureUpdate.revisions, pose: figureUpdate.revisions.pose + 1 },
};
const mountedReact = await observeCommittedUpdate({
  registryImport,
  cohort,
  world,
  publish: () => publish([figureUpdate]),
});
assert.ok(diagnostics.every((witness) => witness.barycentric.length === 3));
const elapsedMs = performance.now() - start;
const retainedStamp = first.checked;
const disposalLease = cohort.capture();
cohort.dispose();
assert.throws(() => cohort.capture(), /disposed/);
assert.equal(
  queryPointClearance(disposalLease.provider, disposalLease.oracle, {
    ...query,
    expected: retainedStamp,
  }).status,
  "stale",
);
disposalLease.release();
assert.ok(world.has(proceduralEntity) && world.has(figureEntity) && world.has(unrelated));
assert.equal(unrelated.get(Position).x, 123);
assert.ok(
  figureEntity.has(Position) &&
    figureEntity.has(Velocity) &&
    figureEntity.has(Intent) &&
    figureEntity.has(ModelKind),
);
coordination.dispose();
assert.ok(world.isInitialized);
const packages = JSON.parse(await readFile(join(consumerDirectory, "package.json"), "utf8"));
const lockBytes = await readFile(join(consumerDirectory, "package-lock.json"));
const lock = JSON.parse(lockBytes.toString("utf8"));
const installed = {};
for (const [name, version] of Object.entries(packages.dependencies)) {
  const metadata = JSON.parse(
    await readFile(join(consumerDirectory, "node_modules", name, "package.json"), "utf8"),
  );
  const entry = lock.packages[`node_modules/${name}`];
  assert.equal(metadata.version, version);
  assert.equal(entry.version, version);
  assert.ok(entry.resolved.startsWith("https://registry.npmjs.org/"));
  installed[name] = { version, integrity: entry.integrity, resolved: entry.resolved };
}
const report = {
  scope:
    "registry caller-composition proof; copied HK fixture only; open-surface clearance; mounted and server React observation, no GPU parity",
  packages: packages.dependencies,
  installed,
  consumerLockSha256: createHash("sha256").update(lockBytes).digest("hex"),
  imports: Object.fromEntries([...importedFiles.entries()].sort()),
  node: process.version,
  inputs: figure.inputs,
  anchor,
  trace,
  steps,
  first,
  partExclusion,
  witnessDiagnostics: diagnostics.slice(0, 3),
  elapsedMs,
  measurements,
  mountedReact,
  lifecyclePreserved: true,
  sameRawWorldObserved: true,
};
if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
  JSON.stringify(
    {
      scope: report.scope,
      packages: report.packages,
      trace,
      steps,
      elapsedMs,
      measurements,
      mountedReact,
      lifecyclePreserved: true,
      sameRawWorldObserved: true,
    },
    null,
    2,
  ),
);
world.destroy();
