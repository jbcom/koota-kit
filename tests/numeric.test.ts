import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DETERMINISTIC_NUMERIC,
  deterministicAcos,
  deterministicCubeRoot,
  deterministicSinCos,
} from "../src/numeric.js";

const { sinCosAbsoluteError, acosAbsoluteError, cubeRootAbsoluteError } = DETERMINISTIC_NUMERIC;

describe("deterministic numeric revision 1", () => {
  it("freezes its revision and conservative error contract", () => {
    expect(Object.isFrozen(DETERMINISTIC_NUMERIC)).toBe(true);
    expect(DETERMINISTIC_NUMERIC).toEqual({
      revision: 1,
      sinCosAbsoluteError: 1e-14,
      acosAbsoluteError: 1e-10,
      cubeRootAbsoluteError: 1e-12,
      maximumCubeRootInput: 4294967295,
    });
  });

  it("retains frozen golden outputs across supported engines", () => {
    expect(deterministicSinCos(0)).toEqual({ sin: 0, cos: 1 });
    expect(deterministicSinCos(-0)).toEqual({ sin: 0, cos: 1 });
    expect(deterministicSinCos(0.6)).toEqual({ sin: 0.5646424733950354, cos: 0.8253356149096783 });
    expect(deterministicSinCos(-Math.PI / 2)).toEqual({ sin: -1, cos: 6.123234014771656e-17 });
    expect(deterministicAcos(1)).toBe(0);
    expect(deterministicAcos(0)).toBe(1.5707963267948966);
    expect(deterministicAcos(0.5)).toBe(1.0471975511965979);
    expect(deterministicCubeRoot(15000)).toBe(24.6621207433047);
    expect(deterministicCubeRoot(4294967295)).toBe(1625.498677089281);
  });

  it("agrees with independent 110-digit Decimal endpoint references", () => {
    // Reproduce with scripts/verify-numeric-reference.mjs; these are mathematical
    // references, separate from revision 1's frozen implementation outputs.
    expect(
      Math.abs(
        deterministicSinCos(-Math.PI / 2).cos -
          Number("6.12323399573676588613032966137500146464e-17"),
      ),
    ).toBeLessThan(1e-22);
    expect(deterministicAcos(1 - Number.EPSILON / 2)).toBe(
      Number("1.49011611938476563878634354255046159224e-8"),
    );
    expect(deterministicAcos(1 - Number.EPSILON)).toBe(
      Number("2.10734242554470162834211642882121161991e-8"),
    );
    expect(deterministicCubeRoot(4294967295)).toBe(
      Number("1625.498677089280961044427737529291711206"),
    );
  });

  it("bounds rotation errors over the admitted interval and tiny inputs", () => {
    const angles = [-Math.PI, Math.PI, -Number.MIN_VALUE, Number.MIN_VALUE, -1e-12, 1e-12];
    for (let step = 0; step <= 256; step += 1) angles.push(-Math.PI + (2 * Math.PI * step) / 256);
    for (const angle of angles) {
      const result = deterministicSinCos(angle);
      expect(Math.abs(result.sin - Math.sin(angle))).toBeLessThanOrEqual(sinCosAbsoluteError);
      expect(Math.abs(result.cos - Math.cos(angle))).toBeLessThanOrEqual(sinCosAbsoluteError);
      expect(Math.abs(result.sin * result.sin + result.cos * result.cos - 1)).toBeLessThan(1e-14);
    }
  });

  it("bounds inverse errors including the ill-conditioned endpoint", () => {
    const inputs = [0, -0, 1, Number.MIN_VALUE, 1e-12, 1 - Number.EPSILON / 2, 1 - Number.EPSILON];
    for (let step = 0; step <= 256; step += 1) inputs.push(step / 256);
    for (const value of inputs) {
      expect(Math.abs(deterministicAcos(value) - Math.acos(value))).toBeLessThanOrEqual(
        acosAbsoluteError,
      );
    }
  });

  it("bounds cube-root errors for integer counts and upper-domain neighbours", () => {
    for (let value = 0; value <= 15000; value += 1) {
      expect(Math.abs(deterministicCubeRoot(value) - Math.cbrt(value))).toBeLessThanOrEqual(
        cubeRootAbsoluteError,
      );
    }
    for (const value of [1625 ** 3 - 1, 1625 ** 3, 1625 ** 3 + 1, 4294967294, 4294967295]) {
      expect(Math.abs(deterministicCubeRoot(value) - Math.cbrt(value))).toBeLessThanOrEqual(
        cubeRootAbsoluteError,
      );
    }
    expect(deterministicCubeRoot(-0)).toBe(0);
    for (const root of [0, 1, 2, 3, 100, 1625]) expect(deterministicCubeRoot(root ** 3)).toBe(root);
  });

  it("rejects non-finite, fractional and out-of-domain inputs", () => {
    for (const value of [NaN, Infinity, -Infinity, -Math.PI - 1e-12, Math.PI + 1e-12]) {
      expect(() => deterministicSinCos(value)).toThrow(RangeError);
    }
    for (const value of [NaN, Infinity, -Infinity, -Number.MIN_VALUE, 1 + Number.EPSILON]) {
      expect(() => deterministicAcos(value)).toThrow(RangeError);
    }
    for (const value of [NaN, Infinity, -Infinity, -1, 0.1, 4294967296]) {
      expect(() => deterministicCubeRoot(value)).toThrow(RangeError);
    }
  });

  it("runs independently of host transcendental implementations", () => {
    const forbidden = ["sin", "cos", "acos", "cbrt", "pow", "sqrt", "random"] as const;
    const spies = forbidden.map((name) =>
      vi.spyOn(Math, name).mockImplementation(() => {
        throw new Error(`host ${name} is unavailable`);
      }),
    );
    try {
      expect(deterministicSinCos(0.6).sin).toBe(0.5646424733950354);
      expect(deterministicAcos(0.5)).toBe(1.0471975511965979);
      expect(deterministicCubeRoot(27)).toBe(3);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const source = readFileSync(new URL("../src/numeric.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Math\.(?:sin|cos|acos|cbrt|pow|sqrt|random)\s*\(/);
  });
});
