/**
 * Borrowed-World coordination for completed model metadata.
 *
 * The caller owns the Koota World and its entities. This module only adds its
 * own marker traits and exposes a committed, immutable projection. It does
 * not create a World, run systems, serialize entities, or read geometry.
 */
import { trait, type Entity, type World } from "koota";

type BindingMarker = object;

type RegistrationState = {
  readonly marker: BindingMarker;
  readonly generation: number;
  readonly id: string;
  readonly geometryRevision: number;
  readonly poseRevision: number;
  readonly transformRevision: number;
};

/**
 * World-held ownership markers for live bindings. Each binding appends one
 * opaque marker and removes only that marker at disposal, so no module-global
 * registry or per-bind Koota trait allocation is needed.
 */
export const CoordinationBinding = trait({ markers: () => [] as BindingMarker[] });

/**
 * The only trait this module places on caller-owned model entities. Its
 * fields are a diagnostic mirror of the binding's committed projection;
 * callers must use `getSnapshot` for an immutable completed view.
 */
export const CoordinationRegistration = trait({
  marker: () => ({}) as BindingMarker,
  generation: 0,
  id: "",
  geometryRevision: 0,
  poseRevision: 0,
  transformRevision: 0,
});

declare const registrationTokenBrand: unique symbol;

/** An opaque capability token returned only by `Coordination.register`. */
export type RegistrationToken = {
  readonly [registrationTokenBrand]: never;
};

export type CompletedRevisions = Readonly<{
  geometry: number;
  pose: number;
  transform: number;
}>;

export type CompletedMetadata = Readonly<{
  revisions: CompletedRevisions;
}>;

export type CoordinationDescriptor = Readonly<{
  /** A non-empty caller-authored identity, never a packed Koota entity ID. */
  id: string;
  /** Stable, sorted capability labels. Change them by unregistering first. */
  capabilities: readonly string[];
}>;

export type CoordinationEntry = Readonly<{
  id: string;
  capabilities: readonly string[];
  /** Undefined until the producer has explicitly published completed facts. */
  completed: CompletedMetadata | undefined;
}>;

export type CoordinationSnapshot = Readonly<{
  /** A binding-local publication generation, not a producer content revision. */
  revision: number;
  /** Entries sorted lexically by stable caller-authored id. */
  entries: readonly CoordinationEntry[];
}>;

export type CoordinationUpdate = Readonly<{
  token: RegistrationToken;
  completed: CompletedMetadata;
}>;

export type CoordinationListener = (snapshot: CoordinationSnapshot) => void;

export type Coordination = Readonly<{
  readonly world: World;
  register: (entity: Entity, descriptor: CoordinationDescriptor) => RegistrationToken;
  publish: (token: RegistrationToken, completed: CompletedMetadata) => CoordinationSnapshot;
  publishBatch: (updates: readonly CoordinationUpdate[]) => CoordinationSnapshot;
  unregister: (token: RegistrationToken) => CoordinationSnapshot;
  /** Remove registrations whose entity or owned trait is no longer current. */
  prune: () => CoordinationSnapshot;
  /** Recover a current token after a listener threw during registration. */
  getRegistration: (id: string) => RegistrationToken | undefined;
  /** Resolve a stable identity only while its registered entity remains live. */
  getEntity: (id: string) => Entity | undefined;
  getSnapshot: () => CoordinationSnapshot;
  subscribe: (listener: CoordinationListener) => () => void;
  /** Idempotently remove this module's traits; never destroys the borrowed World. */
  dispose: () => void;
}>;

type Registration = {
  readonly entity: Entity;
  readonly token: RegistrationToken;
  readonly state: RegistrationState;
  readonly id: string;
  readonly capabilities: readonly string[];
  completed: CompletedMetadata | undefined;
};

const tokenMarker = Symbol("koota-kit.coordination.token");

type RuntimeToken = RegistrationToken & {
  readonly [tokenMarker]: BindingMarker;
};

