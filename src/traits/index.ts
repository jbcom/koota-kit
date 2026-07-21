/**
 * `src/traits/` — trait-authoring conventions, kept in a LEAF sub-package.
 *
 * Packaging pattern (from medieval-hexagon-gameboard): trait declarations
 * live in a leaf sub-package with ZERO sibling imports — this file imports
 * only `koota` (the npm dep) and pure types, never runtime values from
 * sibling modules like ./world or ./rng. That is what prevents the
 * koota ↔ world-facade ↔ game-scenario top-level evaluation cycle that a
 * flat layout only dodges accidentally. Games adopting this package should
 * follow the same rule: declare traits in their own leaf module, exported
 * from exactly one location so trait reference-identity holds regardless of
 * which subpath a consumer imports from.
 *
 * The AoS-aliasing footgun this module guards against (timber-town's
 * documented convention): object-valued fields in a SoA schema must use the
 * AoS-factory pattern (`() => ({...})`) so each entity gets its own object
 * instance — koota's SoA pattern would otherwise alias state across
 * entities (one shared object literal mutated by every entity that has the
 * trait).
 *
 * @module
 */

import type { Norm, Schema, Trait } from "koota";
import { trait } from "koota";

/**
 * Compile-time guard: any object-valued field in a SoA schema must be an
 * AoS factory (`() => ({...})`), never a bare object literal. Fields that
 * are functions, primitives, null, or undefined pass through unchanged;
 * bare object/array literals map to `never`, producing a type error at the
 * call site.
 */
export type SafeSchema<S> = S extends (...args: never[]) => unknown
  ? S
  : {
      [K in keyof S]: S[K] extends (...args: never[]) => unknown
        ? S[K]
        : S[K] extends object
          ? never
          : S[K];
    };

/**
 * Thin wrapper over koota's `trait()` that enforces the AoS-factory
 * convention for object-valued fields, at both type level (see SafeSchema)
 * and runtime (throws with an explanation instead of silently aliasing).
 *
 * Accepted forms:
 *   defineTrait({ count: 0, label: "x" })            // SoA, primitives
 *   defineTrait({ pos: () => ({ x: 0, y: 0 }) })     // SoA, per-field factory
 *   defineTrait(() => ({ pos: { x: 0, y: 0 } }))     // whole-trait AoS factory
 *
 * Rejected (the footgun):
 *   defineTrait({ pos: { x: 0, y: 0 } })             // shared literal → aliased
 */
export function defineTrait<S extends Schema>(schema: S & SafeSchema<S>): Trait<Norm<S>> {
  if (typeof schema !== "function") {
    for (const [key, value] of Object.entries(schema)) {
      if (value !== null && typeof value === "object") {
        throw new TypeError(
          `defineTrait: field "${key}" is a bare object literal. koota's SoA layout ` +
            `would share this single instance across every entity holding the trait ` +
            `(state aliasing). Use an AoS factory instead: ${key}: () => ({...}).`,
        );
      }
    }
  }
  return trait(schema);
}
