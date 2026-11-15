import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DETERMINISTIC_NUMERIC,
  SAFE_INTEGER_CUBE_ROOT,
  deterministicSafeIntegerCubeRoot,
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

describe("safe-integer cube-root revision 1", () => {
  it("keeps an independent frozen contract without changing uint32 admission", () => {
    expect(Object.isFrozen(SAFE_INTEGER_CUBE_ROOT)).toBe(true);
    expect(SAFE_INTEGER_CUBE_ROOT).toEqual({
      revision: 1,
      maximumInput: Number.MAX_SAFE_INTEGER,
      absoluteError: 3e-11,
    });
    expect(DETERMINISTIC_NUMERIC.maximumCubeRootInput).toBe(4294967295);
    expect(DETERMINISTIC_NUMERIC.cubeRootAbsoluteError).toBe(1e-12);
    expect(() => deterministicCubeRoot(4294967296)).toThrow(RangeError);
  });

  it("preserves uint32 output bits and its tighter error bound", () => {
    for (const value of [0, -0, 1, 27, 15000, 4294967294, 4294967295]) {
      expect(deterministicSafeIntegerCubeRoot(value)).toBe(deterministicCubeRoot(value));
    }
  });

  it("bounds aggregate counts, perfect-cube neighbours and safe-integer limits", () => {
    const inputs = [0, -0, 15000000000, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER];
    for (const root of [1626, 2466, 10000, 100000, 208063]) {
      const cube = root ** 3;
      inputs.push(cube - 1, cube, cube + 1);
      expect(deterministicSafeIntegerCubeRoot(cube)).toBe(root);
    }
    for (const value of inputs) {
      expect(
        Math.abs(deterministicSafeIntegerCubeRoot(value) - Math.cbrt(value)),
      ).toBeLessThanOrEqual(SAFE_INTEGER_CUBE_ROOT.absoluteError);
    }
    expect(deterministicSafeIntegerCubeRoot(-0)).toBe(0);
  });

  it("agrees with independent 110-digit Decimal references for large counts", () => {
    expect(deterministicSafeIntegerCubeRoot(15000000000)).toBe(
      Number(
        "2466.2120743304701014916113231545890427354844866280537601787874102933769529228974632162987026643460500624578141",
      ),
    );
    expect(deterministicSafeIntegerCubeRoot(Number.MAX_SAFE_INTEGER)).toBe(
      Number(
        "208063.83068357583385474704766349895263260667868032600305792311189744578600142391716146909608795863496592824872",
      ),
    );
  });

  it("rejects unsafe integers, fractions and non-finite counts", () => {
    for (const value of [-1, 0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => deterministicSafeIntegerCubeRoot(value)).toThrow(RangeError);
    }
  });

  it("does not call a host cube root", () => {
    const spy = vi.spyOn(Math, "cbrt").mockImplementation(() => {
      throw new Error("host cube root unavailable");
    });
    try {
      expect(deterministicSafeIntegerCubeRoot(1000000000000)).toBe(10000);
    } finally {
      spy.mockRestore();
    }
  });
});
