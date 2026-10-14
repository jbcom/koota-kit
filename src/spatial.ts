/**
 * Renderer-neutral point-to-surface clearance queries.
 *
 * Producers own their buffers, transforms, and exact geometry implementations.
 * This module only validates a completed provider snapshot, filters certified
 * AABBs, and calls an injected oracle in one declared common metric.
 */

export type SpatialPoint = Readonly<{ x: number; y: number; z: number }>;

export type SpatialAabb = Readonly<{ min: SpatialPoint; max: SpatialPoint }>;

export type SpatialFrame = Readonly<{
  id: string;
  unit: string;
  metric: "euclidean";
}>;

/** A provider-local registration identity. It is deliberately not a coordination token. */
export type SpatialRegistrationIdentity = Readonly<{ id: string; generation: number }>;

export type SpatialIdentity = Readonly<{
  sourceId: string;
  instanceId: string;
  partId: string;
  registration: SpatialRegistrationIdentity;
}>;

/** Independent completed producer epochs; none is a coordination publication revision. */
export type SpatialRevision = Readonly<{
  geometry: number;
  topology: number;
  pose: number;
  transform: number;
}>;

export type SpatialTopology = Readonly<{
  id: string;
  /** The provider certifies that this AABB encloses the topology it supplies to the oracle. */
  bounds: SpatialAabb;
  enclosesSurface: true;
}>;

export type SpatialPartRecord = Readonly<{
  identity: SpatialIdentity;
  frame: SpatialFrame;
  revisions: SpatialRevision;
  /** `full` remains the default. `visible` is only selected explicitly by a query. */
  topology: Readonly<{ full: SpatialTopology; visible: SpatialTopology }>;
  capabilities: readonly "nearest-surface"[];
}>;

export type SpatialTopologySelection = "full" | "visible";

export type SpatialRecordStamp = Readonly<{
  identity: SpatialIdentity;
  frame: SpatialFrame;
  topology: Readonly<{ selection: SpatialTopologySelection; id: string }>;
  revisions: SpatialRevision;
}>;

export type SpatialNearestWitness = Readonly<{
  triangleId: string;
  point: SpatialPoint;
  distance: number;
  frame: SpatialFrame;
  consumed: SpatialRecordStamp;
}>;

export type SpatialOracleReply =
  | Readonly<{ kind: "nearest"; witness: SpatialNearestWitness }>
  | Readonly<{ kind: "no-hit"; consumed: SpatialRecordStamp }>
  | Readonly<{ kind: "unknown"; reason: string; consumed: SpatialRecordStamp }>;

export type SpatialNearestSurfaceOracle = Readonly<{
  nearest: (
    request: Readonly<{
      record: SpatialPartRecord;
      topology: SpatialTopologySelection;
      point: SpatialPoint;
      maximumDistance: number;
    }>,
  ) => SpatialOracleReply | undefined;
}>;

/** Provider snapshots must be completed, immutable records for one query call. */
export type SpatialProvider = Readonly<{ snapshot: () => readonly SpatialPartRecord[] }>;

export type SpatialClearanceQuery = Readonly<{
  point: SpatialPoint;
  frame: SpatialFrame;
  /** The predicate: every selected open surface must be at least this far away. */
  minimumDistance: number;
  /** Finite oracle search bound; it must be at least `minimumDistance`. */
  searchDistance: number;
  topology?: SpatialTopologySelection;
  exclusions?: readonly SpatialIdentity[];
  /** A mismatch is stale, before an oracle result can be trusted. */
  expected?: readonly SpatialRecordStamp[];
}>;

export type SpatialQueryStatus = "satisfied" | "violated" | "unknown" | "unsupported" | "stale";

export type SpatialQueryExactness = "exact" | "conservative" | "none";

export type SpatialQueryReason =
  | "clearance-satisfied"
  | "clearance-violated"
  | "oracle-unknown"
  | "nearest-surface-unsupported"
  | "provider-contract-invalid"
  | "provider-duplicate-record"
  | "revision-mismatch"
  | "oracle-stale";

export type SpatialClearanceResult = Readonly<{
  status: SpatialQueryStatus;
  reason: SpatialQueryReason;
  exactness: SpatialQueryExactness;
  topology: SpatialTopologySelection;
  checked: readonly SpatialRecordStamp[];
  exclusions: readonly SpatialIdentity[];
  witnesses: readonly SpatialNearestWitness[];
}>;

