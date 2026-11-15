import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameObject, World } from "../src/index.ts";

/**
 * Same objects in the same order, by identity. `assert.deepEqual` is no use here:
 * two fresh `GameObject`s are structurally identical, so it accepts any permutation.
 */
function sameOrder(actual: readonly unknown[], expected: readonly unknown[], message = ""): void {
  assert.equal(actual.length, expected.length, `${message} length`);
  actual.forEach((item, i) => assert.equal(item, expected[i], `${message} position ${i}`));
}

describe("child slots", () => {
  it("insert a slotted child after siblings with a lower or equal slot", () => {
    const parent = new GameObject();
    const [a, b, c] = [new GameObject(), new GameObject(), new GameObject()];
    parent.addChild(a, 0);
    parent.addChild(c, 2);
    parent.addChild(b, 1);
    sameOrder(parent.children, [a, b, c]);
  });

  it("append unslotted children after every slotted one", () => {
    const parent = new GameObject();
    const [a, external, b] = [new GameObject(), new GameObject(), new GameObject()];
    parent.addChild(a, 0);
    parent.addChild(external);
    parent.queueAddChild(b, 1);
    parent.commitStructure();
    sameOrder(parent.children, [a, b, external]);
  });

  it("forget the slot when a child is removed", () => {
    const parent = new GameObject();
    const other = new GameObject();
    const child = new GameObject();
    parent.addChild(child, 5);
    parent.removeChild(child);
    other.addChild(new GameObject(), 0);
    other.addChild(child);
    assert.equal(other.children[1], child);
  });
});

describe("keyed list order", () => {
  it("orders children within a slot by order, between their slotted siblings", () => {
    const parent = new GameObject();
    const [before, a, b, c, after] = [new GameObject(), new GameObject(), new GameObject(), new GameObject(), new GameObject()];
    parent.addChild(before, 0);
    parent.addChild(after, 2);
    parent.addChild(c, 1, 2);
    parent.addChild(a, 1, 0);
    parent.addChild(b, 1, 1);
    sameOrder(parent.children, [before, a, b, c, after]);
  });

  it("reorders one slot at commit, leaving the other slots alone", () => {
    const parent = new GameObject();
    const [before, a, b, c, after, external] = [
      new GameObject(),
      new GameObject(),
      new GameObject(),
      new GameObject(),
      new GameObject(),
      new GameObject(),
    ];
    parent.addChild(before, 0);
    parent.addChild(a, 1, 0);
    parent.addChild(b, 1, 1);
    parent.addChild(after, 2);
    parent.addChild(external);
    parent.queueAddChild(c, 1, 2);
    parent.queueReorder(1, [c, b, a]);
    parent.commitStructure();
    sameOrder(parent.children, [before, c, b, a, after, external]);
  });

  it("applies removals before a reorder, and a new item lands at its order", () => {
    const parent = new GameObject();
    const [a, b, c, x] = [new GameObject(), new GameObject(), new GameObject(), new GameObject()];
    parent.addChild(a, 0, 0);
    parent.addChild(b, 0, 1);
    parent.addChild(c, 0, 2);
    parent.queueRemoveChild(b);
    parent.queueAddChild(x, 0, 1);
    parent.queueReorder(0, [a, x, c]);
    parent.commitStructure();
    sameOrder(parent.children, [a, x, c]);
  });

  it("keeps the order of a queued add, with no reorder queued after it", () => {
    const parent = new GameObject();
    const [a, b, c] = [new GameObject(), new GameObject(), new GameObject()];
    parent.addChild(b, 0, 1);
    parent.queueAddChild(c, 0, 2);
    parent.queueAddChild(a, 0, 0);
    parent.commitStructure();
    sameOrder(parent.children, [a, b, c]);
  });

  it("keeps the order of a queued add among its slot's neighbours, in different commits", () => {
    const parent = new GameObject();
    const [first, middle, last] = [new GameObject(), new GameObject(), new GameObject()];
    const [before, after] = [new GameObject(), new GameObject()];
    parent.addChild(before, 0);
    parent.addChild(middle, 1, 1);
    parent.addChild(after, 2);
    parent.queueAddChild(last, 1, 2);
    parent.commitStructure();
    sameOrder(parent.children, [before, middle, last, after], "a later sibling lands after");
    parent.queueAddChild(first, 1, 0);
    parent.commitStructure();
    sameOrder(parent.children, [before, first, middle, last, after], "an earlier sibling lands before");
  });

  it("forgets the order when a child is removed", () => {
    const parent = new GameObject();
    const child = new GameObject();
    parent.addChild(child, 0, 7);
    parent.removeChild(child);
    const other = new GameObject();
    const first = new GameObject();
    other.addChild(child, 0);
    other.addChild(first, 0, 0);
    sameOrder(other.children, [child, first], "equal (slot, order): insertion order");
  });
});

