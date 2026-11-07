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

  /**
   * Advance one tick: run `onUpdate(dt)` on every attached object (parents
   * before children), then flush the resulting renders and structure changes.
   * The tree is snapshotted per object, and objects removed mid-tick are skipped.
   */
  update(dt: number): number {
    const visit = (object: GameObject): void => {
      if (object.world !== this) return;
      object.onUpdate(dt);
      for (const child of [...object.children]) visit(child);
    };
    for (const child of [...this.root.children]) visit(child);
    return this.flush();
  }

  /**
   * Report that `a` and `b` began colliding (the mock runtime has no physics;
   * a collision system calls this). Notifies both, then flushes.
   */
  collide(a: GameObject, b: GameObject): number {
    if (a.world === this) a.onCollisionEnter(b);
    if (b.world === this) b.onCollisionEnter(a);
    return this.flush();
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