type PreparedRecord = Readonly<{
  record: SpatialPartRecord;
  stamp: SpatialRecordStamp;
  boundsDistance: number;
}>;

const finitePoint = (value: unknown, label: string): SpatialPoint => {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`spatial: ${label} must be a point.`);
  const point = value as SpatialPoint;
  for (const axis of ["x", "y", "z"] as const) {
    if (!Number.isFinite(point[axis]))
      throw new RangeError(`spatial: ${label}.${axis} must be finite.`);
  }
  return Object.freeze({ x: point.x, y: point.y, z: point.z });
};

const nonEmpty = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`spatial: ${label} must be a non-empty string.`);
  return value;
};

const nonNegativeRevision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`spatial: ${label} must be a non-negative safe integer.`);
  }
  return value as number;
};

function copyFrame(value: unknown, label: string): SpatialFrame {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`spatial: ${label} must be a frame.`);
  const frame = value as SpatialFrame;
  if (frame.metric !== "euclidean")
    throw new TypeError(`spatial: ${label}.metric must be euclidean.`);
  return Object.freeze({
    id: nonEmpty(frame.id, `${label}.id`),
    unit: nonEmpty(frame.unit, `${label}.unit`),
    metric: "euclidean",
  });
}

function sameFrame(left: SpatialFrame, right: SpatialFrame): boolean {
  return left.id === right.id && left.unit === right.unit && left.metric === right.metric;
}

function copyIdentity(value: unknown, label: string): SpatialIdentity {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`spatial: ${label} must be an identity.`);
  const identity = value as SpatialIdentity;
  if (typeof identity.registration !== "object" || identity.registration === null) {
    throw new TypeError(`spatial: ${label}.registration must be an identity.`);
  }
  return Object.freeze({
    sourceId: nonEmpty(identity.sourceId, `${label}.sourceId`),
    instanceId: nonEmpty(identity.instanceId, `${label}.instanceId`),
    partId: nonEmpty(identity.partId, `${label}.partId`),
    registration: Object.freeze({
      id: nonEmpty(identity.registration.id, `${label}.registration.id`),
      generation: nonNegativeRevision(
        identity.registration.generation,
        `${label}.registration.generation`,
      ),
    }),
  });
}

function sameIdentity(left: SpatialIdentity, right: SpatialIdentity): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.instanceId === right.instanceId &&
    left.partId === right.partId &&
    left.registration.id === right.registration.id &&
    left.registration.generation === right.registration.generation
  );
}

function identityKey(identity: SpatialIdentity): string {
  return JSON.stringify([
    identity.sourceId,
    identity.instanceId,
    identity.partId,
    identity.registration.id,
    identity.registration.generation,
  ]);
}

function compareIdentity(left: SpatialIdentity, right: SpatialIdentity): number {
  const leftKey = identityKey(left);
  const rightKey = identityKey(right);
  return Number(leftKey > rightKey) - Number(leftKey < rightKey);
}

function copyRevisions(value: unknown, label: string): SpatialRevision {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`spatial: ${label} must be revisions.`);
  const revisions = value as SpatialRevision;
  return Object.freeze({
    geometry: nonNegativeRevision(revisions.geometry, `${label}.geometry`),
    topology: nonNegativeRevision(revisions.topology, `${label}.topology`),
    pose: nonNegativeRevision(revisions.pose, `${label}.pose`),
    transform: nonNegativeRevision(revisions.transform, `${label}.transform`),
  });
}

function sameRevisions(left: SpatialRevision, right: SpatialRevision): boolean {
  return (
    left.geometry === right.geometry &&
    left.topology === right.topology &&
    left.pose === right.pose &&
    left.transform === right.transform
  );
}

function copyBounds(value: unknown, label: string): SpatialAabb {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`spatial: ${label} must be an AABB.`);
  const bounds = value as SpatialAabb;
  const min = finitePoint(bounds.min, `${label}.min`);
  const max = finitePoint(bounds.max, `${label}.max`);
  for (const axis of ["x", "y", "z"] as const) {
    if (min[axis] > max[axis])
      throw new RangeError(`spatial: ${label}.min.${axis} must not exceed max.${axis}.`);
  }
  return Object.freeze({ min, max });
}

