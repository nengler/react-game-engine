import { GameObject } from "./GameObject.ts";

/**
 * Owns the root of the object tree and drives dirty-driven updates:
 * render every dirty object, then apply queued structural changes.
 */
export class World {
  readonly root: GameObject = new GameObject();
  #dirty = new Set<GameObject>();
  #structure = new Set<GameObject>();

  constructor() {
    this.root.attachToWorld(this);
  }

  mount(object: GameObject): void {
    this.root.addChild(object);
  }

  scheduleRender(object: GameObject): void {
    this.#dirty.add(object);
  }

  scheduleCommit(object: GameObject): void {
    this.#structure.add(object);
  }

  /** Process all pending work until the tree is stable. Returns the number of renders run. */
  flush(): number {
    let renders = 0;
    while (this.#dirty.size > 0 || this.#structure.size > 0) {
      const dirty = [...this.#dirty];
      this.#dirty.clear();
      for (const object of dirty) {
        if (object.world !== this || !object.isDirty) continue;
        object.runRender();
        renders++;
      }
      const structure = [...this.#structure];
      this.#structure.clear();
      for (const object of structure) object.commitStructure();
    }
    return renders;
  }
}