describe("passed children", () => {
  /** A component that renders {children} in `body`, between a header and a footer. */
  function panel(): { panel: GameObject; body: GameObject; header: GameObject; footer: GameObject } {
    const panel = new GameObject();
    const [body, header, footer] = [new GameObject(), new GameObject(), new GameObject()];
    panel.addChild(body);
    body.addChild(header, 0);
    body.addChild(footer, 2);
    (panel as unknown as { passedChildrenHost: GameObject }).passedChildrenHost = body;
    (panel as unknown as { passedChildrenSlot: number }).passedChildrenSlot = 1;
    return { panel, body, header, footer };
  }

  it("mount between the component's own children, by order", () => {
    const { panel: p, body, header, footer } = panel();
    const [a, b, c] = [new GameObject(), new GameObject(), new GameObject()];
    p.attachPassedChild(c, 2);
    p.attachPassedChild(a, 0);
    p.queueAttachPassedChild(b, 1);
    body.commitStructure();
    sameOrder(body.children, [header, a, b, c, footer]);
  });

  it("mount a conditional passed child between static ones that surround it, whichever condition turns on first", () => {
    const { panel: p, body, header, footer } = panel();
    const [a, b, c] = [new GameObject(), new GameObject(), new GameObject()]; // {x && <A />}<B />{y && <C />}
    p.attachPassedChild(b, 1);
    p.queueAttachPassedChild(c, 2);
    body.commitStructure();
    sameOrder(body.children, [header, b, c, footer], "C after the static B");
    p.queueAttachPassedChild(a, 0);
    body.commitStructure();
    sameOrder(body.children, [header, a, b, c, footer], "A before it");
  });

  it("detach and reorder through the component", () => {
    const { panel: p, body, header, footer } = panel();
    const [a, b, c] = [new GameObject(), new GameObject(), new GameObject()];
    p.attachPassedChild(a, 0);
    p.attachPassedChild(b, 1);
    p.attachPassedChild(c, 2);
    p.queueDetachPassedChild(b);
    p.queueReorderPassedChildren([c, a]);
    body.commitStructure();
    sameOrder(body.children, [header, c, a, footer]);
  });

  it("throw a clear error when the component does not render {children}", () => {
    assert.throws(() => new GameObject().attachPassedChild(new GameObject(), 0), /does not render \{children\}/);
  });
});

