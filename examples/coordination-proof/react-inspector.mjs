/** Shared raw-koota World inspector; rendering and unmount never own the World. */
export function createProofInspector({ React, useWorld }) {
  return function Inspector({ cohort, world, onObservation }) {
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
  };
}