function copyTopology(value: unknown, label: string): SpatialTopology {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`spatial: ${label} must be topology.`);
  const topology = value as SpatialTopology;
  if (topology.enclosesSurface !== true)
    throw new TypeError(`spatial: ${label}.enclosesSurface must certify true.`);
  return Object.freeze({
    id: nonEmpty(topology.id, `${label}.id`),
    bounds: copyBounds(topology.bounds, `${label}.bounds`),
    enclosesSurface: true,
  });
}

function copyRecord(value: unknown, label: string): SpatialPartRecord {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`spatial: ${label} must be a part record.`);
  const record = value as SpatialPartRecord;
  if (typeof record.topology !== "object" || record.topology === null)
    throw new TypeError(`spatial: ${label}.topology must be an object.`);
  if (
    !Array.isArray(record.capabilities) ||
    record.capabilities.some((capability) => capability !== "nearest-surface") ||
    new Set(record.capabilities).size !== record.capabilities.length
  ) {
    throw new TypeError(`spatial: ${label}.capabilities may only contain nearest-surface.`);
  }
  return Object.freeze({
    identity: copyIdentity(record.identity, `${label}.identity`),
    frame: copyFrame(record.frame, `${label}.frame`),
    revisions: copyRevisions(record.revisions, `${label}.revisions`),
    topology: Object.freeze({
      full: copyTopology(record.topology.full, `${label}.topology.full`),
      visible: copyTopology(record.topology.visible, `${label}.topology.visible`),
    }),
    capabilities: Object.freeze([...record.capabilities]),
  });
}

function makeStamp(
  record: SpatialPartRecord,
  selection: SpatialTopologySelection,
): SpatialRecordStamp {
  return Object.freeze({
    identity: record.identity,
    frame: record.frame,
    topology: Object.freeze({ selection, id: record.topology[selection].id }),
    revisions: record.revisions,
  });
}

function sameStamp(left: SpatialRecordStamp, right: SpatialRecordStamp): boolean {
  return (
    sameIdentity(left.identity, right.identity) &&
    sameFrame(left.frame, right.frame) &&
    left.topology.selection === right.topology.selection &&
    left.topology.id === right.topology.id &&
    sameRevisions(left.revisions, right.revisions)
  );
}

function copyStamp(value: unknown, label: string): SpatialRecordStamp {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`spatial: ${label} must be a record stamp.`);
  const stamp = value as SpatialRecordStamp;
  if (
    typeof stamp.topology !== "object" ||
    stamp.topology === null ||
    (stamp.topology.selection !== "full" && stamp.topology.selection !== "visible")
  ) {
    throw new TypeError(`spatial: ${label}.topology.selection must be full or visible.`);
  }
  return Object.freeze({
    identity: copyIdentity(stamp.identity, `${label}.identity`),
    frame: copyFrame(stamp.frame, `${label}.frame`),
    topology: Object.freeze({
      selection: stamp.topology.selection,
      id: nonEmpty(stamp.topology.id, `${label}.topology.id`),
    }),
    revisions: copyRevisions(stamp.revisions, `${label}.revisions`),
  });
}

function distanceToBounds(point: SpatialPoint, bounds: SpatialAabb): number {
  const delta = (["x", "y", "z"] as const).map((axis) =>
    Math.max(bounds.min[axis] - point[axis], 0, point[axis] - bounds.max[axis]),
  );
  return Math.hypot(...delta);
}

function pointDistance(left: SpatialPoint, right: SpatialPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function pointIsInside(point: SpatialPoint, bounds: SpatialAabb): boolean {
  return (["x", "y", "z"] as const).every(
    (axis) => point[axis] >= bounds.min[axis] && point[axis] <= bounds.max[axis],
  );
}

function sameDistance(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-9, Math.max(Math.abs(left), Math.abs(right)) / 1e9);
}

function result(
  status: SpatialQueryStatus,
  reason: SpatialQueryReason,
  exactness: SpatialQueryExactness,
  topology: SpatialTopologySelection,
  checked: readonly SpatialRecordStamp[],
  exclusions: readonly SpatialIdentity[],
  witnesses: readonly SpatialNearestWitness[],
): SpatialClearanceResult {
  return Object.freeze({
    status,
    reason,
    exactness,
    topology,
    checked: Object.freeze([...checked]),
    exclusions: Object.freeze([...exclusions]),
    witnesses: Object.freeze([...witnesses]),
  });
}

