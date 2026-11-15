/**
 * The tree the game runs: its world and root, which the player sets when it mounts the root (and `@tsengine/testing` when it renders a
 * component). A save with `tree: true` reads every component's own state from it, and puts state back into it after a load.
 */
import type { GameObject } from "./GameObject.ts";
import { captureHotState, type HotState } from "./hot.ts";
import type { World } from "./World.ts";

let current: { readonly world: World; readonly root: GameObject } | null = null;
let pending: HotState | null = null;

/** The game's tree is this root in this world (null: there is none, as in a test that mounts nothing). */
export function setGameTree(world: World | null, root: GameObject | null): void {
  current = world !== null && root !== null ? { world, root } : null;
}

export function getGameTree(): { readonly world: World; readonly root: GameObject } | null {
  return current;
}

/** Every component's own state in the game's tree, by path (see `captureHotState`). Empty with no tree. */
export function captureGameTree(): HotState {
  return current === null ? new Map() : captureHotState(current.root);
}

/**
 * Put this state back into the game's tree once it has settled: after the flush that follows (a load runs in a handler, while
 * the tree is still being changed by the state it applied). See `World.flush`.
 */
export function queueTreeRestore(state: HotState): void {
  pending = state;
}

/** The state waiting to go back into `world`'s tree, taken (so it is restored once), or null. */
export function takeTreeRestore(world: World): { readonly state: HotState; readonly root: GameObject } | null {
  if (pending === null || current === null || current.world !== world) return null;
  const state = pending;
  pending = null;
  return { state, root: current.root };
}