describe("mount and unmount", () => {
  /** Records its own mount and unmount in a shared log. */
  class Logged extends GameObject {
    readonly label: string;
    readonly log: string[];
    constructor(label: string, log: string[]) {
      super();
      this.label = label;
      this.log = log;
    }
    override onMount(): void {
      this.log.push(`mount ${this.label}`);
    }
    override onUnmount(): void {
      this.log.push(`unmount ${this.label}${this.world ? "" : " (detached)"}`);
    }
  }

  it("mounts a subtree children first, once, when it joins a world", () => {
    const log: string[] = [];
    const [parent, a, b] = [new Logged("parent", log), new Logged("a", log), new Logged("b", log)];
    parent.addChild(a);
    parent.addChild(b);
    assert.deepEqual(log, [], "nothing runs before there is a world");
    const world = new World();
    world.mount(parent);
    assert.deepEqual(log, ["mount a", "mount b", "mount parent"]);
    world.root.removeChild(parent);
    log.length = 0;
    world.mount(parent);
    assert.deepEqual(log, ["mount a", "mount b", "mount parent"], "a new stay in a world mounts again");
  });

  it("unmounts a subtree parent first, each object while still in the world", () => {
    const log: string[] = [];
    const [parent, child] = [new Logged("parent", log), new Logged("child", log)];
    parent.addChild(child);
    const world = new World();
    world.mount(parent);
    log.length = 0;
    world.root.removeChild(parent);
    assert.deepEqual(log, ["unmount parent", "unmount child"], "neither was detached yet when its own hook ran");
    assert.equal(parent.world, null);
    assert.equal(child.world, null);
  });

  it("mounts a child added later, and unmounts one removed through the queue", () => {
    const log: string[] = [];
    const [parent, late] = [new Logged("parent", log), new Logged("late", log)];
    const world = new World();
    world.mount(parent);
    log.length = 0;
    parent.queueAddChild(late);
    world.flush();
    assert.deepEqual(log, ["mount late"]);
    parent.queueRemoveChild(late);
    world.flush();
    assert.deepEqual(log, ["mount late", "unmount late"]);
  });

  it("does not run unmount for an object that never mounted", () => {
    const log: string[] = [];
    const [parent, child] = [new Logged("parent", log), new Logged("child", log)];
    parent.addChild(child);
    parent.removeChild(child);
    assert.deepEqual(log, []);
  });

  it("renders state set in onMount in the same flush", () => {
    let renders = 0;
    class Eager extends GameObject {
      override onMount(): void {
        this.markDirty();
      }
      override render(): void {
        renders++;
      }
    }
    const world = new World();
    world.mount(new Eager());
    assert.equal(world.flush(), 1);
    assert.equal(renders, 1);
  });
});

describe("renders asked for twice", () => {
  class Counted extends GameObject {
    seen: number[] = [];
    onRender: (() => void) | undefined;
    override render(): void {
      this.seen.push(this.parent?.children.length ?? -1);
      this.onRender?.();
    }
  }

  it("renders an object once though it asked when it turned dirty and again when it joined the world still dirty", () => {
    const world = new World();
    const parent = new GameObject();
    world.mount(parent);
    const a = new Counted();
    parent.addChild(a);
    a.markDirty();
    parent.removeChild(a);
    parent.addChild(a);
    assert.equal(world.flush(), 1);
    assert.equal(a.seen.length, 1);
    // One that asked and then left is not rendered, and nothing is left over for the next flush.
    a.markDirty();
    parent.removeChild(a);
    assert.equal(world.flush(), 0);
    parent.addChild(a);
    assert.equal(world.flush(), 1);
    assert.equal(world.flush(), 0);
  });

  it("looks at each object once per pass: one made dirty again by a later render waits for the next pass, after structure is committed", () => {
    const world = new World();
    const parent = new GameObject();
    world.mount(parent);
    const x = new Counted();
    const y = new Counted();
    parent.addChild(x);
    parent.addChild(y);
    x.markDirty();
    y.markDirty();
    // x is now in the list twice, with y between.
    parent.removeChild(x);
    parent.addChild(x);
    let once = true;
    y.onRender = () => {
      if (!once) return;
      once = false;
      x.markDirty();
      parent.queueAddChild(new GameObject());
    };
    assert.equal(world.flush(), 3);
    // x rendered with two children there, then again in the next pass, after the third was added.
    assert.deepEqual(x.seen, [2, 3]);
    assert.deepEqual(y.seen, [2]);
  });

  it("renders an object in the world it is in now, when it moved there while dirty", () => {
    const first = new World();
    const second = new World();
    const a = new Counted();
    first.mount(a);
    a.markDirty();
    first.root.removeChild(a);
    second.mount(a);
    assert.equal(first.flush(), 0);
    assert.equal(second.flush(), 1);
    assert.equal(a.seen.length, 1);
  });
});
