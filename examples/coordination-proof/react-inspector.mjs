/**
 * Shared raw-koota World inspector; rendering and unmount never own the World.
 *
 * The caller's installed React and koota hooks arrive as props, so the component is a stable
 * module-level function instead of one defined inside a factory.
 */
export function ProofInspector({ React, useWorld, cohort, world, onObservation }) {
  if (useWorld() !== world) throw new Error("proof: inspector observed a different raw World");
  const snapshot = React.useSyncExternalStore(
    cohort.subscribe,
    cohort.getSnapshot,
    cohort.getSnapshot,
  );
  onObservation?.(snapshot);
  return React.createElement(
    "output",
    null,
    snapshot.coordination.entries
      .map((entry) => `${entry.id}:${entry.completed?.revisions.pose ?? "pending"}`)
      .join(","),
  );
}

/** Builds the inspector element with the caller's installed React and `useWorld`. */
export function createProofInspectorElement({ React, useWorld, cohort, world, onObservation }) {
  return React.createElement(ProofInspector, { React, useWorld, cohort, world, onObservation });
}
