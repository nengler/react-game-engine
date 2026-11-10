import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, GameObject, Shape, World } from "../src/index.ts";

/**
 * The stamps a change leaves (see `GameObject.markChanged` and `markMoved`): `[self, subtree, content]`, each the world's
 * serial at the time, or 0 for never. The player's frame builder reads them to decide what it can keep.
 */
const stamps = (object: GameObject): number[] => [object.selfChangedAt, object.subtreeChangedAt, object.contentChangedAt];

/** root > group > item > leaf, and a sibling of item, in a world whose serial is 5. */
function tree(): { world: World; root: Entity; group: Entity; item: Entity; leaf: Shape; sibling: Entity } {
  const world = new World();
  const root = new Entity();
  const group = new Entity();
  const item = new Entity();
  const sibling = new Entity();
  const leaf = new Shape({ kind: "rect", width: 1, height: 1 });
  item.addChild(leaf);
  group.addChild(item);
  group.addChild(sibling);
  root.addChild(group);
  world.mount(root);
  world.serial = 5;
  return { world, root, group, item, leaf, sibling };
}

describe("what a change stamps", () => {
  it("markChanged: the object changed, and so did the content of everything above it", () => {
    const { root, group, item, leaf, sibling } = tree();
    item.markChanged();
    assert.deepEqual(stamps(item), [5, 5, 5]);
    assert.deepEqual(stamps(group), [0, 5, 5], "something under it changed");
    assert.deepEqual(stamps(root), [0, 5, 5]);
    assert.deepEqual(stamps(leaf), [0, 0, 0], "what is under it is not stamped: it is found by looking above");
    assert.deepEqual(stamps(sibling), [0, 0, 0]);
  });

  it("markMoved: the object moved, its own content did not change, and the content of everything above it did", () => {
    const { root, group, item, leaf } = tree();
    item.markMoved();
    assert.deepEqual(stamps(item), [5, 5, 0], "it changed, but only where it is");
    assert.deepEqual(stamps(group), [0, 5, 5]);
    assert.deepEqual(stamps(root), [0, 5, 5]);
    assert.deepEqual(stamps(leaf), [0, 0, 0]);
  });

  it("a move, then a change under it in the same frame: the content of what moved has changed after all", () => {
    const { root, group, item, leaf } = tree();
    group.markMoved();
    assert.deepEqual(stamps(group), [5, 5, 0]);
    assert.deepEqual(stamps(root), [0, 5, 5]);
    // The walk upward does not stop at `group` because it was already stamped as moved: its content was not.
    leaf.markMoved();
    assert.deepEqual(stamps(leaf), [5, 5, 0]);
    assert.deepEqual(stamps(item), [0, 5, 5]);
    assert.deepEqual(stamps(group), [5, 5, 5]);
    assert.deepEqual(stamps(root), [0, 5, 5]);
  });

  it("a change, then a move of the same object: both are remembered", () => {
    const { item } = tree();
    item.markChanged();
    item.markMoved();
    assert.deepEqual(stamps(item), [5, 5, 5]);
  });

  it("stamps with the serial of the time, so a later frame's change is newer", () => {
    const { world, group, item } = tree();
    item.markMoved();
    world.serial = 6;
    item.markMoved();
    assert.deepEqual(stamps(item), [6, 6, 0]);
    assert.deepEqual(stamps(group), [0, 6, 6]);
    world.serial = 7;
    item.markChanged();
    assert.deepEqual(stamps(item), [7, 7, 7]);
  });

  it("stamps nothing outside a world: nothing has been drawn from such a tree", () => {
    const loose = new Entity();
    loose.markChanged();
    loose.markMoved();
    assert.deepEqual(stamps(loose), [0, 0, 0]);
  });

  it("adding and removing a child change the parent's content", () => {
    const { world, root, group, item } = tree();
    world.serial = 8;
    group.removeChild(item);
    assert.deepEqual(stamps(group), [8, 8, 8]);
    world.serial = 9;
    root.addChild(item);
    assert.deepEqual(stamps(root), [9, 9, 9]);
  });
});

describe("what a render stamps", () => {
  /** A hand-written class: nothing says what its render wrote, so all of it changed. */
  class Plain extends Entity {
    override render(): void {}
  }
  /** As generated: the render says what it changed itself. */
  class Reporting extends Entity {
    protected override readonly reportsChanges = true;
    next: "nothing" | "move" | "change" = "nothing";
    override render(): void {
      if (this.next === "move") this.markMoved();
      else if (this.next === "change") this.markChanged();
    }
  }

  function mounted<T extends GameObject>(object: T): { world: World; object: T } {
    const world = new World();
    world.mount(object);
    world.flush();
    world.serial = 3;
    return { world, object };
  }

  it("takes a render of a class that does not report for a change of everything it owns", () => {
    const { world, object } = mounted(new Plain());
    object.markDirty();
    world.flush();
    assert.deepEqual(stamps(object), [3, 3, 3]);
  });

  it("stamps nothing for a render that reports nothing, only a move for one that moved, and a change for one that changed", () => {
    const { world, object } = mounted(new Reporting());
    object.markDirty();
    world.flush();
    assert.deepEqual(stamps(object), [0, 0, 0], "the render changed nothing that is drawn");

    object.next = "move";
    object.markDirty();
    world.flush();
    assert.deepEqual(stamps(object), [3, 3, 0]);
    assert.deepEqual(stamps(world.root), [0, 3, 3]);

    world.serial = 4;
    object.next = "change";
    object.markDirty();
    world.flush();
    assert.deepEqual(stamps(object), [4, 4, 4]);
  });
});
