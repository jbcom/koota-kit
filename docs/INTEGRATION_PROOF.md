# Caller composition proof

This proof composes existing entities in one caller-owned Koota World. It is an
application example and a bounded test oracle, not another runtime adapter or
geometry backend. The package root gains no model, renderer, AI or geometry
dependency.

## Inputs and execution

`examples/coordination-proof/consumer-package.json` declares every optional
package used by the independent registry consumer. Copy it into a private
directory outside this workspace, copy `registry-import.mjs` beside its
`package.json`, install it with `npm install --ignore-scripts --bin-links=false`,
and retain the resulting package lock. The runner resolves all package imports
from that directory. It never imports this checkout's library source or build.
The pinned Koota Kit version must include both the coordination and spatial
exports; coordination alone is insufficient.

Supply an authorized copied figure fixture directory containing `fixture.json`
and the arrays named by its manifest. The loader reads only the rest positions,
rest normals, full and visible indices, and both poses' positions and normals.
It checks every byte length and SHA256, decodes little-endian values explicitly,
checks triangle ranges, and maps visible triangles to their full source face IDs.
Posed positions already contain their single ground lift; the proof applies no
additional lift or pose evaluation.

The preparation command needs no optional package:

```sh
node examples/coordination-proof/prepare.mjs "$FIXTURE_DIRECTORY" "$RECEIPT_FILE"
```

The registry composition command uses the independent installed consumer:

```sh
node examples/coordination-proof/run.mjs \
  "$FIXTURE_DIRECTORY" "$CONSUMER_DIRECTORY" "$RECEIPT_FILE"
```

Run these bounded array/query checks through the project's authorized remote
run facility. Use canonical absolute input paths and a regular-file-only
consumer install. Declare exactly the copied fixture inputs and private consumer
inputs, preserve their hashes, and return the receipt directory. Keep logs
outside returned directories so artifact replacement cannot overwrite them.

## Ownership and observation

Model A uses the published Strata terrain API's portable indexed heightfield.
Its anchor is explicitly authored by the caller on a generated vertex; the proof
does not claim an unexported Strata mesh or anchor API. Model B uses actual copied
figure and garment arrays, with full body triangles preserved even when hidden
by visible outfit masking. These inputs certify open surfaces only.

Both existing entities retain caller Position, Velocity, Intent and ModelKind
traits. The caller writes positions, pulls them through Yuka's existing
`AIBridge.syncFromKoota`, writes an intent stamped with the consumed surface
epochs, runs its behavior, then uses `syncToKoota` to write velocity. The bridge
does not become a second position writer. React's existing `WorldProvider`
observes that exact raw World, and `useSyncExternalStore` observes the immutable
view selected by the same committed coordination snapshot.

The caller's resource ledger prepares copied immutable geometry versions before
`publishBatch`. A committed coordination snapshot selects one version for every
model using its owned registration lifetime and completed geometry, pose and
transform tuple. Geometry, topology, pose and transform remain explicit spatial
epochs. Replacing topology must also advance geometry; a publication generation
or opaque registration token never stands in for a producer epoch.

Native raw trait callbacks select the previous completed cohort; coordination
subscribers select the new completed cohort. Failed preparation or a raw-write
failure retains the old selected version. A listener exception occurs after
commit and retains the new selected version. Identical publication is a no-op;
changed bytes or provenance under the same completed tuple are rejected.
Pending owned models invalidate the view until every model has a completed
retained version. A completed model with an explicit empty part list represents
known absence. Invalid views remain stable for React and fail closed in queries.

The private proof can reuse a selected part's visible-to-full face correspondence
after validating fresh copies and comparing its explicit topology epoch, source,
instance, part, topology IDs and exact index bytes. Position copies, transforms,
bounds and fingerprints are still recomputed. A changed selection recomputes the
correspondence; retained captures keep their prior face ordinals.

