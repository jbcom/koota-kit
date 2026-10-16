import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorld,
  getStore,
  trait,
  universe,
  unpackEntity,
  type Entity,
  type World,
} from "koota";
import {
  bindCoordination,
  CoordinationBinding,
  CoordinationRegistration,
  type CompletedMetadata,
  type Coordination,
  type RegistrationToken,
} from "../src/coordination.js";

const worlds: World[] = [];
const CallerState = trait({ value: 0 });

function world(): World {
  const next = createWorld();
  worlds.push(next);
  return next;
}

function completed(geometry = 0, pose = 0, transform = 0): CompletedMetadata {
  return { revisions: { geometry, pose, transform } };
}

function register(
  coordinator: Coordination,
  entity: Entity,
  id = "figure:ava",
  capabilities: readonly string[] = ["presence"],
): RegistrationToken {
  return coordinator.register(entity, { id, capabilities });
}

afterEach(() => {
  for (const item of worlds.splice(0)) {
    if (item.isInitialized) item.destroy();
  }
});

describe("borrowed-world coordination", () => {
  it("retries disposal after its final marker write throws without removing a peer marker", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const peer = bindCoordination(callerWorld);
    const entity = callerWorld.spawn(CallerState({ value: 7 }));
    register(coordinator, entity);
    const before = coordinator.getSnapshot();
    const listener = vi.fn();
    coordinator.subscribe(listener);
    let throws = true;
    callerWorld.onChange(CoordinationBinding, () => {
      if (throws) {
        throws = false;
        throw new Error("final marker write failure");
      }
    });
    expect(() => coordinator.dispose()).toThrow(/final marker write failure/);
    expect(coordinator.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(callerWorld.get(CoordinationBinding)?.markers).toHaveLength(1);
    coordinator.dispose();
    coordinator.dispose();
    expect(coordinator.getSnapshot().entries).toEqual([]);
    expect(callerWorld.get(CoordinationBinding)?.markers).toHaveLength(1);
    const peerEntity = callerWorld.spawn();
    register(peer, peerEntity, "peer");
    expect(peer.getEntity("peer")).toBe(peerEntity);
    expect(entity.get(CallerState)).toEqual({ value: 7 });
    peer.dispose();
  });

  it("preserves a listener's committed snapshot when it removes marker ownership", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const entity = callerWorld.spawn();
    const token = register(coordinator, entity);
    const nextListener = vi.fn();
    coordinator.subscribe(() => callerWorld.remove(CoordinationBinding));
    coordinator.subscribe(nextListener);
    expect(() => coordinator.publish(token, completed(1))).toThrow(/World marker/);
    expect(nextListener).toHaveBeenCalledOnce();
    expect(coordinator.getSnapshot().entries[0]?.completed).toEqual(completed(1));
  });

  it("does not roll back a marker already removed by its rejecting add callback", () => {
    const callerWorld = world();
    callerWorld.onAdd(CoordinationBinding, () => {
      callerWorld.remove(CoordinationBinding);
      throw new Error("marker rejected after removal");
    });
    expect(() => bindCoordination(callerWorld)).toThrow(/marker rejected after removal/);
    expect(callerWorld.has(CoordinationBinding)).toBe(false);
  });

  it("does not remove caller state when a rejecting registration callback already cleaned its trait", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const entity = callerWorld.spawn(CallerState({ value: 7 }));
    const before = coordinator.getSnapshot();
    callerWorld.onAdd(CoordinationRegistration, () => {
      entity.remove(CoordinationRegistration);
      throw new Error("registration rejected after removal");
    });
    expect(() => register(coordinator, entity)).toThrow(/registration rejected after removal/);
    expect(coordinator.getSnapshot()).toBe(before);
    expect(entity.has(CoordinationRegistration)).toBe(false);
    expect(entity.get(CallerState)).toEqual({ value: 7 });
  });

  it("rejects a World outside the imported peer universe before writing markers", () => {
    const callerWorld = world();
    const original = universe.worlds[callerWorld.id];
    universe.worlds[callerWorld.id] = null;
    try {
      expect(() => bindCoordination(callerWorld)).toThrow(/dispatch realm/);
      expect(callerWorld.has(CoordinationBinding)).toBe(false);
    } finally {
      universe.worlds[callerWorld.id] = original ?? null;
    }
  });

  it("rejects an ambiguous marker holder and removes only the attempted marker", () => {
    const callerWorld = world();
    const entity = callerWorld.spawn();
    callerWorld.onAdd(CoordinationBinding, () => {
      entity.add(
        CoordinationBinding({ markers: callerWorld.get(CoordinationBinding)?.markers ?? [] }),
      );
    });
    expect(() => bindCoordination(callerWorld)).toThrow(/unique marker holder/);
    expect(callerWorld.has(CoordinationBinding)).toBe(false);
    expect(callerWorld.has(entity)).toBe(true);
  });

  it("retains committed metadata when the caller removes the binding marker", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const entity = callerWorld.spawn();
    register(coordinator, entity);
    const before = coordinator.getSnapshot();
    const markers = callerWorld.get(CoordinationBinding)?.markers ?? [];
    callerWorld.remove(CoordinationBinding);
    expect(() => coordinator.getEntity("figure:ava")).toThrow(/World marker/);
    expect(() => coordinator.prune()).toThrow(/World marker/);
    expect(() => coordinator.dispose()).toThrow(/World marker/);
    expect(coordinator.getSnapshot()).toBe(before);
    callerWorld.add(CoordinationBinding({ markers }));
    coordinator.dispose();
  });

  it("rejects divergence between the owned marker store and its direct World state", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const entity = callerWorld.spawn();
    register(coordinator, entity);
    const before = coordinator.getSnapshot();
    const store = getStore(callerWorld, CoordinationBinding);
    const markers = callerWorld.get(CoordinationBinding)?.markers ?? [];
    const holder = callerWorld.entities.find(
      (candidate) => store.markers[unpackEntity(candidate).entityId] === markers,
    ) as Entity;
    const holderId = unpackEntity(holder).entityId;
    const get = vi
      .spyOn(callerWorld, "get")
      .mockImplementation((trait) => (trait === CoordinationBinding ? { markers: [] } : undefined));
    expect(() => coordinator.getEntity("figure:ava")).toThrow(/cannot attest/);
    expect(coordinator.getSnapshot()).toBe(before);
    get.mockRestore();
    store.markers[holderId] = [];
    expect(() => coordinator.getEntity("figure:ava")).toThrow(/World marker/);
    store.markers[holderId] = markers;
    coordinator.dispose();
  });

  it("requires a live World and keeps disjoint bindings independent", () => {
    expect(() => bindCoordination(undefined as never)).toThrow(/live Koota World/);
    const callerWorld = world();
    const first = bindCoordination(callerWorld);
    const second = bindCoordination(callerWorld);
    const firstEntity = callerWorld.spawn();
    const secondEntity = callerWorld.spawn();
    register(first, firstEntity, "first");
    register(second, secondEntity, "second");
    expect(callerWorld.get(CoordinationBinding)?.markers).toHaveLength(2);
    second.dispose();
    expect(first.getEntity("first")).toBe(firstEntity);
    expect(callerWorld.get(CoordinationBinding)?.markers).toHaveLength(1);
    expect(() => register(first, callerWorld.spawn(), "third")).not.toThrow();
    first.dispose();
  });

  it("cleans an initial failed World-marker bind", () => {
    const callerWorld = world();
    callerWorld.onAdd(CoordinationBinding, () => {
      throw new Error("initial marker callback failure");
    });

    expect(() => bindCoordination(callerWorld)).toThrow(/initial marker callback failure/);
    expect(callerWorld.has(CoordinationBinding)).toBe(false);
  });

  it("cleans a failed World-marker bind without removing a peer binding", () => {
    const callerWorld = world();
    const peer = bindCoordination(callerWorld);
    let throws = true;
    callerWorld.onChange(CoordinationBinding, () => {
      if (throws) {
        throws = false;
        throw new Error("marker callback failure");
      }
    });

    expect(() => bindCoordination(callerWorld)).toThrow(/marker callback failure/);
    expect(callerWorld.get(CoordinationBinding)?.markers).toHaveLength(1);
    peer.dispose();
    expect(callerWorld.has(CoordinationBinding)).toBe(false);
  });

  it("registers existing entities in the caller World without touching caller traits", () => {
    const callerWorld = world();
    const first = callerWorld.spawn(CallerState({ value: 1 }));
    const second = callerWorld.spawn(CallerState({ value: 2 }));
    const unrelated = callerWorld.spawn(CallerState({ value: 3 }));
    const coordinator = bindCoordination(callerWorld);

    const firstToken = register(coordinator, first, "figure:zara", ["pose", "presence"]);
    register(coordinator, second, "figure:ava", ["geometry"]);

    callerWorld.query(CallerState).updateEach(([state]) => {
      state.value += 10;
    });
    expect(first.get(CallerState)?.value).toBe(11);
    expect(second.get(CallerState)?.value).toBe(12);
    expect(unrelated.get(CallerState)?.value).toBe(13);
    expect(unrelated.has(CoordinationRegistration)).toBe(false);
    expect(coordinator.world).toBe(callerWorld);
    expect(coordinator.getSnapshot()).toEqual({
      revision: 2,
      entries: [
        { id: "figure:ava", capabilities: ["geometry"], completed: undefined },
        { id: "figure:zara", capabilities: ["pose", "presence"], completed: undefined },
      ],
    });
    expect(Object.isFrozen(coordinator.getSnapshot())).toBe(true);
    expect(Object.isFrozen(coordinator.getSnapshot().entries)).toBe(true);
    expect(Object.isFrozen(coordinator.getSnapshot().entries[0])).toBe(true);
    expect(Object.isFrozen(coordinator.getSnapshot().entries[0]?.capabilities)).toBe(true);
    expect(coordinator.getEntity("figure:zara")).toBe(first);
    expect(coordinator.getEntity("missing")).toBeUndefined();
    expect(coordinator.getRegistration("missing")).toBeUndefined();

    coordinator.publish(firstToken, completed(1, 0, 0));
    expect(first.get(CoordinationRegistration)).toMatchObject({
      id: "figure:zara",
      geometryRevision: 1,
      poseRevision: 0,
      transformRevision: 0,
    });
  });

  it.each(["single hole", "mixed hole", "inherited slot", "inherited getter"])(
    "rejects capability arrays with a %s before any mutation",
    (kind) => {
      const capabilities = new Array<string>(kind === "mixed hole" ? 2 : 1);
      if (kind === "mixed hole") capabilities[1] = "pose";
      const inheritedRead = vi.fn(() => "geometry");
      if (kind === "inherited slot" || kind === "inherited getter") {
        const prototype = Object.create(Array.prototype);
        Object.defineProperty(
          prototype,
          "0",
          kind === "inherited slot" ? { value: "geometry" } : { get: inheritedRead },
        );
        Object.setPrototypeOf(capabilities, prototype);
      }
      // biome-ignore lint/suspicious/noPrototypeBuiltins: The supported TypeScript lib is ES2021.
      expect(Object.prototype.hasOwnProperty.call(capabilities, 0)).toBe(false);
      const callerWorld = world();
      const entity = callerWorld.spawn(CallerState({ value: 7 }));
      const coordinator = bindCoordination(callerWorld);
      const before = coordinator.getSnapshot();
      const markers = callerWorld.get(CoordinationBinding)?.markers;
      const listener = vi.fn();
      const onAdd = vi.fn();
      const onChange = vi.fn();
      coordinator.subscribe(listener);
      callerWorld.onAdd(CoordinationRegistration, onAdd);
      callerWorld.onChange(CoordinationBinding, onChange);

      expect(() => register(coordinator, entity, "retry", capabilities)).toThrow(TypeError);
      expect(inheritedRead).not.toHaveBeenCalled();
      expect(coordinator.getSnapshot()).toBe(before);
      expect(coordinator.getRegistration("retry")).toBeUndefined();
      expect(coordinator.getEntity("retry")).toBeUndefined();
      expect(callerWorld.get(CoordinationBinding)?.markers).toBe(markers);
      expect(callerWorld.isInitialized).toBe(true);
      expect(callerWorld.has(entity)).toBe(true);
      expect(entity.get(CallerState)?.value).toBe(7);
      expect(entity.has(CoordinationRegistration)).toBe(false);
      expect(listener).not.toHaveBeenCalled();
      expect(onAdd).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();

      register(coordinator, entity, "retry", []);
      expect(coordinator.getSnapshot()).toEqual({
        revision: 1,
        entries: [{ id: "retry", capabilities: [], completed: undefined }],
      });
      expect(entity.get(CoordinationRegistration)?.generation).toBe(1);
      expect(listener).toHaveBeenCalledTimes(1);
    },
  );

  it("copies dense capabilities into a sorted frozen detached array", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const capabilities = ["pose", "geometry"];
    register(coordinator, callerWorld.spawn(), "dense", capabilities);
    const copy = coordinator.getSnapshot().entries[0]?.capabilities;
    expect(copy).toEqual(["geometry", "pose"]);
    expect(copy).not.toBe(capabilities);
    expect(Object.isFrozen(copy)).toBe(true);
    expect(capabilities).toEqual(["pose", "geometry"]);
    capabilities[0] = "changed";
    expect(copy).toEqual(["geometry", "pose"]);
  });

  it("rejects invalid and conflicting registrations before visible mutation", () => {
    const callerWorld = world();
    const otherWorld = world();
    const entity = callerWorld.spawn();
    const other = otherWorld.spawn();
    const coordinator = bindCoordination(callerWorld);
    const before = coordinator.getSnapshot();

    for (const descriptor of [
      { id: " ", capabilities: [] },
      { id: "a", capabilities: "presence" },
      { id: "a", capabilities: [""] },
      { id: "a", capabilities: ["same", "same"] },
    ]) {
      expect(() => coordinator.register(entity, descriptor as never)).toThrow(/coordination:/);
      expect(coordinator.getSnapshot()).toBe(before);
      expect(entity.has(CoordinationRegistration)).toBe(false);
    }
    expect(() => register(coordinator, other, "other")).toThrow(/entity must be live/);
    const otherBinding = bindCoordination(callerWorld);

    const token = register(coordinator, entity, "one");
    expect(() => register(coordinator, entity, "two")).toThrow(/already carries/);
    expect(() => register(otherBinding, entity, "two")).toThrow(/already carries/);
    expect(() => register(coordinator, callerWorld.spawn(), "one")).toThrow(/already registered/);
    expect(() => coordinator.register(callerWorld.spawn(), null as never)).toThrow(
      /descriptor must be/,
    );
    expect(token).toBeDefined();

    const conflicting = callerWorld.spawn(
      CoordinationRegistration({
        marker: {},
        generation: 7,
        id: "foreign",
        geometryRevision: 0,
        poseRevision: 0,
        transformRevision: 0,
      }),
    );
    expect(() => register(coordinator, conflicting, "foreign")).toThrow(/already carries/);
    otherBinding.dispose();
    coordinator.dispose();
  });

  it("publishes a fully prepared batch, keeps snapshots immutable, and treats equal revisions as a no-op", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const a = register(coordinator, callerWorld.spawn(), "a", ["z", "a"]);
    const b = register(coordinator, callerWorld.spawn(), "b");
    const received: number[] = [];
    coordinator.subscribe((snapshot) => received.push(snapshot.revision));

    const published = coordinator.publishBatch([
      { token: b, completed: completed(0, 1, 0) },
      { token: a, completed: completed(1, 0, 0) },
    ]);
    expect(published.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(published.entries[0]?.capabilities).toEqual(["a", "z"]);
    expect(published.entries[0]?.completed).toEqual(completed(1, 0, 0));
    expect(Object.isFrozen(published.entries[0]?.completed)).toBe(true);
    expect(Object.isFrozen(published.entries[0]?.completed?.revisions)).toBe(true);
    expect(received).toEqual([3]);
    expect(coordinator.publish(a, completed(1, 0, 0))).toBe(published);
    expect(received).toEqual([3]);

    const before = coordinator.getSnapshot();
    expect(() =>
      coordinator.publishBatch([
        { token: a, completed: completed(2, 0, 0) },
        { token: a, completed: completed(3, 0, 0) },
      ]),
    ).toThrow(/duplicate/);
    expect(() => coordinator.publishBatch([{ token: a, completed: completed(0, 0, 0) }])).toThrow(
      /may not decrease/,
    );
    expect(() =>
      coordinator.publish(a, { revisions: { geometry: 1, pose: Number.NaN, transform: 0 } }),
    ).toThrow(/safe integer/);
    expect(() => coordinator.publish(a, { revisions: { geometry: 1, pose: 0 } } as never)).toThrow(
      /safe integer/,
    );
    expect(() => coordinator.publishBatch(null as never)).toThrow(/updates must be an array/);
    expect(() => coordinator.publishBatch([null as never])).toThrow(
      /each update must be an object/,
    );
    expect(() => coordinator.publish({} as RegistrationToken, completed())).toThrow(
      /does not belong/,
    );
    expect(() => coordinator.publish(a, null as never)).toThrow(/metadata must be an object/);
    expect(() => coordinator.publish(a, { revisions: null } as never)).toThrow(
      /revisions must be an object/,
    );
    expect(() => coordinator.publish(a, completed(1, -1, 0))).toThrow(/safe integer/);
    expect(() => coordinator.publish(a, completed(1, 0, Number.POSITIVE_INFINITY))).toThrow(
      /safe integer/,
    );
    expect(() => coordinator.publish(a, completed(1, 0, 1))).not.toThrow();
    const afterTransform = coordinator.getSnapshot();
    expect(() => coordinator.publish(a, completed(1, -1, 1))).toThrow(/safe integer/);
    expect(() => coordinator.publish(a, completed(1, 0, 0))).toThrow(/may not decrease/);
    expect(before).not.toBe(afterTransform);
    expect(coordinator.getSnapshot()).toBe(afterTransform);
    expect(received).toEqual([3, 4]);
  });

  it("keeps completed metadata atomic when Koota callbacks reject raw mirror writes", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const a = register(coordinator, callerWorld.spawn(), "a");
    const b = register(coordinator, callerWorld.spawn(), "b");
    const before = coordinator.getSnapshot();
    let changes = 0;
    callerWorld.onChange(CoordinationRegistration, () => {
      changes += 1;
      if (changes === 2) throw new Error("mirror callback failure");
    });

    expect(() =>
      coordinator.publishBatch([
        { token: a, completed: completed(1, 0, 0) },
        { token: b, completed: completed(0, 1, 0) },
      ]),
    ).toThrow(/mirror callback failure/);
    expect(coordinator.getSnapshot()).toBe(before);
    expect(coordinator.getSnapshot().entries.map((entry) => entry.completed)).toEqual([
      undefined,
      undefined,
    ]);

    coordinator.publish(b, completed(0, 0, 1));
    expect(coordinator.getSnapshot().entries).toEqual([
      { id: "a", capabilities: ["presence"], completed: undefined },
      { id: "b", capabilities: ["presence"], completed: completed(0, 0, 1) },
    ]);
  });

  it("cleans a failed registration trait so registration can retry", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const entity = callerWorld.spawn();
    let throws = true;
    callerWorld.onAdd(CoordinationRegistration, () => {
      if (throws) {
        throws = false;
        throw new Error("registration callback failure");
      }
    });

    expect(() => register(coordinator, entity, "a")).toThrow(/registration callback failure/);
    expect(entity.has(CoordinationRegistration)).toBe(false);
    expect(() => register(coordinator, entity, "a")).not.toThrow();
  });

  it("keeps listener delivery independent, ordered, and committed when listeners fail", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const token = register(coordinator, callerWorld.spawn(), "a");
    const deliveries: string[] = [];
    let unsubscribeSecond = () => {};
    const unsubscribeFirst = coordinator.subscribe((snapshot) => {
      deliveries.push(`first:${snapshot.revision}`);
      unsubscribeSecond();
      coordinator.subscribe((next) => deliveries.push(`third:${next.revision}`));
    });
    unsubscribeSecond = coordinator.subscribe((snapshot) =>
      deliveries.push(`second:${snapshot.revision}`),
    );
    coordinator.publish(token, completed(1, 0, 0));
    expect(deliveries).toEqual(["first:2", "second:2"]);
    coordinator.publish(token, completed(2, 0, 0));
    expect(deliveries).toEqual(["first:2", "second:2", "first:3", "third:3"]);
    unsubscribeFirst();

    coordinator.subscribe(() => {
      throw new Error("first listener");
    });
    coordinator.subscribe(() => {
      throw new Error("second listener");
    });
    expect(() => coordinator.publish(token, completed(3, 0, 0))).toThrow(/listener failures/);
    expect(coordinator.getSnapshot().entries[0]?.completed).toEqual(completed(3, 0, 0));

    const singleErrorWorld = world();
    const singleErrorCoordinator = bindCoordination(singleErrorWorld);
    singleErrorCoordinator.subscribe(() => {
      throw new Error("one listener");
    });
    expect(() => register(singleErrorCoordinator, singleErrorWorld.spawn(), "recoverable")).toThrow(
      /one listener/,
    );
    const recovered = singleErrorCoordinator.getRegistration("recoverable");
    expect(recovered).toBeDefined();
    expect(singleErrorCoordinator.getEntity("recoverable")).toBeDefined();
    expect(() => singleErrorCoordinator.unregister(recovered as RegistrationToken)).toThrow(
      /one listener/,
    );
  });

  it("rejects every lifecycle mutation during listener delivery while allowing deterministic subscription changes", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const token = register(coordinator, callerWorld.spawn(), "a");
    const events: string[] = [];
    coordinator.subscribe(() => {
      expect(() => register(coordinator, callerWorld.spawn(), "new")).toThrow(/while it notifies/);
      expect(() => coordinator.publish(token, completed(2, 0, 0))).toThrow(/while it notifies/);
      expect(() => coordinator.publishBatch([{ token, completed: completed(2, 0, 0) }])).toThrow(
        /while it notifies/,
      );
      expect(() => coordinator.unregister(token)).toThrow(/while it notifies/);
      expect(() => coordinator.prune()).toThrow(/while it notifies/);
      expect(() => coordinator.dispose()).toThrow(/while it notifies/);
      const unsubscribe = coordinator.subscribe(() => events.push("later"));
      unsubscribe();
      events.push("first");
    });
    coordinator.subscribe(() => events.push("second"));
    coordinator.publish(token, completed(1, 0, 0));
    expect(events).toEqual(["first", "second"]);
  });

  it("rejects Koota callback re-entry before a raw trait mutation can split the registry", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    callerWorld.onAdd(CoordinationRegistration, () => {
      expect(() => register(coordinator, callerWorld.spawn(), "reentrant")).toThrow(
        /while it notifies/,
      );
    });
    const token = register(coordinator, callerWorld.spawn(), "first");
    callerWorld.onChange(CoordinationRegistration, () => {
      expect(() => coordinator.unregister(token)).toThrow(/while it notifies/);
    });
    coordinator.publish(token, completed(1, 0, 0));
    callerWorld.onRemove(CoordinationRegistration, () => {
      expect(() => coordinator.prune()).toThrow(/while it notifies/);
    });
    coordinator.unregister(token);
  });

  it("refuses a counter overflow before it changes an owned trait or snapshot", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const token = register(coordinator, callerWorld.spawn(), "a");
    const original = Number.isSafeInteger;
    const spy = vi
      .spyOn(Number, "isSafeInteger")
      .mockImplementation((value) => value !== 2 && original(value));
    expect(() => coordinator.unregister(token)).toThrow(/snapshot revision exceeded/);
    spy.mockRestore();
    expect(coordinator.getSnapshot().entries).toHaveLength(1);
    coordinator.unregister(token);
  });

  it("requires current tokens, explicitly prunes stale registrations, and permits clean id reuse", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const original = callerWorld.spawn();
    const token = register(coordinator, original, "same");
    original.destroy();
    expect(callerWorld.has(original)).toBe(false);
    expect(coordinator.getEntity("same")).toBeUndefined();
    expect(() => coordinator.publish(token, completed(1, 0, 0))).toThrow(/stale/);
    expect(() => coordinator.unregister(token)).toThrow(/stale/);
    const beforePrune = coordinator.getSnapshot();
    const pruned = coordinator.prune();
    expect(pruned).not.toBe(beforePrune);
    expect(pruned.entries).toEqual([]);

    const replacement = callerWorld.spawn();
    const replacementToken = register(coordinator, replacement, "same");
    expect(replacementToken).not.toBe(token);
    expect(coordinator.getRegistration("same")).toBe(replacementToken);
    coordinator.unregister(replacementToken);
    expect(coordinator.getSnapshot().entries).toEqual([]);
    expect(coordinator.prune()).toBe(coordinator.getSnapshot());
  });

  it("prunes a destroyed borrowed World without destroying or resetting it itself", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    register(coordinator, callerWorld.spawn(), "a");
    callerWorld.destroy();
    expect(callerWorld.isInitialized).toBe(false);
    expect(coordinator.getEntity("a")).toBeUndefined();
    expect(coordinator.getRegistration("a")).toBeUndefined();
    expect(coordinator.prune().entries).toEqual([]);
    expect(() => coordinator.register(0 as Entity, { id: "b", capabilities: [] })).toThrow(
      /World marker/,
    );
    coordinator.dispose();
  });

  it("removes only its owned traits, is idempotent, and permits rebinding", () => {
    const callerWorld = world();
    const entity = callerWorld.spawn(CallerState({ value: 4 }));
    const coordinator = bindCoordination(callerWorld);
    const token = register(coordinator, entity, "a");
    const listener = coordinator.subscribe(() => {
      throw new Error("must not run after disposal");
    });
    listener();
    coordinator.dispose();
    coordinator.dispose();
    expect(callerWorld.isInitialized).toBe(true);
    expect(entity.has(CallerState)).toBe(true);
    expect(entity.get(CallerState)?.value).toBe(4);
    expect(entity.has(CoordinationRegistration)).toBe(false);
    expect(callerWorld.has(CoordinationBinding)).toBe(false);
    expect(coordinator.getSnapshot().entries).toEqual([]);
    expect(coordinator.getEntity("a")).toBeUndefined();
    expect(coordinator.getRegistration("a")).toBeUndefined();
    expect(() => coordinator.publish(token, completed())).toThrow(/disposed/);
    expect(() => coordinator.subscribe(() => {})).toThrow(/disposed/);
    expect(() => coordinator.subscribe(null as never)).toThrow(/disposed/);

    const rebound = bindCoordination(callerWorld);
    const reboundToken = register(rebound, entity, "a");
    rebound.unregister(reboundToken);
    rebound.dispose();
  });

  it("allows disposal to retry after raw cleanup fails", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const remove = vi.spyOn(callerWorld, "remove").mockImplementationOnce(() => {
      throw new Error("transient cleanup failure");
    });

    expect(() => coordinator.dispose()).toThrow(/transient cleanup failure/);
    expect(callerWorld.has(CoordinationBinding)).toBe(true);
    remove.mockRestore();

    coordinator.dispose();
    expect(callerWorld.has(CoordinationBinding)).toBe(false);
  });

  it("prunes an externally removed owned trait instead of assuming it is still current", () => {
    const callerWorld = world();
    const coordinator = bindCoordination(callerWorld);
    const entity = callerWorld.spawn();
    register(coordinator, entity, "a");
    entity.remove(CoordinationRegistration);
    expect(coordinator.prune().entries).toEqual([]);
  });

  it("rejects a non-function listener while a binding is active", () => {
    const coordinator = bindCoordination(world());
    expect(() => coordinator.subscribe(null as never)).toThrow(/listener must be a function/);
    coordinator.dispose();
  });

  it("never removes a replacement generation's trait during stale disposal", () => {
    const callerWorld = world();
    const original = callerWorld.spawn();
    const coordinator = bindCoordination(callerWorld);
    register(coordinator, original, "old");
    original.destroy();
    const replacement = callerWorld.spawn(
      CoordinationRegistration({
        marker: {},
        generation: 999,
        id: "replacement",
        geometryRevision: 9,
        poseRevision: 9,
        transformRevision: 9,
      }),
    );
    coordinator.dispose();
    expect(replacement.has(CoordinationRegistration)).toBe(true);
    expect(replacement.get(CoordinationRegistration)?.id).toBe("replacement");
  });
});
