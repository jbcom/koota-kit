import { createWorld } from "koota";
import { expect, it } from "vitest";
import { bindCoordination } from "../src/coordination";

const observerModule = "../examples/coordination-proof/react-observer.mjs";
const cohortModule = "../examples/coordination-proof/cohort.mjs";
const { observeCommittedUpdate } = await import(observerModule);
const { createProofCohort } = await import(cohortModule);
const registryImport = (specifier: string) => import(specifier);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const update = (pose: number) => ({
  id: "same-world",
  revisions: { geometry: 0, topology: 0, pose, transform: 0 },
  toWorld: identity,
  parts: [
    {
      id: "surface",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      full: new Uint32Array([0, 1, 2]),
      visible: new Uint32Array([0, 1, 2]),
      fullTopologyId: "full",
      visibleTopologyId: "visible",
    },
  ],
});

it("mounted React observes a committed version in the same World and unsubscribes on unmount", async () => {
  const world = createWorld();
  const entity = world.spawn();
  const coordination = bindCoordination(world);
  let subscribers = 0;
  const observedBinding = {
    ...coordination,
    subscribe(listener: Parameters<typeof coordination.subscribe>[0]) {
      subscribers += 1;
      const stop = coordination.subscribe(listener);
      return () => {
        subscribers -= 1;
        stop();
      };
    },
  };
  const cohort = createProofCohort(observedBinding, [
    { id: "same-world", entity, sourceId: "source", instanceId: "instance", providerGeneration: 1 },
  ]);
  cohort.publish([update(0)]);
  try {
    const result = await observeCommittedUpdate({
      registryImport,
      cohort,
      world,
      publish: () => cohort.publish([update(1)]),
    });
    expect(result.before).toBe("same-world:0");
    expect(result.after).toBe("same-world:1");
    expect(result.sameWorld).toBe(true);
    expect(result.unmountPreservedWorld).toBe(true);
    expect(subscribers).toBe(0);
    expect(world.has(entity)).toBe(true);
  } finally {
    cohort.dispose();
    coordination.dispose();
    world.destroy();
  }
});