/**
 * Decide a point-to-open-surface clearance predicate in the given common
 * Euclidean frame. It never proves containment or solid nonpenetration.
 *
 * Status precedence is stale, then violated, then unsupported/unknown, then
 * satisfied. An exact close witness therefore proves a violation even if a
 * different selected provider cannot answer.
 */
export function queryPointClearance(
  provider: SpatialProvider,
  oracle: SpatialNearestSurfaceOracle,
  query: SpatialClearanceQuery,
): SpatialClearanceResult {
  if (typeof provider !== "object" || provider === null || typeof provider.snapshot !== "function")
    throw new TypeError("spatial: provider must expose snapshot().");
  if (typeof oracle !== "object" || oracle === null || typeof oracle.nearest !== "function")
    throw new TypeError("spatial: oracle must expose nearest().");
  if (typeof query !== "object" || query === null)
    throw new TypeError("spatial: query must be an object.");
  const point = finitePoint(query.point, "query.point");
  const frame = copyFrame(query.frame, "query.frame");
  const minimumDistance = query.minimumDistance;
  const searchDistance = query.searchDistance;
  if (!Number.isFinite(minimumDistance) || minimumDistance < 0)
    throw new RangeError("spatial: query.minimumDistance must be finite and non-negative.");
  if (!Number.isFinite(searchDistance) || searchDistance < minimumDistance)
    throw new RangeError(
      "spatial: query.searchDistance must be finite and at least minimumDistance.",
    );
  const topology = query.topology ?? "full";
  if (topology !== "full" && topology !== "visible")
    throw new TypeError("spatial: query.topology must be full or visible.");
  if (query.exclusions !== undefined && !Array.isArray(query.exclusions))
    throw new TypeError("spatial: query.exclusions must be an array.");
  if (query.expected !== undefined && !Array.isArray(query.expected))
    throw new TypeError("spatial: query.expected must be an array.");
  const exclusions = Array.from(query.exclusions ?? [], (value, index) =>
    copyIdentity(value, `query.exclusions[${index}]`),
  ).sort(compareIdentity);
  const exclusionKeys = new Set(exclusions.map(identityKey));
  if (exclusionKeys.size !== exclusions.length)
    throw new TypeError("spatial: query.exclusions must not contain duplicates.");
  const expected = Array.from(query.expected ?? [], (value, index) =>
    copyStamp(value, `query.expected[${index}]`),
  );
  const expectedKeys = new Set(expected.map((stamp) => identityKey(stamp.identity)));
  if (expectedKeys.size !== expected.length)
    throw new TypeError("spatial: query.expected must not contain duplicate identities.");

  const snapshot = provider.snapshot();
  if (!Array.isArray(snapshot))
    throw new TypeError("spatial: provider.snapshot() must return an array.");
  let records: SpatialPartRecord[];
  try {
    records = Array.from(snapshot, (record, index) =>
      copyRecord(record, `provider.snapshot()[${index}]`),
    );
  } catch {
    return result("unsupported", "provider-contract-invalid", "none", topology, [], exclusions, []);
  }
  const recordKeys = new Set(records.map((record) => identityKey(record.identity)));
  if (recordKeys.size !== records.length) {
    return result("unsupported", "provider-duplicate-record", "none", topology, [], exclusions, []);
  }
  records.sort((left, right) => compareIdentity(left.identity, right.identity));
  const allStamps = records.map((record) => makeStamp(record, topology));
  if (expected.length > 0) {
    const stampsByIdentity = new Map(
      allStamps.map((stamp) => [identityKey(stamp.identity), stamp]),
    );
    if (
      expected.some((stamp) => {
        const current = stampsByIdentity.get(identityKey(stamp.identity));
        return !current || !sameStamp(current, stamp);
      })
    ) {
      return result("stale", "revision-mismatch", "none", topology, allStamps, exclusions, []);
    }
  }
  const selected = records.filter((record) => !exclusionKeys.has(identityKey(record.identity)));
  const stamps = selected.map((record) => makeStamp(record, topology));

  let unresolved:
    | "nearest-surface-unsupported"
    | "provider-contract-invalid"
    | "oracle-unknown"
    | undefined;
  const prepared: PreparedRecord[] = [];
  for (const record of selected) {
    if (!sameFrame(record.frame, frame)) {
      unresolved = "provider-contract-invalid";
      continue;
    }
    const stamp = makeStamp(record, topology);
    prepared.push(
      Object.freeze({
        record,
        stamp,
        boundsDistance: distanceToBounds(point, record.topology[topology].bounds),
      }),
    );
  }
  const candidates = prepared.filter(({ boundsDistance }) => boundsDistance < minimumDistance);

  const witnesses: SpatialNearestWitness[] = [];
  for (const candidate of candidates) {
    if (!candidate.record.capabilities.includes("nearest-surface")) {
      if (unresolved !== "provider-contract-invalid") unresolved = "nearest-surface-unsupported";
      continue;
    }
    const reply = oracle.nearest(
      Object.freeze({
        record: candidate.record,
        topology,
        point,
        maximumDistance: searchDistance,
      }),
    );
    if (reply === undefined) {
      if (unresolved !== "provider-contract-invalid") unresolved = "nearest-surface-unsupported";
      continue;
    }
    if (
      typeof reply !== "object" ||
      reply === null ||
      (reply.kind !== "nearest" && reply.kind !== "no-hit" && reply.kind !== "unknown")
    ) {
      unresolved = "provider-contract-invalid";
      continue;
    }
    let consumed: SpatialRecordStamp;
    try {
      consumed = copyStamp(
        reply.kind === "nearest" ? reply.witness?.consumed : reply.consumed,
        "oracle.consumed",
      );
    } catch {
      unresolved = "provider-contract-invalid";
      continue;
    }
    if (!sameStamp(consumed, candidate.stamp)) {
      return result("stale", "oracle-stale", "none", topology, stamps, exclusions, witnesses);
    }
    if (reply.kind === "unknown") {
      if (typeof reply.reason !== "string" || reply.reason.length === 0)
        unresolved = "provider-contract-invalid";
      else unresolved ??= "oracle-unknown";
      continue;
    }
    if (reply.kind === "no-hit") continue;
    let witness: SpatialNearestWitness;
    try {
      const witnessPoint = finitePoint(reply.witness.point, "oracle.witness.point");
      const distance = reply.witness.distance;
      const actualDistance = pointDistance(point, witnessPoint);
      if (
        !Number.isFinite(distance) ||
        distance < 0 ||
        distance > searchDistance ||
        !Number.isFinite(actualDistance) ||
        actualDistance > searchDistance ||
        !sameDistance(distance, actualDistance) ||
        !pointIsInside(witnessPoint, candidate.record.topology[topology].bounds)
      )
        throw new RangeError();
      if (!sameFrame(copyFrame(reply.witness.frame, "oracle.witness.frame"), frame))
        throw new TypeError();
      witness = Object.freeze({
        triangleId: nonEmpty(reply.witness.triangleId, "oracle.witness.triangleId"),
        point: witnessPoint,
        distance: actualDistance,
        frame,
        consumed: candidate.stamp,
      });
    } catch {
      unresolved = "provider-contract-invalid";
      continue;
    }
    witnesses.push(witness);
  }
  const violation = witnesses.find((witness) => witness.distance < minimumDistance);
  if (violation)
    return result(
      "violated",
      "clearance-violated",
      "exact",
      topology,
      stamps,
      exclusions,
      witnesses,
    );
  if (unresolved === "provider-contract-invalid")
    return result(
      "unsupported",
      "provider-contract-invalid",
      "none",
      topology,
      stamps,
      exclusions,
      witnesses,
    );
  if (unresolved === "nearest-surface-unsupported")
    return result(
      "unsupported",
      "nearest-surface-unsupported",
      "none",
      topology,
      stamps,
      exclusions,
      witnesses,
    );
  if (unresolved === "oracle-unknown")
    return result("unknown", "oracle-unknown", "none", topology, stamps, exclusions, witnesses);
  return result(
    "satisfied",
    "clearance-satisfied",
    candidates.length > 0 && candidates.length === selected.length ? "exact" : "conservative",
    topology,
    stamps,
    exclusions,
    witnesses,
  );
}
