// @vitest-environment jsdom
//
// The React entry (`koota-kit/react`): SimWorldProvider supplies the whole
// WorldHandle AND koota's own WorldProvider, and useSimWorld reads the handle
// back or throws when there is no provider.

import { createElement } from "react";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { trait } from "koota";
import { useQuery, useWorld } from "koota/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SimWorldProvider, useSimWorld } from "../src/react.js";
import { createSimWorld, destroySimWorld } from "../src/world.js";
import type { WorldHandle } from "../src/world.js";

beforeAll(() => {
  // Tell React this environment wraps updates in act().
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const mounted: Root[] = [];
const handles: WorldHandle[] = [];

function newHandle(seed: string): WorldHandle {
  const handle = createSimWorld({ gen: `${seed}-gen`, events: `${seed}-events` });
  handles.push(handle);
  return handle;
}

function mount(): { root: Root; container: HTMLElement } {
  const container = document.createElement("div");
  const root = createRoot(container);
  mounted.push(root);
  return { root, container };
}

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  for (const handle of handles.splice(0)) destroySimWorld(handle);
});

function render(root: Root, node: ReactNode): void {
  act(() => root.render(node));
}

describe("SimWorldProvider", () => {
  it("supplies the handle itself to useSimWorld, with every facade field reachable", () => {
    const handle = newHandle("supplies");
    let seen: WorldHandle | undefined;
    const Probe = () => {
      seen = useSimWorld();
      return null;
    };
    const { root } = mount();
    render(root, createElement(SimWorldProvider, { handle }, createElement(Probe)));

    expect(seen).toBe(handle);
    expect(seen?.rng).toBe(handle.rng);
    expect(seen?.seeds).toBe(handle.seeds);
    expect(seen?.clock).toBe(handle.clock);
    expect(seen?.scratch).toBe(handle.scratch);
  });

  it("renders its children", () => {
    const handle = newHandle("children");
    const { root, container } = mount();
    render(
      root,
      createElement(SimWorldProvider, { handle }, createElement("p", { id: "child" }, "hello")),
    );

    expect(container.querySelector("#child")?.textContent).toBe("hello");
  });

  it("also provides koota's own world, so koota/react hooks need no second provider", () => {
    const handle = newHandle("koota");
    const Tag = trait();
    handle.world.spawn(Tag);
    handle.world.spawn(Tag);
    let kootaWorld: unknown;
    let queried = -1;
    const Probe = () => {
      kootaWorld = useWorld();
      queried = useQuery(Tag).length;
      return null;
    };
    const { root } = mount();
    render(root, createElement(SimWorldProvider, { handle }, createElement(Probe)));

    expect(kootaWorld).toBe(handle.world);
    expect(queried).toBe(2);
  });

  it("re-provides when the handle prop is swapped", () => {
    const first = newHandle("first");
    const second = newHandle("second");
    const seenHandles: WorldHandle[] = [];
    const seenWorlds: unknown[] = [];
    const Probe = () => {
      seenHandles.push(useSimWorld());
      seenWorlds.push(useWorld());
      return null;
    };
    const { root } = mount();
    render(root, createElement(SimWorldProvider, { handle: first }, createElement(Probe)));
    render(root, createElement(SimWorldProvider, { handle: second }, createElement(Probe)));

    expect(seenHandles[0]).toBe(first);
    expect(seenWorlds[0]).toBe(first.world);
    expect(seenHandles[seenHandles.length - 1]).toBe(second);
    expect(seenWorlds[seenWorlds.length - 1]).toBe(second.world);
  });
});

describe("useSimWorld", () => {
  it("throws a clear error outside a SimWorldProvider", () => {
    const Probe = () => {
      useSimWorld();
      return null;
    };

    expect(() => renderToString(createElement(Probe))).toThrow(
      "useSimWorld must be used within a <SimWorldProvider>",
    );
  });
});
