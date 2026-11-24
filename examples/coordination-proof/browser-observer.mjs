import { createProofInspectorElement } from "./react-inspector.mjs";

/** Native DOM mounting on the private caller route; no JSDOM or global replacement. */
export function mountProofInspector({
  React,
  createRoot,
  WorldProvider,
  useWorld,
  container,
  cohort,
  world,
  onObservation,
}) {
  const root = createRoot(container);
  root.render(
    React.createElement(
      WorldProvider,
      { world },
      createProofInspectorElement({ React, useWorld, cohort, world, onObservation }),
    ),
  );
  return () => root.unmount();
}
