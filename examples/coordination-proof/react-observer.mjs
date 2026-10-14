import assert from "node:assert/strict";

/** A headless mounted observer; neither the component nor its unmount owns the World. */
export async function observeCommittedUpdate({ registryImport, cohort, world, publish }) {
  const React = await registryImport("react");
  const { createRoot } = await registryImport("react-dom/client");
  const { WorldProvider, useWorld } = await registryImport("koota/react");
  const { JSDOM } = await registryImport("jsdom");
  const dom = new JSDOM("<!doctype html><html><body><div id='proof'></div></body></html>");
  const descriptors = new Map();
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const observations = [];
  const container = dom.window.document.getElementById("proof");
  const root = createRoot(container);
  function Inspector() {
    assert.equal(useWorld(), world);
    const snapshot = React.useSyncExternalStore(
      cohort.subscribe,
      cohort.getSnapshot,
      cohort.getSnapshot,
    );
    observations.push(snapshot);
    return React.createElement(
      "output",
      null,
      snapshot.coordination.entries
        .map((entry) => `${entry.id}:${entry.completed?.revisions.pose ?? "pending"}`)
        .join(","),
    );
  }
  let unmounted = false;
  try {
    await React.act(async () =>
      root.render(React.createElement(WorldProvider, { world }, React.createElement(Inspector))),
    );
    const before = container.textContent;
    const previous = cohort.getSnapshot();
    await React.act(async () => publish());
    assert.notEqual(cohort.getSnapshot(), previous);
    assert.equal(observations.at(-1), cohort.getSnapshot());
    const after = container.textContent;
    assert.notEqual(after, before);
    await React.act(async () => root.unmount());
    unmounted = true;
    assert.ok(world.isInitialized);
    return {
      before,
      after,
      renderCount: observations.length,
      sameWorld: true,
      unmountPreservedWorld: true,
    };
  } finally {
    // Clean up an assertion failure before the normal unmount.
    if (!unmounted) await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}
