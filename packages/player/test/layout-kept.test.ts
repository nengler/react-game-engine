import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Entity, Flex, Hud, Shape, Text, World, type GameObject } from "@tsengine/runtime";

import { FrameBuilder } from "../src/draw.ts";

/** A text is 0.6 of its size a character wide here (no backend measures), so a longer text is a wider one. */
const builderFor = (retain: boolean | "check" = "check"): FrameBuilder => new FrameBuilder({ loadTexture: () => 0, retain });

/** A HUD with one layout root: a row of a label, a box that grows, and a second label, which the first one's width pushes along. */
function scene(): { world: World; root: Entity; hud: Hud; row: Flex; left: Text; right: Text } {
  const world = new World();
  const root = new Entity();
  const hud = new Hud();
  const row = new Flex({ direction: "row", gap: 4, padding: 2 });
  const left = new Text({ text: "GOLD 5", size: 10 });
  const right = new Text({ text: "WAVE 1", size: 10 });
  row.addChild(left);
  row.addChild(right);
  hud.addChild(row);
  root.addChild(hud);
  world.mount(root);
  return { world, root, hud, row, left, right };
}

describe("a layout that is kept", () => {
  it("is not worked out again while nothing under its root changes, and draws what a full rebuild draws", () => {
    const { world, right } = scene();
    const builder = builderFor();
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 0, "the first frame lays it out");
    const at = right.layoutX;
    assert.ok(at > 0, "the second label is placed after the first");
    for (let frame = 0; frame < 5; frame++) {
      world.tick(1 / 60);
      builder.build(world.root, 320, 180);
      assert.equal(builder.keptLayouts, 1, `frame ${frame} keeps it`);
      assert.equal(right.layoutX, at);
    }
  });

  it("is worked out again on the frame after a change that was reported, and kept again after that", () => {
    const { world, row, left, right } = scene();
    const builder = builderFor();
    for (let i = 0; i < 3; i++) builder.build(world.root, 320, 180);
    const before = right.layoutX;

    left.text = "GOLD 5000"; // a wider label, written outside a render: said with markChanged, as a render says it by itself
    left.markChanged();
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 0);
    assert.equal(right.layoutX, before + 3 * 6, "three more characters of 6 pixels push the second label along");
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 1);

    // A new child is a structural change, which stamps its parent by itself.
    row.addChild(new Shape({ kind: "rect", width: 7, height: 7 }));
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 0);
    assert.ok((row.children[2] as GameObject).layoutX > right.layoutX, "the new child is placed after the second label");
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 1);

    // A box's own prop.
    row.gap = 10;
    row.markChanged();
    const gapBefore = right.layoutX;
    builder.build(world.root, 320, 180);
    assert.equal(right.layoutX, gapBefore + 6);
  });

  it("follows something that only moved inside a leaf: where it is decides where the leaf's own drawing starts", () => {
    const { world, row } = scene();
    const leaf = new Entity();
    const inner = new Shape({ kind: "rect", width: 5, height: 5 });
    leaf.addChild(inner);
    row.addChild(leaf, 0); // before the labels (a lower slot sorts first)
    const builder = builderFor();
    for (let i = 0; i < 3; i++) builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 1);
    assert.equal(leaf.layoutX, 2, "inside the padding");
    inner.transform.x = 20; // what the leaf draws now starts 20 pixels from its origin
    inner.markMoved();
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 0);
    assert.equal(leaf.layoutX, 2 - 20, "the leaf is put where its drawing lands inside the padding");
  });

  it("is worked out again for a window of another size, and for another game font", () => {
    const { world, row } = scene();
    row.float = true;
    row.anchor = "bottom-right";
    row.to = "bottom-right";
    // Not in check mode: the builder it compares with is made once, with the font the first one was made with.
    const builder = builderFor(true);
    for (let i = 0; i < 3; i++) builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 1);
    const at = row.layoutX;
    builder.build(world.root, 400, 180);
    assert.equal(builder.keptLayouts, 0);
    assert.equal(row.layoutX, at + 80, "the floating root hangs off the new right edge");
    builder.build(world.root, 400, 180);
    assert.equal(builder.keptLayouts, 1);
    builder.font = "font.png";
    builder.build(world.root, 400, 180);
    assert.equal(builder.keptLayouts, 0, "a <Text> without a font of its own is measured in the game's");
  });

  it("is never kept with a box that scrolls in it: the wheel and the focus move its children without a stamp", () => {
    const { world, row } = scene();
    const list = new Flex({ direction: "column", height: 20, overflow: "scroll" });
    for (let i = 0; i < 6; i++) list.addChild(new Shape({ kind: "rect", width: 10, height: 10 }));
    row.addChild(list);
    const builder = builderFor();
    for (let i = 0; i < 4; i++) {
      builder.build(world.root, 320, 180);
      assert.equal(builder.keptLayouts, 0);
    }
    const first = list.children[0] as GameObject;
    const before = first.layoutY;
    list.scrollY = 15; // what the wheel does
    builder.build(world.root, 320, 180);
    assert.equal(first.layoutY, before - 15);
  });

  it("is never kept with a hand-written class that has a per-tick hook in it: the hook may resize it and report nothing", () => {
    class Grower extends Shape {
      override onUpdate(): void {
        this.width += 1;
      }
    }
    const { world, row, right } = scene();
    row.addChild(new Grower({ kind: "rect", width: 5, height: 5 }), 0);
    const builder = builderFor();
    let last = 0;
    for (let i = 0; i < 4; i++) {
      world.tick(1 / 60);
      builder.build(world.root, 320, 180);
      assert.equal(builder.keptLayouts, 0);
      assert.ok(right.layoutX > last, "the label is pushed along every frame");
      last = right.layoutX;
    }
  });

  it("is found out by check mode when something under it changed without saying so", () => {
    const { world, left } = scene();
    const builder = builderFor("check");
    for (let i = 0; i < 3; i++) builder.build(world.root, 320, 180);
    left.text = "GOLD 5000"; // a direct write, outside any render, with no markChanged
    assert.throws(() => builder.build(world.root, 320, 180), /A kept layout differs from a fresh one \(under a Flex\)/);
  });

  it("is found out by check mode even when what moved draws nothing", () => {
    const { world, row } = scene();
    const spacer = new Flex({ width: 4, height: 4 });
    row.addChild(spacer); // last in the row, which has no background: nothing that is drawn moves when it grows
    const builder = builderFor("check");
    for (let i = 0; i < 3; i++) builder.build(world.root, 320, 180);
    spacer.width = 9; // an empty box with no background: no record of the frame says how wide it is
    assert.throws(() => builder.build(world.root, 320, 180), /A kept layout differs from a fresh one/);
  });

  it("is given up when another builder lays the root out in a box of another size", () => {
    const { world, row } = scene();
    row.float = true;
    row.anchor = "bottom-right";
    row.to = "bottom-right";
    const builder = builderFor(true);
    for (let i = 0; i < 3; i++) builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 1);
    const at = row.layoutX;
    // A screenshot at twice the size, say: a builder that reuses nothing, but lays out the same objects.
    builderFor(false).build(world.root, 640, 360);
    assert.equal(row.layoutX, at + 320);
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 0, "what it kept is not what is there any more");
    assert.equal(row.layoutX, at);
    // One that lays it out in the same box changes nothing, and the layout stays kept.
    builderFor(false).build(world.root, 320, 180);
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 1);
  });

  it("is given up by a root that has been laid out as another box's child in between", () => {
    const { world, hud, row } = scene();
    const builder = builderFor();
    for (let i = 0; i < 3; i++) builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 1);
    const width = row.box.size[0] as number;
    // Into a wider column that stretches it, and out again, with a build in between: nothing under the row itself was changed.
    const column = new Flex({ direction: "column", width: 200, alignItems: "stretch" });
    hud.addChild(column);
    hud.removeChild(row);
    column.addChild(row);
    builder.build(world.root, 320, 180);
    assert.equal(row.box.size[0], 200, "as a child it is stretched to the column");
    column.removeChild(row);
    hud.addChild(row);
    builder.build(world.root, 320, 180);
    assert.equal(row.box.size[0], width, "a root again, it is laid out as one: what was kept was from before it was a child");
  });

  it("is each root's own: a change under one leaves the other kept; and a builder that reuses nothing keeps none", () => {
    const { world, hud, left } = scene();
    const other = new Flex({ direction: "column", padding: 3 });
    other.addChild(new Text({ text: "PAUSED", size: 10 }));
    other.transform.y = 40;
    hud.addChild(other);
    const builder = builderFor();
    for (let i = 0; i < 3; i++) builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 2);
    left.text = "GOLD 77";
    left.markChanged();
    builder.build(world.root, 320, 180);
    assert.equal(builder.keptLayouts, 1);

    const plain = builderFor(false);
    for (let i = 0; i < 3; i++) plain.build(world.root, 320, 180);
    assert.equal(plain.keptLayouts, 0);
  });
});
