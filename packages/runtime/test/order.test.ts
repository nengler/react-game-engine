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