`capture()` returns a fixed provider, oracle and idempotent `release()`. Always
release in `finally`. A capture retains its old copied arrays through later
publications and disposal. Oracle lookup uses the complete copied record stamp,
including source, instance, part, provider generation, frame, topology and all
four epochs. Unrelated entries in the binding do not invalidate owned versions.
Disposal attempts every owned registration, preserves entities and custom state,
and keeps failed cleanup retryable without touching a replacement registration.

## Evidence boundary

The reference oracle exhaustively evaluates indexed triangles in its supported
numerical range after transforming all vertices into the declared world Euclidean
metric. It returns stamped `unknown` for overflow, underflow, subnormal arithmetic
or thin triangles whose squared aspect ratio falls below its roundoff margin.
It does not
convert a local nearest winner into a world answer. Witness diagnostics retain
full source face IDs, barycentric coordinates and geometric normals; degenerate
faces retain segment/point witnesses without inventing a normal. This is a
bounded correctness oracle, not a performance backend or a production kernel.

The tests exercise checksum rejection, full/visible face ownership, a
nonuniform transform that changes the winning triangle, coherent two-model
publication, rollback, postcommit notification errors, explicit invalidation,
capture retention, registration reuse, reentry and retryable cleanup. New gates
require an observed fault-injection failure, byte-identical input/source
restoration, then a passing rerun.

Copied input proof, registry composition and headless mounted React observation
do not establish a live Humanoid producer contract or CPU-to-GPU vertex parity.
Fresh silent rendered acceptance remains a separate owner-reviewed requirement.
No containment, solid penetration, traversability or line-of-sight result is
claimed. The receipts report bounded measurements without a comparative
performance claim.

The pinned 0.8.6 composition uses dense arrays with own indexed entries. The
prototype-filled sparse-array defect tracked in [issue 68](https://github.com/jbcom/koota-kit/issues/68)
is outside this legitimate-input proof; this guide does not claim that defect
has been repaired in the installed release.

## Browser caller boundary

The packed example source has browser-safe siblings, without adding package
runtime exports or dependencies. `mesh-input.mjs` contains the unchanged mesh
validation and authored face mapping. `cohort-core.mjs` retains the resource
ledger and requires synchronous `hashBytes(chunks)` returning lowercase SHA256
hex. `cohort.mjs` preserves the Node API with `node:crypto`; the fixture disk
transport and JSDOM observer remain Node-only.

The protocol hashes ordered chunks without delimiters. Typed views contribute
exactly their buffer offset and byte length in native byte order. Other values
contribute UTF-8 bytes of unchanged `JSON.stringify`, including insertion order.
Undefined serialization and cycles reject before hashing. Promise or malformed
hex results reject before publication; asynchronous Web Crypto is unsuitable.

A private browser caller imports `sha256` from its pinned
`@noble/hashes/sha2.js` 2.4.0 install and supplies that primitive to
`createBrowserProofCohort(coordination, specifications, sha256)` in
`browser-cohort.mjs`. The package itself does not resolve or depend on Noble.
The caller must compare its actual installed primitive with the original Node
hashes for empty, ordered multichunk, offset, Unicode and typed-array vectors.

`react-inspector.mjs` supplies the same component to both observers. It checks
`useWorld()` against the exact raw World and subscribes to the committed cohort.
`browser-observer.mjs` mounts it in an existing native DOM container using the
caller's installed React, `createRoot`, raw `WorldProvider` and `useWorld`.
Its returned cleanup only unmounts React. The private Humanoid route retains
ownership of its evaluator, producer, rendering and GPU evidence.

Resolve example source from hash-verified physical files in the installed
registry package, or an explicitly recorded immutable source transport. These
files are packed caller examples, not runtime export subpaths. No workspace
alias, additional geometry registry or private fixture publication is needed.
Browser digest equality, same-World observation and retained leases must be
verified in the actual browser realm; Node adapter tests alone do not establish
live rendered acceptance.
