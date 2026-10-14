import { assertMesh, sourceFaceIds } from "./mesh-input.mjs";
import {
  indexedBounds,
  nearestOpenSurface,
  NumericalOracleRangeError,
  worldPositions,
} from "./open-surface.mjs";

export const PROOF_FRAME = Object.freeze({
  id: "caller-proof-world",
  unit: "metre",
  metric: "euclidean",
});
const freeze = Object.freeze;
const tuple = (r) => JSON.stringify([r.geometry, r.pose, r.transform]);
const stampKey = (r, s) =>
  JSON.stringify([
    r.identity.sourceId,
    r.identity.instanceId,
    r.identity.partId,
    r.identity.registration.id,
    r.identity.registration.generation,
    [r.frame.id, r.frame.unit, r.frame.metric],
    s,
    r.topology[s].id,
    [r.revisions.geometry, r.revisions.topology, r.revisions.pose, r.revisions.transform],
  ]);
/** Preserve the Node reference protocol: ordered exact views and unchanged JSON UTF-8. */
export function hashValues(hashBytes, ...values) {
  if (typeof hashBytes !== "function") throw new TypeError("proof: synchronous hashBytes required");
  const encoder = new TextEncoder();
  const chunks = values.map((value) => {
    if (ArrayBuffer.isView(value))
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError("proof: value has no JSON serialization");
    return encoder.encode(json);
  });
  const digest = hashBytes(chunks);
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest))
    throw new TypeError("proof: hashBytes must return synchronous lowercase SHA256 hex");
  return digest;
}
function sameIndexBytes(left, right) {
  if (left.length !== right.length || left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** Test-only caller resource ledger; coordination snapshots are the sole commit boundary. */
export function createProofCohort(coordination, specifications, { hashBytes } = {}) {
  if (typeof hashBytes !== "function") throw new TypeError("proof: synchronous hashBytes required");
  const hashArrays = (...values) => hashValues(hashBytes, ...values);
  const models = new Map(),
    views = new WeakMap();
  let busy = false,
    disposalStarted = false;
  function current(m) {
    return (
      coordination.getRegistration(m.id) === m.token && coordination.getEntity(m.id) === m.entity
    );
  }
  function selectedVersion(m, s) {
    const e = s.entries.find((e) => e.id === m.id);
    return e?.completed ? m.versions.get(tuple(e.completed.revisions)) : undefined;
  }
  function collect() {
    if (busy) return;
    const s = coordination.getSnapshot();
    for (const m of models.values()) {
      const active = current(m) ? selectedVersion(m, s) : undefined;
      for (const [id, v] of m.versions) if (v !== active && v.leases === 0) m.versions.delete(id);
    }
  }
  function view(s) {
    function invalid() {
      const cached = views.get(s);
      if (cached?.valid === false) return cached;
      const result = freeze({ coordination: s, records: freeze([]), valid: false });
      views.set(s, result);
      return result;
    }
    if ([...models.values()].some((m) => !m.removed && !current(m))) return invalid();
    // Cached metadata does not lease buffers; verify retained versions before using it.
    if (
      [...models.values()].some(
        (m) =>
          !m.removed &&
          (!s.entries.find((entry) => entry.id === m.id)?.completed || !selectedVersion(m, s)),
      )
    )
      return invalid();
    const cached = views.get(s);
    if (cached?.valid === true) return cached;
    const records = [];
    for (const m of models.values()) {
      if (m.removed) continue;
      const v = selectedVersion(m, s);
      if (s.entries.find((entry) => entry.id === m.id)?.completed && !v) {
        return invalid();
      }
      if (v) records.push(...v.parts.map((p) => p.record));
    }
    records.sort(
      (a, b) =>
        Number(stampKey(a, "full") > stampKey(b, "full")) -
        Number(stampKey(a, "full") < stampKey(b, "full")),
    );
    const result = freeze({ coordination: s, records: freeze(records), valid: true });
    views.set(s, result);
    return result;
  }
  function prepare(m, u) {
    if (!current(m)) throw new Error("proof: stale owned registration lifetime");
    const revisions = freeze({ ...u.revisions }),
      previous = selectedVersion(m, coordination.getSnapshot());
    for (const epoch of ["geometry", "topology", "pose", "transform"]) {
      if (
        !Number.isSafeInteger(revisions[epoch]) ||
        revisions[epoch] < 0 ||
        (previous && revisions[epoch] < previous.revisions[epoch])
      )
        throw new Error(`proof: invalid or regressing ${epoch} epoch`);
    }
    if (
      previous &&
      revisions.topology !== previous.revisions.topology &&
      revisions.geometry === previous.revisions.geometry
    )
      throw new Error("proof: topology replacement must advance geometry epoch");
    const frame = freeze({ ...(u.frame ?? m.frame ?? PROOF_FRAME) });
    if (
      typeof frame.id !== "string" ||
      frame.id.length === 0 ||
      typeof frame.unit !== "string" ||
      frame.unit.length === 0 ||
      frame.metric !== "euclidean"
    )
      throw new Error("proof: invalid declared frame");
    const partIds = new Set();
    const parts = u.parts.map((p) => {
      if (!p.id || partIds.has(p.id) || !p.fullTopologyId || !p.visibleTopologyId)
        throw new Error("proof: invalid or duplicate part/topology identity");
      partIds.add(p.id);
      assertMesh(p.positions, p.full, p.positions.length / 3);
      assertMesh(p.positions, p.visible, p.positions.length / 3);
      const full = new Uint32Array(p.full),
        visible = new Uint32Array(p.visible),
        sourcePositions = new Float32Array(p.positions);
      assertMesh(sourcePositions, full, sourcePositions.length / 3);
      assertMesh(sourcePositions, visible, sourcePositions.length / 3);
      const previousPart = previous?.parts.find((part) => part.record.identity.partId === p.id);
      // Reuse only a committed same-lifetime part after validating fresh copies.
      const canReuse =
        previousPart &&
        previous.revisions.topology === revisions.topology &&
        previousPart.record.identity.sourceId === m.sourceId &&
        previousPart.record.identity.instanceId === m.instanceId &&
        previousPart.record.identity.registration.generation === m.providerGeneration &&
        previousPart.record.topology.full.id === p.fullTopologyId &&
        previousPart.record.topology.visible.id === p.visibleTopologyId &&
        sameIndexBytes(previousPart.full, full) &&
        sameIndexBytes(previousPart.visible, visible);
      const visibleFaces = canReuse ? previousPart.visibleFaces : sourceFaceIds(full, visible),
        positions = worldPositions(sourcePositions, u.toWorld);
      const identity = freeze({
        sourceId: m.sourceId,
        instanceId: m.instanceId,
        partId: p.id,
        registration: freeze({ id: m.id, generation: m.providerGeneration }),
      });
      const record = freeze({
        identity,
        frame,
        revisions,
        topology: freeze({
          full: freeze({
            id: p.fullTopologyId,
            bounds: indexedBounds(positions, full),
            enclosesSurface: true,
          }),
          visible: freeze({
            id: p.visibleTopologyId,
            bounds: indexedBounds(positions, visible),
            enclosesSurface: true,
          }),
        }),
        capabilities: freeze(p.nearestSurface === false ? [] : ["nearest-surface"]),
      });
      return {
        record,
        sourcePositions,
        positions,
        full,
        visible,
        visibleFaces,
        provenance: p.provenance ?? null,
      };
    });
    const topologyHash = hashArrays(
      ...parts.flatMap((p) => [
        p.record.identity,
        p.record.topology.full.id,
        p.record.topology.visible.id,
        p.full,
        p.visible,
      ]),
    );
    if (
      previous &&
      previous.topologyHash !== topologyHash &&
      revisions.geometry === previous.revisions.geometry
    )
      throw new Error("proof: topology bytes/identity replacement must advance geometry epoch");
    const fingerprint = hashArrays(
      revisions,
      [...u.toWorld],
      ...parts.flatMap((p) => [p.record, p.provenance, p.sourcePositions, p.full, p.visible]),
    );
    const existing = m.versions.get(tuple(revisions));
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error("proof: changed content under the same completed tuple");
      return existing;
    }
    return { revisions, parts, topologyHash, fingerprint, leases: 0 };
  }
  const specificationIds = new Set();
  for (const specification of specifications) {
    for (const field of ["id", "sourceId", "instanceId"])
      if (typeof specification[field] !== "string" || specification[field].length === 0)
        throw new Error("proof: invalid model identity");
    if (
      !Number.isSafeInteger(specification.providerGeneration) ||
      specification.providerGeneration < 0
    )
      throw new Error("proof: invalid provider generation");
    if (specificationIds.has(specification.id)) throw new Error("proof: duplicate model identity");
    if (coordination.getRegistration(specification.id))
      throw new Error("proof: pre-existing caller registration");
    specificationIds.add(specification.id);
  }
  for (const specification of specifications) {
    if (models.has(specification.id)) throw new Error("proof: duplicate model identity");
    const m = { ...specification, token: undefined, versions: new Map(), removed: false };
    models.set(m.id, m);
    const previousToken = coordination.getRegistration(m.id);
    try {
      m.token = coordination.register(m.entity, { id: m.id, capabilities: ["open-surface"] });
    } catch (error) {
      if (
        coordination.getEntity(m.id) === m.entity &&
        coordination.getRegistration(m.id) !== previousToken
      )
        m.token = coordination.getRegistration(m.id);
      const errors = [error];
      for (const owned of models.values())
        if (owned.token && coordination.getRegistration(owned.id) === owned.token) {
          try {
            coordination.unregister(owned.token);
          } catch (e) {
            errors.push(e);
          }
        }
      throw new AggregateError(
        errors,
        "proof: construction failed; owned token recovery attempted",
      );
    }
  }
  function publish(updates) {
    if (busy) throw new Error("proof: publication/disposal reentry");
    if (disposalStarted) throw new Error("proof: disposed cohort");
    busy = true;
    try {
      const seen = new Set();
      const prepared = updates.map((u) => {
        const m = models.get(u.id);
        if (!m || seen.has(u.id)) throw new Error("proof: unknown or duplicate model update");
        seen.add(u.id);
        return { m, v: prepare(m, u) };
      });
      // Native trait callbacks select OLD; committed subscribers select NEW, from this same ledger.
      for (const { m, v } of prepared) m.versions.set(tuple(v.revisions), v);
      coordination.publishBatch(
        prepared.map(({ m, v }) => ({
          token: m.token,
          completed: {
            revisions: {
              geometry: v.revisions.geometry,
              pose: v.revisions.pose,
              transform: v.revisions.transform,
            },
          },
        })),
      );
      return view(coordination.getSnapshot());
    } finally {
      busy = false;
      collect();
    }
  }
  function capture(snapshot = coordination.getSnapshot()) {
    if (disposalStarted) throw new Error("proof: disposed cohort cannot acquire fresh captures");
    const selected = view(snapshot),
      versions = [],
      partsByStamp = new Map(),
      diagnostics = [];
    if (selected.valid)
      for (const m of models.values()) {
        if (m.removed) continue;
        const v = selectedVersion(m, snapshot);
        if (!v) continue;
        v.leases += 1;
        versions.push(v);
        for (const p of v.parts)
          for (const s of ["full", "visible"]) partsByStamp.set(stampKey(p.record, s), p);
      }
    let released = false;
    const assertLease = () => {
      if (released) throw new Error("proof: released capture");
    };
    return freeze({
      snapshot: selected,
      provider: freeze({
        snapshot() {
          assertLease();
          return selected.valid ? selected.records : [freeze({})];
        },
      }),
      oracle: freeze({
        nearest({ record, topology, point, maximumDistance }) {
          assertLease();
          const p = partsByStamp.get(stampKey(record, topology));
          if (!p) return undefined;
          const consumed = freeze({
            identity: record.identity,
            frame: record.frame,
            topology: freeze({ selection: topology, id: record.topology[topology].id }),
            revisions: record.revisions,
          });
          let hit;
          try {
            hit = nearestOpenSurface(
              p.positions,
              p[topology],
              point,
              topology === "visible" ? p.visibleFaces : undefined,
            );
          } catch (error) {
            if (error instanceof NumericalOracleRangeError)
              return freeze({ kind: "unknown", reason: "numerical-oracle-range", consumed });
            throw error;
          }
          if (!hit || hit.distance > maximumDistance) return freeze({ kind: "no-hit", consumed });
          diagnostics.push(freeze({ identity: record.identity, ...hit, consumed }));
          return freeze({
            kind: "nearest",
            witness: freeze({
              triangleId: `${record.identity.partId}/full-face/${hit.face}`,
              point: hit.point,
              distance: hit.distance,
              frame: record.frame,
              consumed,
            }),
          });
        },
      }),
      getDiagnostics: () => freeze([...diagnostics]),
      release() {
        if (released) return;
        released = true;
        for (const v of versions) v.leases -= 1;
        partsByStamp.clear();
        collect();
      },
    });
  }
  function dispose() {
    if (busy) throw new Error("proof: publication/disposal reentry");
    busy = true;
    disposalStarted = true;
    const errors = [];
    try {
      for (const m of models.values()) {
        if (m.removed) continue;
        if (coordination.getRegistration(m.id) !== m.token) {
          m.removed = true;
          continue;
        }
        try {
          coordination.unregister(m.token);
        } catch (e) {
          errors.push(e);
        }
        m.removed = coordination.getRegistration(m.id) !== m.token;
      }
    } finally {
      busy = false;
      collect();
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        "proof: disposal errors; failed owned cleanup remains retryable",
      );
  }
  return freeze({
    publish,
    capture,
    dispose,
    getSnapshot: () => view(coordination.getSnapshot()),
    subscribe: (listener) => coordination.subscribe(() => listener()),
  });
}
