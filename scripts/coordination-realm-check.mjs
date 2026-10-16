// Each scenario runs in a fresh installed-consumer process. Never restore or
// mock peer entity methods: the actual second peer import is the regression.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [format, scenario] = process.argv.slice(2);
const load = (name) => (format === "esm" ? import(name) : Promise.resolve(require(name)));
const opposite = (name) => (format === "esm" ? Promise.resolve(require(name)) : import(name));
let contaminatedMethods;
const contaminate = () => {
  const foreign = require(
    format === "esm" ? "koota" : require.resolve("koota").replace(/index\.cjs$/, "index.js"),
  );
  contaminatedMethods = methods();
  return foreign;
};
const peer = await load("koota");
const world = peer.createWorld();
const caller = peer.trait({ value: 7 });
const entity = world.spawn(caller);
if (scenario === "preimport") await opposite("koota");
const kit = await load("koota-kit/coordination");
const realmError = /coordination:.*(?:realm|dispatch)/;
const assertCaller = () => {
  assert.equal(peer.getStore(world, caller).value[peer.unpackEntity(entity).entityId], 7);
};
const methods = () => ["get", "has", "add", "set", "remove"].map((name) => Number.prototype[name]);
if (scenario === "preimport" || scenario === "marker-add") {
  if (scenario === "marker-add") world.onAdd(kit.CoordinationBinding, contaminate);
  assert.throws(() => kit.bindCoordination(world), realmError);
  assert.equal(world.has(kit.CoordinationBinding), false);
  assert.deepEqual([...world.query(caller)], [entity]);
} else if (scenario === "foreign") {
  const foreign = await opposite("koota");
  const foreignWorld = foreign.createWorld();
  assert.throws(() => kit.bindCoordination(foreignWorld), realmError);
  assert.equal(foreignWorld.has(kit.CoordinationBinding), false);
  assert.equal(world.has(kit.CoordinationBinding), false);
  foreignWorld.destroy();
} else {
  const binding = kit.bindCoordination(world);
  if (scenario === "marker-change") {
    const before = binding.getSnapshot();
    world.onChange(kit.CoordinationBinding, contaminate);
    assert.throws(() => kit.bindCoordination(world), realmError);
    assert.equal(world.get(kit.CoordinationBinding).markers.length, 1);
    assert.equal(binding.getSnapshot(), before);
  } else if (scenario === "register-add") {
    const before = binding.getSnapshot();
    let calls = 0;
    binding.subscribe(() => calls++);
    world.onAdd(kit.CoordinationRegistration, contaminate);
    assert.throws(() => binding.register(entity, { id: "owned", capabilities: [] }), realmError);
    assert.equal(binding.getSnapshot(), before);
    assert.equal(calls, 0);
    assert.equal(world.query(kit.CoordinationRegistration).length, 0);
  } else {
    const extra = world.spawn();
    const token = binding.register(entity, { id: "owned", capabilities: [] });
    const before = binding.getSnapshot();
    let calls = 0;
    binding.subscribe(() => calls++);
    if (scenario === "single" || scenario === "spatial" || scenario === "destroyed") {
      if (scenario === "spatial") await opposite("koota-kit/spatial");
      const otherWorld = peer.createWorld();
      const otherEntity = otherWorld.spawn(caller);
      binding.publish(token, { revisions: { geometry: 1, pose: 0, transform: 0 } });
      if (scenario === "destroyed") world.destroy();
      binding.dispose();
      binding.dispose();
      assert.equal(binding.getSnapshot().entries.length, 0);
      if (world.isInitialized) {
        assert.equal(world.query(kit.CoordinationRegistration).length, 0);
        assert.deepEqual([...world.query(caller)], [entity]);
      }
      assert.deepEqual(otherEntity.get(caller), { value: 7 });
      otherWorld.destroy();
    } else if (scenario === "subscriber" || scenario === "subscriber-silent") {
      let followingCalls = 0;
      let followingSnapshot;
      binding.subscribe(() => {
        contaminate();
        if (scenario === "subscriber") throw new Error("listener after commit");
      });
      binding.subscribe((snapshot) => {
        followingCalls++;
        followingSnapshot = snapshot;
      });
      assert.throws(
        () => binding.publish(token, { revisions: { geometry: 1, pose: 0, transform: 0 } }),
        scenario === "subscriber" ? /listener failures after commit/ : realmError,
      );
      assert.equal(binding.getSnapshot().entries[0].completed.revisions.geometry, 1);
      assert.equal(calls, 1);
      assert.equal(followingCalls, 1);
      assert.equal(followingSnapshot, binding.getSnapshot());
      assertCaller();
      assert.throws(() => binding.dispose(), realmError);
    } else if (scenario === "metadata-noop") {
      binding.publish(token, { revisions: { geometry: 0, pose: 0, transform: 0 } });
      const committed = binding.getSnapshot();
      assert.throws(
        () =>
          binding.publish(token, {
            get revisions() {
              contaminate();
              return { geometry: 0, pose: 0, transform: 0 };
            },
          }),
        realmError,
      );
      assert.equal(binding.getSnapshot(), committed);
      assert.equal(calls, 1);
    } else if (scenario.startsWith("callback-")) {
      const kind = scenario.slice("callback-".length);
      const secondEntity = world.spawn();
      const secondToken = binding.register(secondEntity, { id: "second", capabilities: [] });
      const callbackBefore = binding.getSnapshot();
      calls = 0;
      let operation;
      if (kind === "publish") {
        world.onChange(kit.CoordinationRegistration, contaminate);
        operation = () =>
          binding.publishBatch([
            { token, completed: { revisions: { geometry: 1, pose: 0, transform: 0 } } },
            {
              token: secondToken,
              completed: { revisions: { geometry: 1, pose: 0, transform: 0 } },
            },
          ]);
      } else if (kind === "marker-remove") {
        world.onRemove(kit.CoordinationBinding, contaminate);
        operation = () => binding.dispose();
      } else {
        world.onRemove(kit.CoordinationRegistration, contaminate);
        operation =
          kind === "unregister" ? () => binding.unregister(token) : () => binding.dispose();
      }
      assert.throws(operation, realmError);
      assert.equal(binding.getSnapshot(), callbackBefore);
      assert.equal(calls, 0);
      const secondState = peer.getStore(world, kit.CoordinationRegistration);
      assert.equal(secondState.geometryRevision[peer.unpackEntity(secondEntity).entityId], 0);
      assert.equal(
        world.query(kit.CoordinationRegistration).includes(secondEntity),
        kind !== "marker-remove",
      );
      assertCaller();
      const currentMethods = methods();
      assert.throws(() => binding.dispose(), realmError);
      assert.deepEqual(methods(), currentMethods);
      assert.deepEqual([...world.query(caller)], [entity]);
    } else {
      const foreign = await opposite("koota");
      const foreignWorld = scenario === "alias" ? foreign.createWorld() : undefined;
      const foreignTrait = foreign.trait({ value: 99 });
      const foreignEntity = foreignWorld?.spawn(foreignTrait);
      if (foreignEntity !== undefined)
        assert.equal(foreignEntity, entity, "fixture must alias the numeric entity");
      const currentMethods = methods();
      // Cleanup first: the old implementation falsely succeeded in the alias case.
      for (const operation of [
        () => binding.dispose(),
        () => binding.publish(token, { revisions: { geometry: 1, pose: 0, transform: 0 } }),
        () => binding.getEntity("owned"),
        () => binding.getRegistration("owned"),
        () => binding.prune(),
        () => binding.unregister(token),
        () => binding.register(extra, { id: "late", capabilities: [] }),
      ]) {
        assert.throws(operation, realmError);
        assert.equal(binding.getSnapshot(), before);
        assert.equal(calls, 0);
        assert.deepEqual([...world.query(kit.CoordinationRegistration)], [entity]);
        assert.equal(world.get(kit.CoordinationBinding).markers.length, 1);
        assert.deepEqual([...world.query(caller)], [entity]);
        assertCaller();
        assert.deepEqual(methods(), currentMethods);
        if (foreignWorld) {
          assert.deepEqual(foreignEntity.get(foreignTrait), { value: 99 });
          assert.equal(foreignWorld.query(kit.CoordinationRegistration).length, 0);
        }
      }
      foreignWorld?.destroy();
    }
  }
}
if (contaminatedMethods) assert.deepEqual(methods(), contaminatedMethods);
if (world.isInitialized) {
  assertCaller();
  world.destroy();
}
console.log(`${format} ${scenario}: passed`);
