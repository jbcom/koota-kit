import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorld, trait, type Entity, type World } from "koota";
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