function fail(message: string): never {
  throw new Error(`coordination: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`coordination: ${name} must be a non-empty string.`);
  }
  return value;
}

function copyCapabilities(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(
      "coordination: descriptor.capabilities must be an array of non-empty strings.",
    );
  }
  const capabilities = value.map((capability) => requireNonEmptyString(capability, "capability"));
  capabilities.sort();
  for (let index = 1; index < capabilities.length; index += 1) {
    if (capabilities[index] === capabilities[index - 1]) {
      throw new TypeError(`coordination: duplicate capability "${capabilities[index]}".`);
    }
  }
  return Object.freeze(capabilities);
}

function copyRevisions(value: unknown): CompletedRevisions {
  if (!isObject(value)) {
    throw new TypeError("coordination: completed.revisions must be an object.");
  }
  const names = ["geometry", "pose", "transform"] as const;
  const values = names.map((name) => value[name]);
  for (const [index, revision] of values.entries()) {
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
      throw new RangeError(
        `coordination: completed.revisions.${names[index]} must be a non-negative safe integer.`,
      );
    }
  }
  return Object.freeze({
    geometry: values[0] as number,
    pose: values[1] as number,
    transform: values[2] as number,
  });
}

function copyCompleted(value: unknown): CompletedMetadata {
  if (!isObject(value)) {
    throw new TypeError("coordination: completed metadata must be an object.");
  }
  return Object.freeze({ revisions: copyRevisions(value.revisions) });
}

function sameRevisions(left: CompletedRevisions, right: CompletedRevisions): boolean {
  return (
    left.geometry === right.geometry &&
    left.pose === right.pose &&
    left.transform === right.transform
  );
}

function assertNoRegression(
  previous: CompletedMetadata | undefined,
  next: CompletedMetadata,
): void {
  if (!previous) return;
  for (const name of ["geometry", "pose", "transform"] as const) {
    if (next.revisions[name] < previous.revisions[name]) {
      throw new RangeError(`coordination: completed revision ${name} may not decrease.`);
    }
  }
}

function makeSnapshot(
  revision: number,
  registrations: Iterable<Registration>,
): CoordinationSnapshot {
  const entries = [...registrations]
    .map(
      (registration): CoordinationEntry =>
        Object.freeze({
          id: registration.id,
          capabilities: registration.capabilities,
          completed: registration.completed,
        }),
    )
    .sort((left, right) => Number(left.id > right.id) - Number(left.id < right.id));
  return Object.freeze({ revision, entries: Object.freeze(entries) });
}

function stateIsOwned(
  state: RegistrationState | undefined,
  marker: BindingMarker,
  generation: number,
): boolean {
  return state?.marker === marker && state.generation === generation;
}

/**
 * Bind to a caller-owned Koota World. A live binding writes its opaque marker
 * onto that same World, without a hidden module-global World registry. Several
 * bindings may coexist only while they register disjoint caller entities.
 */
export function bindCoordination(world: World): Coordination {
  if (!world?.isInitialized) {
    fail("a live Koota World is required.");
  }

  const marker = Object.freeze({});
  const existingMarkers = world.get(CoordinationBinding)?.markers ?? [];
  const markers = [...existingMarkers, marker];
  if (world.has(CoordinationBinding)) world.set(CoordinationBinding, { markers });
  else world.add(CoordinationBinding({ markers }));

  let disposed = false;
  let notifying = false;
  let mutating = false;
  let nextRegistrationGeneration = 0;
  let nextSnapshotRevision = 0;
  const registrationsById = new Map<string, Registration>();
  const registrationsByToken = new Map<RegistrationToken, Registration>();
  const listeners = new Set<CoordinationListener>();
  let snapshot = makeSnapshot(nextSnapshotRevision, registrationsById.values());

  const assertActive = (): void => {
    if (disposed) fail("the binding has been disposed.");
    if (notifying || mutating)
      fail("mutating a binding while it notifies listeners is not allowed.");
  };

  const assertMutable = (): void => {
    assertActive();
    if (!world.isInitialized || !world.get(CoordinationBinding)?.markers.includes(marker)) {
      fail("the binding no longer owns its World marker.");
    }
  };

  const isCurrent = (registration: Registration): boolean => {
    if (!world.isInitialized || !world.has(registration.entity)) return false;
    return stateIsOwned(
      registration.entity.get(CoordinationRegistration) as RegistrationState | undefined,
      marker,
      registration.state.generation,
    );
  };

  const registrationFor = (token: RegistrationToken): Registration => {
    const registration = registrationsByToken.get(token);
    if (!registration || (token as RuntimeToken)[tokenMarker] !== marker) {
      fail("the registration token does not belong to this binding.");
    }
    if (!isCurrent(registration)) {
      fail("the registration token is stale; call prune before re-registering its id.");
    }
    return registration;
  };

  const notify = (): void => {
    const deliveries = [...listeners];
    const errors: unknown[] = [];
    notifying = true;
    try {
      for (const listener of deliveries) {
        try {
          listener(snapshot);
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      notifying = false;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      const error = Object.assign(new Error("coordination: listener failures after commit."), {
        errors: Object.freeze(errors),
      });
      throw error;
    }
  };

  const nextCounter = (value: number, name: string): number => {
    const next = value + 1;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError(`coordination: ${name} exceeded the safe integer range.`);
    }
    return next;
  };

  const commit = (revision: number): CoordinationSnapshot => {
    nextSnapshotRevision = revision;
    snapshot = makeSnapshot(revision, registrationsById.values());
    notify();
    return snapshot;
  };

  const register = (entity: Entity, descriptor: CoordinationDescriptor): RegistrationToken => {
    assertMutable();
    if (!world.has(entity)) fail("entity must be live in this binding's World.");
    if (!isObject(descriptor)) throw new TypeError("coordination: descriptor must be an object.");
    const id = requireNonEmptyString(descriptor.id, "descriptor.id");
    const capabilities = copyCapabilities(descriptor.capabilities);
    if (registrationsById.has(id)) fail(`stable id "${id}" is already registered.`);
    if (entity.has(CoordinationRegistration)) {
      fail("entity already carries a coordination registration trait.");
    }

    const registrationGeneration = nextCounter(
      nextRegistrationGeneration,
      "registration generation",
    );
    const snapshotRevision = nextCounter(nextSnapshotRevision, "snapshot revision");
    const state: RegistrationState = Object.freeze({
      marker,
      generation: registrationGeneration,
      id,
      geometryRevision: 0,
      poseRevision: 0,
      transformRevision: 0,
    });
    const token = Object.freeze({ [tokenMarker]: marker }) as RuntimeToken;
    const registration: Registration = {
      entity,
      token,
      state,
      id,
      capabilities,
      completed: undefined,
    };
    // Every validation above happens before the Koota marker or this binding's
    // projection changes. Koota callbacks can observe this raw trait; they are
    // deliberately outside the atomic committed-snapshot contract.
    mutating = true;
    try {
      entity.add(CoordinationRegistration(state));
      nextRegistrationGeneration = registrationGeneration;
      registrationsById.set(id, registration);
      registrationsByToken.set(token, registration);
      commit(snapshotRevision);
    } finally {
      mutating = false;
    }
    return token;
  };

  const publishBatch = (updates: readonly CoordinationUpdate[]): CoordinationSnapshot => {
    assertMutable();
    if (!Array.isArray(updates)) {
      throw new TypeError("coordination: publishBatch updates must be an array.");
    }
    const prepared: Array<{ registration: Registration; completed: CompletedMetadata }> = [];
    const seen = new Set<RegistrationToken>();
    for (const update of updates) {
      if (!isObject(update)) throw new TypeError("coordination: each update must be an object.");
      const candidate = update as CoordinationUpdate;
      if (seen.has(candidate.token)) fail("publishBatch contains a duplicate registration token.");
      seen.add(candidate.token);
      const registration = registrationFor(candidate.token);
      const completed = copyCompleted(candidate.completed);
      assertNoRegression(registration.completed, completed);
      prepared.push({ registration, completed });
    }
    const changed = prepared.some(
      ({ registration, completed }) =>
        !registration.completed ||
        !sameRevisions(registration.completed.revisions, completed.revisions),
    );
    if (!changed) return snapshot;
    const snapshotRevision = nextCounter(nextSnapshotRevision, "snapshot revision");

    // Preparation completed for every update. Mirror the new revisions onto
    // owned traits before replacing the observer projection as one commit.
    mutating = true;
    try {
      for (const { registration, completed } of prepared) {
        const state: RegistrationState = Object.freeze({
          ...registration.state,
          geometryRevision: completed.revisions.geometry,
          poseRevision: completed.revisions.pose,
          transformRevision: completed.revisions.transform,
        });
        registration.entity.set(CoordinationRegistration, state);
        registration.completed = completed;
      }
      return commit(snapshotRevision);
    } finally {
      mutating = false;
    }
  };

  const unregister = (token: RegistrationToken): CoordinationSnapshot => {
    assertMutable();
    const registration = registrationFor(token);
    const snapshotRevision = nextCounter(nextSnapshotRevision, "snapshot revision");
    mutating = true;
    try {
      registration.entity.remove(CoordinationRegistration);
      registrationsById.delete(registration.id);
      registrationsByToken.delete(token);
      return commit(snapshotRevision);
    } finally {
      mutating = false;
    }
  };

  const prune = (): CoordinationSnapshot => {
    assertActive();
    const stale = [...registrationsById.values()].filter(
      (registration) => !isCurrent(registration),
    );
    if (stale.length === 0) return snapshot;
    const snapshotRevision = nextCounter(nextSnapshotRevision, "snapshot revision");
    mutating = true;
    try {
      for (const registration of stale) {
        registrationsById.delete(registration.id);
        registrationsByToken.delete(registration.token);
      }
      return commit(snapshotRevision);
    } finally {
      mutating = false;
    }
  };

  const getEntity = (id: string): Entity | undefined => {
    const registration = registrationsById.get(id);
    return registration && isCurrent(registration) ? registration.entity : undefined;
  };

  const getRegistration = (id: string): RegistrationToken | undefined => {
    const registration = registrationsById.get(id);
    return registration && isCurrent(registration) ? registration.token : undefined;
  };

  const getSnapshot = (): CoordinationSnapshot => snapshot;

  const subscribe = (listener: CoordinationListener): (() => void) => {
    if (disposed) fail("the binding has been disposed.");
    if (typeof listener !== "function")
      throw new TypeError("coordination: listener must be a function.");
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const dispose = (): void => {
    if (disposed) return;
    assertActive();
    const snapshotRevision = nextCounter(nextSnapshotRevision, "snapshot revision");
    mutating = true;
    try {
      listeners.clear();
      for (const registration of registrationsById.values()) {
        if (isCurrent(registration)) registration.entity.remove(CoordinationRegistration);
      }
      registrationsById.clear();
      registrationsByToken.clear();
      const markerState = world.get(CoordinationBinding);
      if (world.isInitialized && markerState?.markers.includes(marker)) {
        const remaining = markerState.markers.filter((candidate) => candidate !== marker);
        if (remaining.length === 0) world.remove(CoordinationBinding);
        else world.set(CoordinationBinding, { markers: remaining });
      }
      nextSnapshotRevision = snapshotRevision;
      snapshot = makeSnapshot(nextSnapshotRevision, []);
      disposed = true;
    } finally {
      mutating = false;
    }
  };

  return Object.freeze({
    world,
    register,
    publish: (token, completed) => publishBatch([{ token, completed }]),
    publishBatch,
    unregister,
    prune,
    getRegistration,
    getEntity,
    getSnapshot,
    subscribe,
    dispose,
  });
}
