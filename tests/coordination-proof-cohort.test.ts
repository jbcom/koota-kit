import { createWorld, trait } from "koota";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindCoordination, CoordinationRegistration } from "../src/coordination";
import { queryPointClearance } from "../src/spatial";

vi.mock("../examples/coordination-proof/fixture.mjs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sourceFaceIds: vi.fn(
      actual.sourceFaceIds as (full: Uint32Array, visible: Uint32Array) => Uint32Array,
    ),
  };
});

const cohortModule = "../examples/coordination-proof/cohort.mjs";
const { createProofCohort, PROOF_FRAME } = await import(cohortModule);
const fixtureModule = "../examples/coordination-proof/fixture.mjs";
const { sourceFaceIds: mappedFaces } = await import(fixtureModule);
const worlds: ReturnType<typeof createWorld>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  mappedFaces.mockClear();
  for (const world of worlds.splice(0)) world.destroy();
});
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const update = (id: string, geometry = 0, x = 0) => ({
  id,
  revisions: { geometry, topology: 0, pose: 0, transform: 0 },
  toWorld: identity,
  parts: [
    {
      id: "surface",
      positions: new Float32Array([x, 0, 0, x + 1, 0, 0, x, 1, 0]),
      full: new Uint32Array([0, 1, 2]),
      visible: new Uint32Array([0, 1, 2]),
      fullTopologyId: "full",
      visibleTopologyId: "visible",
    },
  ],
});
function firstPart(value: ReturnType<typeof update>) {
  const part = value.parts[0];
  if (!part) throw new Error("test setup has no first part");
  return part;
}
function setup() {
  const world = createWorld();
  worlds.push(world);
  const Custom = trait({ keep: 42 });
  const a = world.spawn(Custom),
    b = world.spawn(Custom);
  const coordination = bindCoordination(world);
  const cohort = createProofCohort(coordination, [
    { id: "a", entity: a, sourceId: "source-a", instanceId: "instance-a", providerGeneration: 1 },
    { id: "b", entity: b, sourceId: "source-b", instanceId: "instance-b", providerGeneration: 1 },
  ]);
  cohort.publish([update("a"), update("b", 0, 10)]);
  return { world, a, b, coordination, cohort, Custom };
}
type ProofRecord = {
  identity: { registration: { id: string } };
  revisions: { geometry: number };
  topology: { full: { bounds: { min: { x: number } } } };
};
function selected(cohort: {
  capture: () => { provider: { snapshot: () => ProofRecord[] }; release: () => void };
}) {
  const capture = cohort.capture();
  try {
    return capture.provider
      .snapshot()
      .map((record) => [
        record.identity.registration.id,
        record.revisions.geometry,
        record.topology.full.bounds.min.x,
      ]);
  } finally {
    capture.release();
  }
}

