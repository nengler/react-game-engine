import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GameObject } from "../src/index.ts";

describe("child slots", () => {
  it("insert a slotted child after siblings with a lower or equal slot", () => {
    const parent = new GameObject();
    const [a, b, c] = [new GameObject(), new GameObject(), new GameObject()];
    parent.addChild(a, 0);
    parent.addChild(c, 2);
    parent.addChild(b, 1);
    assert.deepEqual(parent.children, [a, b, c]);
  });

  it("append unslotted children after every slotted one", () => {
    const parent = new GameObject();
    const [a, external, b] = [new GameObject(), new GameObject(), new GameObject()];
    parent.addChild(a, 0);
    parent.addChild(external);
    parent.queueAddChild(b, 1);
    parent.commitStructure();
    assert.deepEqual(parent.children, [a, b, external]);
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
    assert.deepEqual(parent.children, [before, a, b, c, after]);
  });

  it("reorders one slot at commit, leaving the other slots alone", () => {
    const parent = new GameObject();
    const [before, a, b, c, after, external] = [new GameObject(), new GameObject(), new GameObject(), new GameObject(), new GameObject(), new GameObject()];
    parent.addChild(before, 0);
    parent.addChild(a, 1, 0);
    parent.addChild(b, 1, 1);
    parent.addChild(after, 2);
    parent.addChild(external);
    parent.queueAddChild(c, 1, 2);
    parent.queueReorder(1, [c, b, a]);
    parent.commitStructure();
    assert.deepEqual(parent.children, [before, c, b, a, after, external]);
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
    assert.deepEqual(parent.children, [a, x, c]);
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
    assert.deepEqual(other.children, [child, first], "equal (slot, order): insertion order");
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
    assert.deepEqual(body.children, [header, a, b, c, footer]);
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
    assert.deepEqual(body.children, [header, c, a, footer]);
  });

  it("throw a clear error when the component does not render {children}", () => {
    assert.throws(() => new GameObject().attachPassedChild(new GameObject(), 0), /does not render \{children\}/);
  });
});
