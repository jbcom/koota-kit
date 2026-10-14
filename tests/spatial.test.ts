import { describe, expect, it } from "vitest";
import {
  queryPointClearance,
  type SpatialClearanceQuery,
  type SpatialFrame,
  type SpatialNearestSurfaceOracle,
  type SpatialPartRecord,
  type SpatialProvider,
  type SpatialRecordStamp,
} from "../src/spatial.js";

const frame: SpatialFrame = { id: "scene", unit: "metre", metric: "euclidean" };

function record(id: string, options: Partial<SpatialPartRecord> = {}): SpatialPartRecord {
  return {
    identity: {
      sourceId: "fixture",
      instanceId: "ava",
      partId: id,
      registration: { id: "binding", generation: 3 },
    },
    frame,
    revisions: { geometry: 1, topology: 2, pose: 3, transform: 4 },
    topology: {
      full: {
        id: `${id}:full`,
        bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
        enclosesSurface: true,
      },
      visible: {
        id: `${id}:visible`,
        bounds: { min: { x: 20, y: 20, z: 20 }, max: { x: 21, y: 21, z: 21 } },
        enclosesSurface: true,
      },
    },
    capabilities: ["nearest-surface"],
    ...options,
  };
}

function provider(...records: SpatialPartRecord[]): SpatialProvider {
  return { snapshot: () => records };
}

function inheritedSparse<T>(protoValues: T[]): readonly T[] {
  const sparse = new Array<T>(protoValues.length);
  Object.setPrototypeOf(sparse, protoValues);
  return Object.freeze(sparse) as readonly T[];
}

const baseQuery = (): SpatialClearanceQuery => ({
  point: { x: 0, y: 0, z: 0 },
  frame,
  minimumDistance: 0.5,
  searchDistance: 2,
});

function oracle(distance: number, calls: string[] = []): SpatialNearestSurfaceOracle {
  return {
    nearest: ({ record, topology, point }) => {
      calls.push(`${record.identity.partId}:${topology}`);
      return {
        kind: "nearest",
        witness: {
          triangleId: `${record.identity.partId}:7`,
          point: { x: point.x + distance, y: point.y, z: point.z },
          distance,
          frame: record.frame,
          consumed: {
            identity: record.identity,
            frame: record.frame,
            topology: { selection: topology, id: record.topology[topology].id },
            revisions: record.revisions,
          },
        },
      };
    },
  };
}

