# Walker exact-conversion performance

The exact boundary solver preserves IEEE-754 input coordinates through rational
comparisons. Repeated conversion of the same endpoints and slab boundaries used
to allocate an eight-byte buffer and view for every operand. Query-owned scratch
and a memo capped at 256 immutable bigint results remove repeated decoding while
preserving the exact comparisons. A full memo still decodes new values exactly.

On Linux x64, Node 26.11.1, 400 measured straight-path queries after 30 warm-ups
across 24 connected supports and 24 off-path solids produced:

| Metric | Released 0.13.0 | Optimized | Change |
| --- | --- | --- | --- |
| P50 query | 4.744 ms | 1.585 ms | 2.99 times faster |
| P95 query | 7.115 ms | 2.449 ms | 2.90 times faster |
| Total measured query time | 1,946.7 ms | 672.9 ms | 65.4% lower |
| User CPU, 400 queries | 2,167.0 ms | 680.3 ms | 68.6% lower |

These are comparative measurements on one host, not a universal latency promise.
The benchmark reports net heap change without forced collection; that is not an
allocation count or a peak memory measurement. Run `pnpm build`, then
`node scripts/bench/walker.mjs` on a supported Node version to reproduce the workload.

The frozen `tests/fixtures/walker-v0.13.0-goldens.json` was captured against source
commit `b6e29e1` before optimization. Forty-eight worlds cover signed and large
coordinates, touching supports, narrow gaps and thin solids. The regression test
required every path, advance and segment result to remain equal in 0.13.1.
Separate checks exercise memo saturation, nested queries and changed mutable
worlds. That release passed 273 tests at 100% coverage.

The subsequent support-boundary correction preserves the frozen corpus file and
continues to require identical straight paths and occlusion segments. Axis
movement is now checked against an independent analytic oracle for its two
coplanar rectangles: stop at a real gap, then permit tangential sliding. Six old
large-coordinate outputs had incorrectly crossed a one-ULP gap. Those are
intentional correctness changes, not performance-test exceptions or widened
tolerances. Additional regressions require literal outer-edge coordinates for
both axes, the captured decimal displacement, and safe subnormal movement. The
279-test suite retains 100% statement, branch, function and line coverage.
