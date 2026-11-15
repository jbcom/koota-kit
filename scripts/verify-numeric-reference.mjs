// Independent release diagnostic: Python standard-library Decimal at 110 digits.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  deterministicAcos,
  deterministicCubeRoot,
  deterministicSafeIntegerCubeRoot,
  deterministicSinCos,
} from "../src/numeric.ts";

const source = `
import json
from decimal import Decimal, getcontext
getcontext().prec = 110
pi = Decimal('3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865')
def trig(x, sine):
    term = x if sine else Decimal(1)
    total = term
    order = 1
    while abs(term) > Decimal('1e-105'):
        term *= -x*x / Decimal((2*order)*(2*order+1) if sine else (2*order)*(2*order-1))
        total += term
        order += 1
    return total

def acos(x):
    if x == 1: return Decimal(0)
    low, high = Decimal(0), pi / 2
    for _ in range(360):
        middle = (low+high)/2
        if trig(middle, False) > x: low = middle
        else: high = middle
    return (low+high)/2

angles = [.6, -3.141592653589793 / 2, -3.141592653589793, 3.141592653589793]
values = [0., .5, 1. - 2.**-53, 1. - 2.**-52, 1.]
print(json.dumps({
    'sinCos': [[a, str(trig(Decimal.from_float(a), True)), str(trig(Decimal.from_float(a), False))] for a in angles],
    'acos': [[v, str(acos(Decimal.from_float(v)))] for v in values],
    'cubeRoot': [[v, str(Decimal(v) ** (Decimal(1)/3))] for v in [15000, 4294967295, 15000000000, 9007199254740991]],
    'firstOmittedCosineTerm': str(pi**48 / Decimal(12413915592536072670862289047373375038521486354677760000000000))
}))
`;
const reference = JSON.parse(
  execFileSync("python3", ["-c", source], { encoding: "utf8", timeout: 30000 }),
);
for (const [angle, sin, cos] of reference.sinCos) {
  const result = deterministicSinCos(angle);
  assert(Math.abs(result.sin - Number(sin)) <= 1e-14);
  assert(Math.abs(result.cos - Number(cos)) <= 1e-14);
  if (angle === -Math.PI / 2) assert(Math.abs(result.cos - Number(cos)) < 1e-22);
}
for (const [value, radians] of reference.acos) {
  const result = deterministicAcos(value);
  assert(Math.abs(result - Number(radians)) <= 1e-10);
  console.log(
    JSON.stringify({
      inverseInput: value,
      result,
      reference: radians,
      error: result - Number(radians),
    }),
  );
}
for (const [value, root] of reference.cubeRoot) {
  const result = deterministicSafeIntegerCubeRoot(value);
  assert(Math.abs(result - Number(root)) <= 3e-11);
  if (value <= 4294967295) assert.equal(result, deterministicCubeRoot(value));
  console.log(
    JSON.stringify({ cubeInput: value, result, reference: root, error: result - Number(root) }),
  );
}
console.log(JSON.stringify(reference));
