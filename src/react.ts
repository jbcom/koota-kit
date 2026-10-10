// React bindings for the sim handle. This is the ONLY module that imports
// React (through koota/react), and nothing else in the package imports it, so
// the root entry and every other subpath stay React-free. `react` is an
// optional peer dependency: consumers who never import `koota-kit/react` never
// need it installed.
//
// koota/react's own `WorldProvider` / `useWorld` carry only the koota `World`.
// A component that needs the handle's RNG streams, seeds, clock or scratch
// cannot reach them from there. `SimWorldProvider` supplies the whole
// `WorldHandle` AND mounts koota's provider for `handle.world`, so
// `useTrait`, `useQuery` and `useActions` work underneath it unchanged.

import { WorldProvider } from "koota/react";
import { createContext, createElement, useContext } from "react";
import type { FunctionComponent, ReactNode } from "react";
import type { WorldHandle } from "./world.js";

export type SimWorldProviderProps = {
  /** The handle from `createSimWorld`. Swapping it re-provides every consumer. */
  readonly handle: WorldHandle;
  readonly children?: ReactNode;
};

const SimWorldContext = createContext<WorldHandle | null>(null);
SimWorldContext.displayName = "SimWorldContext";

/**
 * Provide a `WorldHandle` to the tree below. Renders koota's `WorldProvider`
 * for `handle.world`, so every `koota/react` hook works under it without a
 * second provider. The provider does not own the handle's lifecycle: create it
 * with `createSimWorld` and release it with `destroySimWorld` yourself.
 */
export const SimWorldProvider: FunctionComponent<SimWorldProviderProps> = ({ handle, children }) =>
  createElement(
    SimWorldContext.Provider,
    { value: handle },
    createElement(WorldProvider, { world: handle.world, children }),
  );

/**
 * The `WorldHandle` provided by the nearest `SimWorldProvider`: its `world`,
 * `rng`, `seeds`, `clock` and `scratch`. Throws when called outside one — a
 * missing provider is a wiring bug, not a state to render around.
 */
export function useSimWorld(): WorldHandle {
  const handle = useContext(SimWorldContext);
  if (handle === null) {
    throw new Error("useSimWorld must be used within a <SimWorldProvider>");
  }
  return handle;
}