describe("caller geometry versions selected by the committed binding", () => {
  it("rejects pending model absence until every owned model completes, including explicit empty models", () => {
    const world = createWorld();
    worlds.push(world);
    const a = world.spawn(),
      b = world.spawn();
    const coordination = bindCoordination(world);
    const cohort = createProofCohort(coordination, [
      { id: "a", entity: a, sourceId: "a", instanceId: "a", providerGeneration: 1 },
      { id: "b", entity: b, sourceId: "b", instanceId: "b", providerGeneration: 1 },
    ]);
    const query = {
      point: { x: 0, y: 0, z: 0 },
      frame: PROOF_FRAME,
      minimumDistance: 1,
      searchDistance: 2,
    };
    const status = () => {
      const capture = cohort.capture();
      try {
        return queryPointClearance(capture.provider, capture.oracle, query).status;
      } finally {
        capture.release();
      }
    };
    const initial = cohort.getSnapshot();
    expect(initial.valid).toBe(false);
    expect(cohort.getSnapshot()).toBe(initial);
    expect(status()).toBe("unsupported");
    cohort.publish([update("a")]);
    const partial = cohort.getSnapshot();
    expect(partial.valid).toBe(false);
    expect(cohort.getSnapshot()).toBe(partial);
    expect(status()).toBe("unsupported");
    cohort.publish([update("b", 0, 10)]);
    const complete = cohort.getSnapshot();
    expect(complete.valid).toBe(true);
    expect(complete.records).toHaveLength(2);
    expect(status()).toBe("violated");
    const old = cohort.capture();
    try {
      cohort.publish([{ ...update("b", 1), parts: [] }]);
      expect(cohort.getSnapshot().valid).toBe(true);
      expect(cohort.getSnapshot().records).toHaveLength(1);
      expect(status()).toBe("violated");
      expect(old.provider.snapshot()).toHaveLength(2);
      cohort.publish([{ ...update("a", 1), parts: [] }]);
      expect(cohort.getSnapshot().valid).toBe(true);
      expect(status()).toBe("satisfied");
    } finally {
      old.release();
      cohort.dispose();
    }
  });
  it("keeps invalid views stable for React after a cached valid view loses its entity", () => {
    const { a, cohort } = setup();
    const valid = cohort.getSnapshot();
    a.destroy();
    const invalid = cohort.getSnapshot();
    expect(invalid.valid).toBe(false);
    expect(invalid).not.toBe(valid);
    expect(cohort.getSnapshot()).toBe(invalid);
    const capture = cohort.capture();
    try {
      expect(capture.snapshot).toBe(invalid);
      expect(
        queryPointClearance(capture.provider, capture.oracle, {
          point: { x: 0, y: 0, z: 0 },
          frame: PROOF_FRAME,
          minimumDistance: 1,
          searchDistance: 2,
        }).status,
      ).toBe("unsupported");
    } finally {
      capture.release();
    }
  });
  it("returns stamped unknown for unsupported numerical range without claiming a witness", () => {
    const { cohort } = setup();
    const replacement = update("a", 1);
    replacement.toWorld = [...identity];
    replacement.toWorld[0] = replacement.toWorld[5] = replacement.toWorld[10] = 1e100;
    cohort.publish([replacement]);
    const capture = cohort.capture();
    try {
      const record = capture.provider
        .snapshot()
        .find((r: ProofRecord) => r.identity.registration.id === "a");
      const query = {
        point: { x: 2.5e99, y: 2.5e99, z: 1e100 },
        frame: PROOF_FRAME,
        minimumDistance: 1.01e100,
        searchDistance: 1e101,
      };
      const reply = capture.oracle.nearest({
        record,
        topology: "full",
        point: query.point,
        maximumDistance: query.searchDistance,
      });
      expect(reply.kind).toBe("unknown");
      expect(reply.reason).toBe("numerical-oracle-range");
      expect(reply.consumed.revisions).toEqual(replacement.revisions);
      const result = queryPointClearance({ snapshot: () => [record] }, capture.oracle, query);
      expect(result.status).toBe("unknown");
      expect(result.exactness).toBe("none");
      expect(result.witnesses).toEqual([]);
      expect(capture.getDiagnostics()).toEqual([]);
    } finally {
      capture.release();
    }
  });
  it("reuses only the committed same-part correspondence across verified identical topology", () => {
    const { coordination, cohort } = setup();
    expect(mappedFaces).toHaveBeenCalledTimes(2);
    const pose = update("a");
    pose.revisions.pose = 1;
    cohort.publish([pose]);
    const transform = {
      ...pose,
      revisions: { ...pose.revisions, transform: 1 },
      toWorld: [...identity],
    };
    transform.toWorld[12] = 1;
    cohort.publish([transform]);
    expect(mappedFaces).toHaveBeenCalledTimes(2);
    const snapshot = coordination.getSnapshot();
    expect(cohort.publish([transform]).coordination).toBe(snapshot);
    expect(mappedFaces).toHaveBeenCalledTimes(2);
  });

  it("reorders full source faces legally and retains old leased visible witness ordinals", () => {
    const { cohort } = setup();
    const part = {
      id: "surface",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0]),
      full: new Uint32Array([0, 1, 2, 3, 4, 5]),
      visible: new Uint32Array([3, 4, 5]),
      fullTopologyId: "full",
      visibleTopologyId: "visible",
    };
    cohort.publish([
      {
        ...update("a", 1),
        revisions: { geometry: 1, topology: 1, pose: 0, transform: 0 },
        parts: [part],
      },
    ]);
    const old = cohort.capture();
    const request = (capture: ReturnType<typeof cohort.capture>) => ({
      record: capture.provider
        .snapshot()
        .find((record: ProofRecord) => record.identity.registration.id === "a"),
      topology: "visible",
      point: { x: 10.25, y: 0.25, z: 1 },
      maximumDistance: 10,
    });
    expect(old.oracle.nearest(request(old)).witness.triangleId).toBe("surface/full-face/1");
    const calls = mappedFaces.mock.calls.length;
    cohort.publish([
      {
        ...update("a", 2),
        revisions: { geometry: 2, topology: 2, pose: 0, transform: 0 },
        parts: [{ ...part, full: new Uint32Array([3, 4, 5, 0, 1, 2]) }],
      },
    ]);
    expect(mappedFaces).toHaveBeenCalledTimes(calls + 1);
    const current = cohort.capture();
    expect(current.oracle.nearest(request(current)).witness.triangleId).toBe("surface/full-face/0");
    expect(old.oracle.nearest(request(old)).witness.triangleId).toBe("surface/full-face/1");
    current.release();
    old.release();
  });

  it("matches reused parts by identity and misses on topology IDs/epochs or visible bytes", () => {
    const { cohort } = setup();
    const base = update("a", 1);
    base.parts.push({
      ...firstPart(base),
      id: "other",
      fullTopologyId: "other-full",
      visibleTopologyId: "other-visible",
    });
    cohort.publish([base]);
    let calls = mappedFaces.mock.calls.length;
    const reordered = {
      ...base,
      revisions: { geometry: 2, topology: 1, pose: 1, transform: 0 },
      parts: [...base.parts].reverse(),
    };
    // Part-list replacement keeps the existing conservative invalidation contract.
    cohort.publish([reordered]);
    expect(mappedFaces).toHaveBeenCalledTimes(calls + 2);
    calls += 2;
    cohort.publish([{ ...reordered, revisions: { ...reordered.revisions, pose: 2 } }]);
    expect(mappedFaces).toHaveBeenCalledTimes(calls);
    const epoch = { ...reordered, revisions: { geometry: 3, topology: 2, pose: 2, transform: 0 } };
    cohort.publish([epoch]);
    expect(mappedFaces).toHaveBeenCalledTimes(calls + 2);
    calls += 2;
    const changed = {
      ...epoch,
      revisions: { ...epoch.revisions, geometry: 4 },
      parts: epoch.parts.map((part) => ({
        ...part,
        visibleTopologyId: `${part.visibleTopologyId}/new`,
      })),
    };
    cohort.publish([changed]);
    expect(mappedFaces).toHaveBeenCalledTimes(calls + 2);
  });

  it("still validates mutated caller arrays and rejects bad topology after warm reuse", () => {
    const { cohort } = setup();
    const before = cohort.getSnapshot();
    const position = update("a");
    firstPart(position).positions[0] = 0.5;
    expect(() => cohort.publish([position])).toThrow("same completed tuple");
    const absent = update("a", 1);
    firstPart(absent).visible.set([2, 1, 0]);
    expect(() => cohort.publish([absent])).toThrow("absent");
    const duplicate = update("a", 1);
    firstPart(duplicate).full = new Uint32Array([0, 1, 2, 0, 1, 2]);
    expect(() => cohort.publish([duplicate])).toThrow("duplicate full");
    const range = update("a", 1);
    firstPart(range).full[0] = 99;
    expect(() => cohort.publish([range])).toThrow("out of range");
    expect(cohort.getSnapshot()).toBe(before);
  });
  it("native callbacks read both OLD models and committed subscribers both NEW models", () => {
    const { world, coordination, cohort } = setup();
    const raw: unknown[] = [],
      committed: unknown[] = [];
    world.onChange(CoordinationRegistration, () => raw.push(selected(cohort)));
    coordination.subscribe(() => committed.push(selected(cohort)));
    cohort.publish([update("a", 1, 1), update("b", 1, 11)]);
    expect(raw).toEqual([
      [
        ["a", 0, 0],
        ["b", 0, 10],
      ],
      [
        ["a", 0, 0],
        ["b", 0, 10],
      ],
    ]);
    expect(committed).toEqual([
      [
        ["a", 1, 1],
        ["b", 1, 11],
      ],
    ]);
  });

  it("a second raw write failure keeps the old completed snapshot and geometry", () => {
    const { world, coordination, cohort } = setup();
    const before = coordination.getSnapshot();
    let writes = 0;
    const stop = world.onChange(CoordinationRegistration, () => {
      if (++writes === 2) throw new Error("second write fault");
    });
    expect(() => cohort.publish([update("a", 1, 1), update("b", 1, 11)])).toThrow(
      "second write fault",
    );
    expect(coordination.getSnapshot()).toBe(before);
    expect(selected(cohort)).toEqual([
      ["a", 0, 0],
      ["b", 0, 10],
    ]);
    stop();
    cohort.publish([update("a", 1, 1), update("b", 1, 11)]);
    expect(selected(cohort)).toEqual([
      ["a", 1, 1],
      ["b", 1, 11],
    ]);
  });

  it("listener exceptions are postcommit, keep new resources, and deliver later listeners", () => {
    const { coordination, cohort } = setup();
    const remove = coordination.subscribe(() => {
      throw new Error("listener fault");
    });
    const seen: unknown[] = [];
    coordination.subscribe(() => seen.push(selected(cohort)));
    expect(() => cohort.publish([update("a", 1, 1)])).toThrow("listener fault");
    expect(seen).toEqual([
      [
        ["a", 1, 1],
        ["b", 0, 10],
      ],
    ]);
    expect(selected(cohort)).toEqual([
      ["a", 1, 1],
      ["b", 0, 10],
    ]);
    remove();
  });

  it("rejects topology-only and same-tuple mutations while an identical repeat is a no-op", () => {
    const { coordination, cohort } = setup();
    const before = cohort.getSnapshot();
    const topology = update("a");
    topology.revisions.topology = 1;
    expect(() => cohort.publish([topology])).toThrow("advance geometry");
    expect(() => cohort.publish([update("a", 0, 1)])).toThrow("same completed tuple");
    const original = update("a");
    expect(() =>
      cohort.publish([
        { ...original, frame: { id: "another-frame", unit: "metre", metric: "euclidean" } },
      ]),
    ).toThrow("same completed tuple");
    expect(() =>
      cohort.publish([
        {
          ...original,
          parts: original.parts.map((part) => ({ ...part, provenance: { source: "changed" } })),
        },
      ]),
    ).toThrow("same completed tuple");
    expect(cohort.getSnapshot()).toBe(before);
    expect(cohort.publish([update("a")])).toBe(before);
    expect(coordination.getSnapshot()).toBe(before.coordination);
  });

  it("keeps leased old geometry after publication/disposal and resolves copied records by full stamp", () => {
    const { cohort } = setup();
    const old = cohort.capture();
    const record = structuredClone(old.provider.snapshot()[0]);
    const request = {
      record,
      topology: "full",
      point: { x: 0.25, y: 0.25, z: 1 },
      maximumDistance: 10,
    };
    const hit = old.oracle.nearest(request);
    expect(hit.witness.distance).toBe(1);
    cohort.publish([update("a", 1, 100)]);
    expect(old.oracle.nearest(request)).toEqual(hit);
    cohort.dispose();
    expect(old.oracle.nearest(request)).toEqual(hit);
    old.release();
    old.release();
    expect(() => old.provider.snapshot()).toThrow("released");
  });

  it("rejects publication/disposal reentry before state changes", () => {
    const { coordination, cohort } = setup();
    coordination.subscribe(() => {
      expect(() => cohort.publish([update("a", 2)])).toThrow("reentry");
      expect(() => cohort.dispose()).toThrow("reentry");
    });
    cohort.publish([update("a", 1)]);
    expect(selected(cohort)).toEqual([
      ["a", 1, 0],
      ["b", 0, 10],
    ]);
  });

  it("attempts every cleanup, preserves custom state, and retries only failed owned cleanup", () => {
    const { world, coordination, cohort, a, b, Custom } = setup();
    const original = coordination.unregister;
    let failed = false;
    const faulty = {
      ...coordination,
      unregister(token: Parameters<typeof original>[0]) {
        if (!failed) {
          failed = true;
          throw new Error("cleanup fault");
        }
        return original(token);
      },
    };
    // A separate owned cohort on the same binding exercises transient cleanup.
    const c = world.spawn(Custom),
      d = world.spawn(Custom);
    const owned = createProofCohort(faulty, [
      { id: "c", entity: c, sourceId: "c", instanceId: "c", providerGeneration: 1 },
      { id: "d", entity: d, sourceId: "d", instanceId: "d", providerGeneration: 1 },
    ]);
    expect(() => owned.dispose()).toThrow("retryable");
    expect(coordination.getRegistration("c")).toBeDefined();
    expect(coordination.getRegistration("d")).toBeUndefined();
    owned.dispose();
    expect(coordination.getRegistration("c")).toBeUndefined();
    expect(world.has(c) && world.has(d)).toBe(true);
    cohort.dispose();
    expect(a.get(Custom)?.keep).toBe(42);
    expect(b.get(Custom)?.keep).toBe(42);
    expect(world.isInitialized).toBe(true);
  });

  it("does not remove replacement registrations after destroyed entity ID reuse", () => {
    const { world, a, coordination, cohort } = setup();
    a.destroy();
    expect(cohort.capture().snapshot.valid).toBe(false);
    coordination.prune();
    const replacement = world.spawn();
    const token = coordination.register(replacement, { id: "a", capabilities: [] });
    expect(() => cohort.publish([update("a", 1)])).toThrow("stale owned");
    cohort.dispose();
    expect(coordination.getRegistration("a")).toBe(token);
    expect(coordination.getEntity("a")).toBe(replacement);
  });

  it("recovers and cleans the owned token when constructor notification throws after commit", () => {
    const world = createWorld();
    worlds.push(world);
    const coordination = bindCoordination(world);
    const entity = world.spawn();
    coordination.subscribe(() => {
      throw new Error("constructor listener fault");
    });
    expect(() =>
      createProofCohort(coordination, [
        { id: "x", entity, sourceId: "x", instanceId: "x", providerGeneration: 1 },
      ]),
    ).toThrow("owned token recovery");
    expect(coordination.getRegistration("x")).toBeUndefined();
    expect(entity.has(CoordinationRegistration)).toBe(false);
    expect(world.has(entity)).toBe(true);
  });
  it("isolates unrelated binding entries and rejects an unprepared owned tuple", () => {
    const { world, coordination, cohort } = setup();
    const token = coordination.register(world.spawn(), { id: "unrelated", capabilities: [] });
    coordination.publish(token, { revisions: { geometry: 5, pose: 0, transform: 0 } });
    expect(selected(cohort)).toEqual([
      ["a", 0, 0],
      ["b", 0, 10],
    ]);
    const owned = coordination.getRegistration("a");
    if (!owned) throw new Error("test setup lacks owned registration");
    coordination.publish(owned, { revisions: { geometry: 5, pose: 0, transform: 0 } });
    const capture = cohort.capture();
    expect(capture.snapshot.valid).toBe(false);
    capture.release();
  });
  it("preserves a pre-existing caller token when construction rejects its duplicate identity", () => {
    const world = createWorld();
    worlds.push(world);
    const coordination = bindCoordination(world);
    const entity = world.spawn();
    const callerToken = coordination.register(entity, {
      id: "caller",
      capabilities: ["caller-owned"],
    });
    expect(() =>
      createProofCohort(coordination, [
        { id: "caller", entity, sourceId: "caller", instanceId: "caller", providerGeneration: 1 },
      ]),
    ).toThrow();
    expect(coordination.getRegistration("caller")).toBe(callerToken);
    expect(coordination.getEntity("caller")).toBe(entity);
  });
  it("does not validate a cached historical snapshot after its unleased geometry was collected", () => {
    const { coordination, cohort } = setup();
    const historical = coordination.getSnapshot();
    cohort.getSnapshot();
    cohort.publish([update("a", 1, 1)]);
    const capture = cohort.capture(historical);
    expect(capture.snapshot.valid).toBe(false);
    capture.release();
  });
  it("rejects fresh captures after disposal while retaining a previously acquired lease", () => {
    const { cohort } = setup();
    const held = cohort.capture();
    cohort.dispose();
    expect(() => cohort.capture()).toThrow("disposed");
    expect(held.provider.snapshot()).toHaveLength(2);
    held.release();
  });
});
