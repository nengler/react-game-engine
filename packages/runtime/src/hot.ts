import type { GameObject } from "./GameObject.ts";
import type { World } from "./World.ts";

/**
 * What a hot reload (and a save with `tree: true`) keeps of a tree: each object's own state (`saveHotState`), by its path from the
 * root. A path names each object by its class and its index among the siblings of that class (`Main/Level:0/Player:0`), so a
 * component keeps its state when the code around it changes, as long as it is still the n-th of its kind under the same parent;
 * a list item is named by its key instead (`Main/Level:0/Enemy[beetle-3]`).
 */
export type HotState = ReadonlyMap<string, Record<string, unknown>>;

/** Each object under `root` (included) with state to keep, by path. */
export function captureHotState(root: GameObject): HotState {
  const saved = new Map<string, Record<string, unknown>>();
  walk(root, rootPath(root), (object, path) => {
    const state = object.saveHotState();
    if (state !== null) saved.set(path, state);
  });
  return saved;
}

/**
 * Give the objects of a new tree the state their counterparts had (see `captureHotState`). `root` must be mounted in `world`.
 * Parents go first, and the world is flushed after each level, so a child that exists only because of its parent's state
 * (a condition, a list) is built before it is looked for. Returns how many objects took state back.
 */
export function restoreHotState(world: World, root: GameObject, saved: HotState): number {
  if (saved.size === 0) return 0;
  const done = new Set<string>();
  // Each pass restores at least one object, so this ends; the bound only guards against a tree that never settles.
  for (let pass = 0; pass < 1000; pass++) {
    let restored = 0;
    walk(root, rootPath(root), (object, path) => {
      if (done.has(path)) return;
      const state = saved.get(path);
      if (state === undefined) return;
      done.add(path);
      object.loadHotState(state);
      restored++;
    });
    if (restored === 0) break;
    world.flush();
  }
  return done.size;
}

function rootPath(root: GameObject): string {
  return root.constructor.name;
}

function walk(object: GameObject, path: string, visit: (object: GameObject, path: string) => void): void {
  visit(object, path);
  const seen = new Map<string, number>();
  for (const child of object.children) {
    const name = child.constructor.name;
    // A list item by its key (`Enemy[beetle-3]`); anything else by its place among the siblings of its class (`Enemy:0`).
    if (child.hotKey !== undefined) {
      walk(child, `${path}/${name}[${String(child.hotKey)}]`, visit);
      continue;
    }
    const index = seen.get(name) ?? 0;
    seen.set(name, index + 1);
    walk(child, `${path}/${name}:${index}`, visit);
  }
}
