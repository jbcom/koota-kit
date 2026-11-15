/** Bounded, replay-stable scalar kernels. No host transcendental functions. */
const SCALE = 1n << 80n;
const SCALE_NUMBER = Number(SCALE);
const SCALE_SQUARED = SCALE * SCALE;
// floor(pi / 2 * 2^80), from the mathematical constant, not host libm.
const HALF_PI = 1898976236818169290393996n;
const PI_BOUND = Math.PI;

/** Frozen revision and conservative absolute errors over the admitted domains. */
export const DETERMINISTIC_NUMERIC = Object.freeze({
  revision: 1,
  sinCosAbsoluteError: 1e-14,
  acosAbsoluteError: 1e-10,
  cubeRootAbsoluteError: 1e-12,
  maximumCubeRootInput: 4294967295,
} as const);

/** Dimensionless sine and cosine of an angle in radians. */
export interface DeterministicSinCos {
  readonly sin: number;
  readonly cos: number;
}

function fixed(value: number): bigint {
  return BigInt(Math.trunc(value * SCALE_NUMBER));
}

function cosine(angle: bigint): bigint {
  const square = angle * angle;
  let term = SCALE;
  let sum = term;
  for (let order = 1n; order < 24n; order += 1n) {
    term = (-term * square) / (SCALE_SQUARED * (2n * order) * (2n * order - 1n));
    sum += term;
  }
  return sum;
}

function sine(angle: bigint): bigint {
  const square = angle * angle;
  let term = angle;
  let sum = term;
  for (let order = 1n; order < 24n; order += 1n) {
    term = (-term * square) / (SCALE_SQUARED * (2n * order) * (2n * order + 1n));
    sum += term;
  }
  return sum;
}

/**
 * Admit finite radians in [-pi, pi]; reject rather than perform lossy wrapping.
 * Zero, including negative zero, produces canonical positive zero.
 */
export function deterministicSinCos(radians: number): DeterministicSinCos {
  if (!Number.isFinite(radians) || radians < -PI_BOUND || radians > PI_BOUND) {
    throw new RangeError("radians must be finite and within [-pi, pi]");
  }
  const angle = fixed(radians);
  return { sin: Number(sine(angle)) / SCALE_NUMBER, cos: Number(cosine(angle)) / SCALE_NUMBER };
}

/** Return acos(value) in radians for finite value in [0, 1]. */
export function deterministicAcos(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("acos input must be finite and within [0, 1]");
  }
  if (value === 1) return 0;
  const target = fixed(value);
  let low = 0n;
  let high = HALF_PI;
  while (low < high) {
    const middle = (low + high) / 2n;
    if (cosine(middle) > target) low = middle + 1n;
    else high = middle;
  }
  return Number(low) / SCALE_NUMBER;
}

/**
 * Return the real cube root of an integer count in [0, 2^32 - 1].
 * Fractional counts, negative values, non-finite values and overflow reject.
 */
export function deterministicCubeRoot(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > DETERMINISTIC_NUMERIC.maximumCubeRootInput) {
    throw new RangeError("cube-root input must be an integer within [0, 2^32 - 1]");
  }
  const target = BigInt(value) * SCALE * SCALE_SQUARED;
  let low = 0n;
  let high = 1626n * SCALE;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (middle * middle * middle <= target) low = middle;
    else high = middle - 1n;
  }
  return Number(low) / SCALE_NUMBER;
}
