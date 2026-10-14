import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { createWorld } from "koota";
import { bindCoordination } from "../src/coordination";

const coreModule = "../examples/coordination-proof/cohort-core.mjs";
const nodeModule = "../examples/coordination-proof/cohort.mjs";
const { hashValues, createProofCohort } = await import(coreModule);
const { hashBytes } = await import(nodeModule);
function original(...values: unknown[]) {
  const hash = createHash("sha256");
  for (const value of values)
    hash.update(
      ArrayBuffer.isView(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : (JSON.stringify(value) as string),
    );
  return hash.digest("hex");
}
it("retains the immutable original hash protocol including offsets, native typed bytes and Unicode", () => {
  const storage = new Uint8Array([99, 1, 2, 3, 98]);
  for (const values of [
    [],
    ["héllo 🫧", { z: 1, a: 2 }],
    [storage.subarray(1, 4), new Uint16Array([0x1234, 0xabcd])],
    [new DataView(storage.buffer, 2, 2), null, [true, 1]],
    ["a", "bc"],
    ["ab", "c"],
  ]) {
    expect(hashValues(hashBytes, ...values)).toBe(original(...values));
  }
  expect(hashValues(hashBytes, "a", "bc")).not.toBe(hashValues(hashBytes, "bc", "a"));
});
it("rejects JSON without bytes before invoking the primitive", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const value of [undefined, () => 1, Symbol("bad"), cyclic, 1n]) {
    let calls = 0;
    expect(() =>
      hashValues(() => {
        calls += 1;
        return "0".repeat(64);
      }, value),
    ).toThrow();
    expect(calls).toBe(0);
  }
});
it("requires a synchronous SHA256 hex primitive", () => {
  expect(() => createProofCohort({}, [])).toThrow(/hashBytes/);
  for (const result of [Promise.resolve("0".repeat(64)), undefined, "bad", "A".repeat(64)])
    expect(() => hashValues(() => result)).toThrow(/synchronous/);
});
it("browser relative import graph contains no Node built-ins or Node-only wrappers", () => {
  const seen = new Set<string>();
  function inspect(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/node:|\bBuffer\b|jsdom|fixture\.mjs|react-observer\.mjs/);
    for (const match of source.matchAll(/from ["'](\.[^"']+)["']/g))
      inspect(resolve(dirname(file), match[1] as string));
  }
  inspect(resolve("examples/coordination-proof/browser-cohort.mjs"));
  inspect(resolve("examples/coordination-proof/browser-observer.mjs"));
  expect(seen.size).toBe(6);
});

it("rejects asynchronous/invalid hashing before publishing any completed tuple", () => {
  for (const result of [Promise.resolve("0".repeat(64)), "invalid"]) {
    const world = createWorld();
    const entity = world.spawn();
    const coordination = bindCoordination(world);
    const cohort = createProofCohort(
      coordination,
      [{ id: "a", entity, sourceId: "source", instanceId: "instance", providerGeneration: 1 }],
      { hashBytes: () => result },
    );
    const before = coordination.getSnapshot();
    try {
      expect(() =>
        cohort.publish([
          {
            id: "a",
            revisions: { geometry: 0, topology: 0, pose: 0, transform: 0 },
            toWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            parts: [],
          },
        ]),
      ).toThrow(/synchronous/);
      expect(coordination.getSnapshot()).toBe(before);
      expect(cohort.getSnapshot().valid).toBe(false);
    } finally {
      cohort.dispose();
      coordination.dispose();
      world.destroy();
    }
  }
});

it("snapshots earlier typed bytes before a later JSON serializer can mutate them", () => {
  function values() {
    const storage = new Uint8Array([99, 1, 98]);
    const view = storage.subarray(1, 2);
    return [
      view,
      {
        toJSON() {
          view[0] = 2;
          return { ok: true };
        },
      },
    ];
  }
  expect(hashValues(hashBytes, ...values())).toBe(original(...values()));
});
