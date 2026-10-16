import { createRequire } from "node:module";
import { createWorld, trait } from "koota";
import { expect, it } from "vitest";
import { bindCoordination, CoordinationBinding } from "../src/coordination.js";

// Vitest isolates test files. This case deliberately leaves the actual peer's
// opposite-format global dispatch in place; no prototype mocks or restoration.
it("attests existing owned marker state when opposite peer dispatch predates the first bind", () => {
  const world = createWorld();
  const caller = trait({ value: 7 });
  const entity = world.spawn(caller);
  createRequire(import.meta.url)("koota");
  expect(() => bindCoordination(world)).toThrow(/cannot attest/);
  expect(world.has(CoordinationBinding)).toBe(false);
  expect([...world.query(caller)]).toEqual([entity]);
  world.destroy();
});