describe("queryPointClearance", () => {
  it("sorts completed provider records, defaults to full topology, and proves far AABBs safe conservatively", () => {
    const far = record("z", {
      topology: {
        full: {
          id: "z:full",
          bounds: { min: { x: 2, y: 2, z: 2 }, max: { x: 3, y: 3, z: 3 } },
          enclosesSurface: true,
        },
        visible: {
          id: "z:visible",
          bounds: { min: { x: 2, y: 2, z: 2 }, max: { x: 3, y: 3, z: 3 } },
          enclosesSurface: true,
        },
      },
    });
    const other = record("a", {
      topology: {
        full: { id: "a:full", bounds: far.topology.full.bounds, enclosesSurface: true },
        visible: { id: "a:visible", bounds: far.topology.visible.bounds, enclosesSurface: true },
      },
    });
    const calls: string[] = [];
    const result = queryPointClearance(provider(far, other), oracle(0.1, calls), baseQuery());

    expect(result).toMatchObject({
      status: "satisfied",
      exactness: "conservative",
      topology: "full",
      witnesses: [],
    });
    expect(result.checked.map((stamp) => stamp.identity.partId)).toEqual(["a", "z"]);
    expect(calls).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns an exact violation even when another selected provider cannot answer", () => {
    const unsupported = record("a", { capabilities: [] });
    const result = queryPointClearance(
      provider(record("z"), unsupported),
      oracle(0.25),
      baseQuery(),
    );

    expect(result.status).toBe("violated");
    expect(result.reason).toBe("clearance-violated");
    expect(result.exactness).toBe("exact");
    expect(result.witnesses[0]?.triangleId).toBe("z:7");
  });

  it("preserves an exact violation when a different oracle reply is malformed", () => {
    const invalidThenClose: SpatialNearestSurfaceOracle = {
      nearest: ({ record, topology, point }) => {
        if (record.identity.partId === "a") return { kind: "bad" } as never;
        return {
          kind: "nearest",
          witness: {
            triangleId: "z:1",
            point: { x: point.x + 0.25, y: point.y, z: point.z },
            distance: 0.25,
            frame,
            consumed: {
              identity: record.identity,
              frame,
              topology: { selection: topology, id: record.topology[topology].id },
              revisions: record.revisions,
            },
          },
        };
      },
    };
    expect(
      queryPointClearance(provider(record("a"), record("z")), invalidThenClose, baseQuery()),
    ).toMatchObject({ status: "violated", reason: "clearance-violated" });
  });

  it("accepts an exact bounded no-hit and an AABB exactly on the clearance threshold", () => {
    const current = record("body");
    const noHit: SpatialNearestSurfaceOracle = {
      nearest: ({ record, topology }) => ({
        kind: "no-hit",
        consumed: {
          identity: record.identity,
          frame: record.frame,
          topology: { selection: topology, id: record.topology[topology].id },
          revisions: record.revisions,
        },
      }),
    };
    expect(queryPointClearance(provider(current), noHit, baseQuery())).toMatchObject({
      status: "satisfied",
      exactness: "exact",
    });
    const boundary = record("boundary", {
      capabilities: [],
      topology: {
        full: {
          id: "boundary:full",
          bounds: { min: { x: 0.5, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
          enclosesSurface: true,
        },
        visible: record("boundary").topology.visible,
      },
    });
    expect(queryPointClearance(provider(boundary), noHit, baseQuery())).toMatchObject({
      status: "satisfied",
      exactness: "conservative",
    });
  });

  it("uses visible topology only when explicitly requested and returns exact satisfaction", () => {
    const calls: string[] = [];
    const result = queryPointClearance(provider(record("body")), oracle(0.5, calls), {
      ...baseQuery(),
      topology: "visible",
    });

    expect(result).toMatchObject({
      status: "satisfied",
      exactness: "conservative",
      topology: "visible",
    });
    expect(calls).toEqual([]);

    const visible = record("body", {
      topology: {
        full: record("body").topology.full,
        visible: {
          id: "body:visible",
          bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
          enclosesSurface: true,
        },
      },
    });
    const exact = queryPointClearance(provider(visible), oracle(0.5, calls), {
      ...baseQuery(),
      topology: "visible",
    });
    expect(exact.status).toBe("satisfied");
    expect(calls).toEqual(["body:visible"]);
  });

  it("applies exact exclusions before broadphase and reports them in stable order", () => {
    const first = record("a");
    const second = record("b");
    const query = { ...baseQuery(), exclusions: [second.identity, first.identity] };
    const result = queryPointClearance(provider(second, first), oracle(0.1), query);

    expect(result).toMatchObject({ status: "satisfied", exactness: "conservative" });
    expect(result.checked).toEqual([]);
    expect(result.exclusions.map((identity) => identity.partId)).toEqual(["a", "b"]);
  });

  it("rejects an expected completed tuple that no longer matches the provider", () => {
    const current = record("body");
    const stale: SpatialRecordStamp = {
      identity: current.identity,
      frame,
      topology: { selection: "full", id: current.topology.full.id },
      revisions: { ...current.revisions, topology: 99 },
    };
    const result = queryPointClearance(provider(current), oracle(0.1), {
      ...baseQuery(),
      expected: [stale],
    });

    expect(result).toMatchObject({
      status: "stale",
      reason: "revision-mismatch",
      exactness: "none",
    });
  });

  it("validates an expected stamp before excluding that provider from the predicate", () => {
    const current = record("body");
    const expected: SpatialRecordStamp = {
      identity: current.identity,
      frame,
      topology: { selection: "full", id: current.topology.full.id },
      revisions: current.revisions,
    };
    const result = queryPointClearance(provider(current), oracle(0.1), {
      ...baseQuery(),
      expected: [expected],
      exclusions: [current.identity],
    });

    expect(result).toMatchObject({ status: "satisfied", exactness: "conservative", checked: [] });
  });

  it("matches expected tuples by complete collision-safe identity regardless of input order", () => {
    const first = record("body", {
      identity: {
        sourceId: "fixture|ava",
        instanceId: "other",
        partId: "body",
        registration: { id: "binding", generation: 3 },
      },
    });
    const second = record("body", {
      identity: { ...first.identity, sourceId: "fixture", instanceId: "ava|other" },
      revisions: { ...first.revisions, geometry: 9 },
    });
    const third = record("body", {
      identity: { ...second.identity, registration: { id: "binding", generation: 4 } },
      revisions: { ...second.revisions, transform: 7 },
    });
    const stamp = (value: SpatialPartRecord): SpatialRecordStamp => ({
      identity: value.identity,
      frame: value.frame,
      topology: { selection: "full", id: value.topology.full.id },
      revisions: value.revisions,
    });
    const query = {
      ...baseQuery(),
      expected: [stamp(third), stamp(first), stamp(second)],
      exclusions: [third.identity],
    };
    const forward = queryPointClearance(provider(first, second, third), oracle(0.5), query);
    const reversed = queryPointClearance(provider(third, second, first), oracle(0.5), query);
    expect(forward).toEqual(reversed);
    expect(forward.status).toBe("satisfied");
    expect(forward.checked.map((value) => value.identity)).toEqual([
      second.identity,
      first.identity,
    ]);

    const calls: string[] = [];
    for (const expected of [
      { ...stamp(third), revisions: { ...third.revisions, pose: 99 } },
      { ...stamp(third), identity: { ...third.identity, partId: "missing" } },
    ]) {
      expect(
        queryPointClearance(provider(first, second, third), oracle(0.1, calls), {
          ...query,
          expected: [stamp(first), stamp(second), expected],
        }),
      ).toMatchObject({
        status: "stale",
        reason: "revision-mismatch",
        checked: [stamp(second), stamp(third), stamp(first)],
        witnesses: [],
      });
    }
    expect(calls).toEqual([]);
  });

  it("rejects an oracle reply consumed from a different completed tuple", () => {
    const current = record("body");
    const staleOracle: SpatialNearestSurfaceOracle = {
      nearest: ({ record, topology, point }) => ({
        kind: "nearest",
        witness: {
          triangleId: "body:1",
          point: { x: point.x + 0.1, y: point.y, z: point.z },
          distance: 0.1,
          frame,
          consumed: {
            identity: record.identity,
            frame,
            topology: { selection: topology, id: record.topology[topology].id },
            revisions: { ...record.revisions, pose: 5 },
          },
        },
      }),
    };
    expect(queryPointClearance(provider(current), staleOracle, baseQuery())).toMatchObject({
      status: "stale",
      reason: "oracle-stale",
    });
  });

  it("keeps capability, backend uncertainty, and malformed provider facts distinct", () => {
    const current = record("body");
    const unknown: SpatialNearestSurfaceOracle = {
      nearest: ({ record, topology }) => ({
        kind: "unknown",
        reason: "read lease unavailable",
        consumed: {
          identity: record.identity,
          frame,
          topology: { selection: topology, id: record.topology[topology].id },
          revisions: record.revisions,
        },
      }),
    };
    expect(queryPointClearance(provider(current), unknown, baseQuery())).toMatchObject({
      status: "unknown",
      reason: "oracle-unknown",
    });
    expect(
      queryPointClearance(provider(current), { nearest: () => undefined }, baseQuery()),
    ).toMatchObject({ status: "unsupported", reason: "nearest-surface-unsupported" });
    expect(
      queryPointClearance(
        provider({ ...current, frame: { ...frame, unit: "foot" } }),
        oracle(0.1),
        baseQuery(),
      ),
    ).toMatchObject({ status: "unsupported", reason: "provider-contract-invalid" });
    expect(queryPointClearance(provider(current, current), oracle(0.1), baseQuery())).toMatchObject(
      { status: "unsupported", reason: "provider-duplicate-record" },
    );
  });

  it("does not trust non-common-metric witnesses and validates query/provider data", () => {
    const current = record("body");
    const badDistance: SpatialNearestSurfaceOracle = {
      nearest: ({ record, topology }) => ({
        kind: "nearest",
        witness: {
          triangleId: "body:1",
          point: { x: 10, y: 0, z: 0 },
          distance: 0.1,
          frame,
          consumed: {
            identity: record.identity,
            frame,
            topology: { selection: topology, id: record.topology[topology].id },
            revisions: record.revisions,
          },
        },
      }),
    };
    expect(queryPointClearance(provider(current), badDistance, baseQuery())).toMatchObject({
      status: "unsupported",
      reason: "provider-contract-invalid",
    });
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), { ...baseQuery(), minimumDistance: -1 }),
    ).toThrow(/minimumDistance/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), {
        ...baseQuery(),
        exclusions: [current.identity, current.identity],
      }),
    ).toThrow(/duplicates/);
    expect(
      queryPointClearance(
        provider({
          ...current,
          topology: {
            ...current.topology,
            full: { ...current.topology.full, enclosesSurface: false },
          },
        } as never),
        oracle(0.1),
        baseQuery(),
      ),
    ).toMatchObject({ status: "unsupported", reason: "provider-contract-invalid" });
  });

  it("rejects malformed oracle facts and does not merge NUL-containing identities", () => {
    const current = record("body");
    const malformed = [
      { nearest: () => null },
      { nearest: () => ({ kind: "other" }) },
      { nearest: () => ({ kind: "nearest", witness: {} }) },
      {
        nearest: ({
          record,
          topology,
        }: {
          record: SpatialPartRecord;
          topology: "full" | "visible";
        }) => ({
          kind: "unknown",
          reason: "",
          consumed: {
            identity: record.identity,
            frame,
            topology: { selection: topology, id: record.topology[topology].id },
            revisions: record.revisions,
          },
        }),
      },
    ] as SpatialNearestSurfaceOracle[];
    for (const candidate of malformed) {
      expect(queryPointClearance(provider(current), candidate, baseQuery())).toMatchObject({
        status: "unsupported",
        reason: "provider-contract-invalid",
      });
    }

    const nul = record("part", {
      identity: {
        sourceId: "a\u0000b",
        instanceId: "c",
        partId: "part",
        registration: { id: "d", generation: 0 },
      },
    });
    const distinct = record("part", {
      identity: {
        sourceId: "a",
        instanceId: "b\u0000c",
        partId: "part",
        registration: { id: "d", generation: 0 },
      },
    });
    expect(
      queryPointClearance(provider(nul, distinct), oracle(0.1), baseQuery()).checked,
    ).toHaveLength(2);
  });

  it("fails closed on every malformed caller or provider structural field", () => {
    const current = record("body");
    const check = (candidate: unknown) =>
      expect(
        queryPointClearance(provider(candidate as SpatialPartRecord), oracle(0.1), baseQuery()),
      ).toMatchObject({ status: "unsupported", reason: "provider-contract-invalid" });
    check(null);
    check({ ...current, identity: null });
    check({ ...current, identity: { ...current.identity, registration: null } });
    check({ ...current, identity: { ...current.identity, sourceId: "" } });
    check({ ...current, revisions: null });
    check({ ...current, revisions: { ...current.revisions, geometry: -1 } });
    check({ ...current, frame: { ...frame, metric: "taxicab" } });
    check({ ...current, topology: null });
    check({ ...current, topology: { ...current.topology, full: null } });
    check({
      ...current,
      topology: { ...current.topology, full: { ...current.topology.full, bounds: null } },
    });
    check({
      ...current,
      topology: {
        ...current.topology,
        full: {
          ...current.topology.full,
          bounds: { min: { x: 2, y: 0, z: 0 }, max: { x: 1, y: 0, z: 0 } },
        },
      },
    });
    check({ ...current, capabilities: null });
    check({ ...current, capabilities: ["unrecognized"] });
    check({ ...current, capabilities: ["nearest-surface", "nearest-surface"] });
    expect(() => queryPointClearance(null as never, oracle(0.1), baseQuery())).toThrow(/provider/);
    expect(() => queryPointClearance(provider(current), null as never, baseQuery())).toThrow(
      /oracle/,
    );
    expect(() => queryPointClearance(provider(current), oracle(0.1), null as never)).toThrow(
      /query/,
    );
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), { ...baseQuery(), point: null as never }),
    ).toThrow(/point/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), {
        ...baseQuery(),
        point: { x: Number.NaN, y: 0, z: 0 },
      }),
    ).toThrow(/finite/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), { ...baseQuery(), frame: null as never }),
    ).toThrow(/frame/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), {
        ...baseQuery(),
        frame: { ...frame, id: "" },
      }),
    ).toThrow(/non-empty/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), { ...baseQuery(), searchDistance: 0.1 }),
    ).toThrow(/searchDistance/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), {
        ...baseQuery(),
        topology: "other" as never,
      }),
    ).toThrow(/topology/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), {
        ...baseQuery(),
        exclusions: {} as never,
      }),
    ).toThrow(/exclusions/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), {
        ...baseQuery(),
        expected: {} as never,
      }),
    ).toThrow(/expected/);
    const stamp: SpatialRecordStamp = {
      identity: current.identity,
      frame,
      topology: { selection: "full", id: current.topology.full.id },
      revisions: current.revisions,
    };
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), {
        ...baseQuery(),
        expected: [stamp, stamp],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      queryPointClearance(provider(current), oracle(0.1), {
        ...baseQuery(),
        expected: [
          {
            identity: current.identity,
            frame,
            topology: { selection: "other", id: "x" },
            revisions: current.revisions,
          },
        ] as never,
      }),
    ).toThrow(/selection/);
    expect(() =>
      queryPointClearance({ snapshot: () => ({}) as never }, oracle(0.1), baseQuery()),
    ).toThrow(/array/);
  });

  it("rejects witnesses outside their certified AABB or frame", () => {
    const current = record("body");
    const nearest = (frameValue: SpatialFrame, point: { x: number; y: number; z: number }) => ({
      nearest: ({
        record,
        topology,
      }: {
        record: SpatialPartRecord;
        topology: "full" | "visible";
      }) => ({
        kind: "nearest" as const,
        witness: {
          triangleId: "body:1",
          point,
          distance: Math.hypot(point.x, point.y, point.z),
          frame: frameValue,
          consumed: {
            identity: record.identity,
            frame: record.frame,
            topology: { selection: topology, id: record.topology[topology].id },
            revisions: record.revisions,
          },
        },
      }),
    });
    expect(
      queryPointClearance(provider(current), nearest(frame, { x: 2, y: 0, z: 0 }), baseQuery()),
    ).toMatchObject({ status: "unsupported", reason: "provider-contract-invalid" });
    expect(
      queryPointClearance(
        provider(current),
        nearest({ ...frame, id: "other" }, { x: 0.1, y: 0, z: 0 }),
        baseQuery(),
      ),
    ).toMatchObject({ status: "unsupported", reason: "provider-contract-invalid" });
  });

  it("fails closed on sparse provider snapshots and rejects sparse caller lists", () => {
    const sparse = new Array<SpatialPartRecord>(1);
    for (const snapshot of [sparse, [record("body"), ...sparse]]) {
      expect(
        queryPointClearance({ snapshot: () => snapshot }, oracle(0.1), baseQuery()),
      ).toMatchObject({
        status: "unsupported",
        reason: "provider-contract-invalid",
      });
    }
    sparse[1] = record("body");
    expect(queryPointClearance({ snapshot: () => sparse }, oracle(0.1), baseQuery())).toMatchObject(
      {
        status: "unsupported",
        reason: "provider-contract-invalid",
      },
    );
    expect(() =>
      queryPointClearance(provider(), oracle(0.1), {
        ...baseQuery(),
        exclusions: new Array(1),
      }),
    ).toThrow(TypeError);
    expect(() =>
      queryPointClearance(provider(), oracle(0.1), {
        ...baseQuery(),
        expected: new Array(1),
      }),
    ).toThrow(TypeError);
  });

  it("rejects sparse capabilities before far-AABB satisfaction while accepting an empty capability list", () => {
    const bounds = record("far").topology.visible;
    const far = record("far", {
      topology: { full: bounds, visible: bounds },
      capabilities: new Array(1),
    });
    const calls: string[] = [];
    expect(queryPointClearance(provider(far), oracle(0.1, calls), baseQuery())).toMatchObject({
      status: "unsupported",
      reason: "provider-contract-invalid",
    });
    expect(
      queryPointClearance(provider({ ...far, capabilities: [] }), oracle(0.1, calls), baseQuery()),
    ).toMatchObject({ status: "satisfied", exactness: "conservative" });
    expect(calls).toEqual([]);
  });

  it("labels satisfaction using both exact oracle and AABB evidence conservative", () => {
    const near = record("near");
    const far = record("far", {
      topology: { full: near.topology.visible, visible: near.topology.visible },
    });
    const calls: string[] = [];
    expect(queryPointClearance(provider(far, near), oracle(0.5, calls), baseQuery())).toMatchObject(
      {
        status: "satisfied",
        exactness: "conservative",
      },
    );
    expect(calls).toEqual(["near:full"]);
  });

  it("snapshots distance thresholds before provider and oracle callbacks", () => {
    for (const phase of ["provider", "oracle"]) {
      const query = { ...baseQuery() };
      const mutate = () => {
        query.minimumDistance = 0;
        query.searchDistance = 0;
      };
      const close = oracle(0.25);
      const maximumDistances: number[] = [];
      expect(
        queryPointClearance(
          {
            snapshot: () => {
              if (phase === "provider") mutate();
              return [record("body")];
            },
          },
          {
            nearest: (request) => {
              maximumDistances.push(request.maximumDistance);
              if (phase === "oracle") mutate();
              return close.nearest(request);
            },
          },
          query,
        ),
      ).toMatchObject({ status: "violated", exactness: "exact" });
      expect(maximumDistances).toEqual([2]);
    }
  });

  it("preserves exact violations across foreign-frame peers in any provider order", () => {
    const foreign = record("a", { frame: { ...frame, unit: "foot" } });
    const compatible = record("z");
    const forward = queryPointClearance(provider(foreign, compatible), oracle(0.25), baseQuery());
    const reverse = queryPointClearance(provider(compatible, foreign), oracle(0.25), baseQuery());
    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({ status: "violated", exactness: "exact" });
    expect(forward.witnesses[0]?.triangleId).toBe("z:7");
  });

  it("returns the computed metric distance when an accepted oracle tolerance crosses clearance", () => {
    const actualDistance = 0.5 - 5e-10;
    const roundedOracle: SpatialNearestSurfaceOracle = {
      nearest: ({ record, topology }) => ({
        kind: "nearest",
        witness: {
          triangleId: "body:1",
          point: { x: actualDistance, y: 0, z: 0 },
          distance: 0.5,
          frame,
          consumed: {
            identity: record.identity,
            frame,
            topology: { selection: topology, id: record.topology[topology].id },
            revisions: record.revisions,
          },
        },
      }),
    };
    const result = queryPointClearance(provider(record("body")), roundedOracle, baseQuery());
    expect(result).toMatchObject({ status: "violated", exactness: "exact" });
    expect(result.witnesses[0]?.distance).toBe(actualDistance);
  });

  it("rejects a finite witness whose computed common-metric distance exceeds the search bound", () => {
    const current = record("body");
    const witness = (point: { x: number; y: number; z: number }, distance: number) => ({
      nearest: ({
        record,
        topology,
      }: {
        record: SpatialPartRecord;
        topology: "full" | "visible";
      }) => ({
        kind: "nearest" as const,
        witness: {
          triangleId: "body:1",
          point,
          distance,
          frame,
          consumed: {
            identity: record.identity,
            frame: record.frame,
            topology: { selection: topology, id: record.topology[topology].id },
            revisions: record.revisions,
          },
        },
      }),
    });
    expect(
      queryPointClearance(provider(current), witness({ x: 0.75, y: 0, z: 0 }, 0.75), {
        ...baseQuery(),
        searchDistance: 0.5,
      }),
    ).toMatchObject({ status: "unsupported", reason: "provider-contract-invalid" });
    const huge = record("huge", {
      topology: {
        full: {
          id: "huge:full",
          bounds: {
            min: { x: -Number.MAX_VALUE, y: -Number.MAX_VALUE, z: -Number.MAX_VALUE },
            max: { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE },
          },
          enclosesSurface: true,
        },
        visible: record("huge").topology.visible,
      },
    });
    expect(
      queryPointClearance(
        provider(huge),
        witness({ x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: 0 }, 2),
        { ...baseQuery(), searchDistance: 0.5 },
      ),
    ).toMatchObject({ status: "unsupported", reason: "provider-contract-invalid" });
  });

  it("rejects sparse provider snapshot arrays with inherited prototype values", () => {
    const farBounds = record("far").topology.visible;
    const farRecord = record("far", {
      topology: { full: farBounds, visible: farBounds },
    });
    const sparseSnapshotProvider: SpatialProvider = {
      snapshot: () => inheritedSparse([farRecord]),
    };
    expect(queryPointClearance(sparseSnapshotProvider, oracle(0.1), baseQuery())).toMatchObject({
      status: "unsupported",
      reason: "provider-contract-invalid",
    });
  });

  it("rejects sparse capability arrays with inherited prototype values", () => {
    const farBounds = record("far").topology.visible;
    const farWithInheritedCaps = record("far", {
      topology: { full: farBounds, visible: farBounds },
      capabilities: inheritedSparse(["nearest-surface"]),
    });
    expect(
      queryPointClearance(provider(farWithInheritedCaps), oracle(0.1), baseQuery()),
    ).toMatchObject({
      status: "unsupported",
      reason: "provider-contract-invalid",
    });
  });

  it("rejects sparse query exclusion arrays with inherited prototype values", () => {
    const violating = record("body");
    const sparseExclusions = inheritedSparse([violating.identity]);
    expect(() =>
      queryPointClearance(provider(violating), oracle(0.1), {
        ...baseQuery(),
        exclusions: sparseExclusions,
      }),
    ).toThrow(TypeError);
  });

  it("rejects sparse query expected stamp arrays with inherited prototype values", () => {
    const violating = record("body");
    const stamp: SpatialRecordStamp = {
      identity: violating.identity,
      frame,
      topology: { selection: "full", id: violating.topology.full.id },
      revisions: violating.revisions,
    };
    const sparseExpected = inheritedSparse([stamp]);
    expect(() =>
      queryPointClearance(provider(violating), oracle(0.1), {
        ...baseQuery(),
        expected: sparseExpected,
      }),
    ).toThrow(TypeError);
  });
});
