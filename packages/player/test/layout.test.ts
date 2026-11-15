import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Entity, Flex, Shape, Sprite, Text, type FlexProps, type GameObject } from "@tsengine/runtime";

import { Layouter, type MeasuredSize } from "../src/layout.ts";

/** A shape that can be laid out smaller than it is, as a wrapping text can (its minimum is its widest word). */
class Squishy extends Shape {
  smallestWidth: number;
  smallestHeight: number;

  constructor(width: number, height: number, smallestWidth: number, smallestHeight = height) {
    super({ kind: "rect", width, height });
    this.smallestWidth = smallestWidth;
    this.smallestHeight = smallestHeight;
  }
}

/** Shapes measure as their width and height, a Text as 10 per character by its size, a Sprite as 16 × 16. */
const host = {
  measure(object: GameObject, out: MeasuredSize): boolean {
    if (object instanceof Shape) {
      out.width = object.width;
      out.height = object.height;
      if (object instanceof Squishy) {
        out.minWidth = object.smallestWidth;
        out.minHeight = object.smallestHeight;
      }
      return true;
    }
    if (object instanceof Text) {
      out.width = object.text.length * 10;
      out.height = object.size;
      return true;
    }
    if (object instanceof Sprite) {
      out.width = 16;
      out.height = 16;
      return true;
    }
    return false;
  },
  warn(): void {},
};

const box = (width: number, height: number): Shape => new Shape({ kind: "rect", width, height });

function flex(props: FlexProps, ...children: GameObject[]): Flex {
  const f = new Flex(props);
  for (const child of children) f.addChild(child);
  return f;
}

function lay(root: Flex, width = 1000, height = 1000): Flex {
  new Layouter(host).layout(root, width, height);
  return root;
}

const size = (f: Flex): [number, number] => [f.box.size[0] as number, f.box.size[1] as number];
const at = (o: GameObject): [number, number] => [o.layoutX, o.layoutY];

describe("layout: fit sizes", () => {
  it("fits a row to its children plus padding and the gaps between them", () => {
    const a = box(10, 5);
    const b = box(20, 8);
    const row = lay(flex({ padding: 4, gap: 2 }, a, b));
    assert.deepEqual(size(row), [4 + 10 + 2 + 20 + 4, 4 + 8 + 4]);
    assert.deepEqual(at(a), [4, 4]);
    assert.deepEqual(at(b), [16, 4]);
  });

  it("fits a column the same way on the other axis", () => {
    const a = box(10, 5);
    const b = box(20, 8);
    const column = lay(flex({ direction: "column", padding: 4, gap: 2 }, a, b));
    assert.deepEqual(size(column), [4 + 20 + 4, 4 + 5 + 2 + 8 + 4]);
    assert.deepEqual(at(a), [4, 4]);
    assert.deepEqual(at(b), [4, 11]);
  });

  it("counts gaps between children, not around them: one gap for two, none for one, none for none", () => {
    assert.equal(size(lay(flex({ gap: 5 }, box(1, 1), box(1, 1))))[0], 7);
    assert.equal(size(lay(flex({ gap: 5 }, box(1, 1))))[0], 1);
    assert.deepEqual(size(lay(flex({ gap: 5, padding: 3 }))), [6, 6]);
  });

  it("takes a side's padding from the side, else the axis, else padding", () => {
    const a = box(10, 10);
    const f = lay(flex({ padding: 1, paddingX: 2, paddingY: 3, paddingLeft: 7, paddingBottom: 9 }, a));
    // left 7, right 2 (paddingX), top 3 (paddingY), bottom 9
    assert.deepEqual(size(f), [7 + 10 + 2, 3 + 10 + 9]);
    assert.deepEqual(at(a), [7, 3]);
    const plain = lay(flex({ padding: 5 }, box(1, 1)));
    assert.deepEqual(size(plain), [11, 11]);
  });

  it("clamps a fit size to its minimum and maximum, on both axes", () => {
    assert.deepEqual(size(lay(flex({ minWidth: 50, minHeight: 30 }, box(10, 10)))), [50, 30]);
    assert.deepEqual(size(lay(flex({ maxWidth: 15, maxHeight: 4 }, box(10, 10), box(10, 10)))), [15, 4]);
  });

  it("uses a number as an exact size, whatever is inside, and a percentage of the available box for a root", () => {
    assert.deepEqual(size(lay(flex({ width: 100, height: 40 }, box(300, 300)))), [100, 40]);
    assert.deepEqual(size(lay(flex({ width: "50%", height: "25%" }, box(1, 1)), 200, 400)), [100, 100]);
  });

  it("makes a root that grows the available box, and no smaller than its content", () => {
    assert.deepEqual(size(lay(flex({ width: "grow", height: "grow" }, box(10, 10)), 320, 180)), [320, 180]);
    assert.deepEqual(size(lay(flex({ width: "grow", height: "grow" }, box(500, 10)), 320, 180)), [500, 180]);
    assert.deepEqual(size(lay(flex({ width: "grow", maxWidth: 200 }, box(10, 10)), 320, 180)), [200, 10]);
  });

  it("falls back to fit, warning once, for a size it cannot read", () => {
    const warnings: string[] = [];
    const layouter = new Layouter({ ...host, warn: (key, message) => warnings.push(`${key}|${message}`) });
    const bad = flex({ width: "grwo" as never }, box(10, 10));
    layouter.layout(bad, 100, 100);
    layouter.layout(bad, 100, 100);
    assert.equal(bad.box.size[0], 10);
    assert.equal(warnings.length, 1, "the size is read once, not every frame");
    assert.match(warnings[0]!, /"grwo"/);
  });
});

describe("layout: growing", () => {
  it("shares a row's free space equally among growing children", () => {
    const a = flex({ width: "grow" });
    const fixed = flex({ width: 20 });
    const b = flex({ width: "grow" });
    const row = lay(flex({ width: 100 }, a, fixed, b));
    assert.deepEqual([a.box.size[0], fixed.box.size[0], b.box.size[0]], [40, 20, 40]);
    assert.deepEqual([a.layoutX, fixed.layoutX, b.layoutX], [0, 40, 60]);
    assert.equal(row.box.size[0], 100);
  });

  it("gives space to the smallest child first until it matches the next, then to both", () => {
    const small = flex({ width: "grow" }, box(10, 1));
    const large = flex({ width: "grow" }, box(30, 1));
    lay(flex({ width: 80 }, small, large));
    // free = 80 - 40 = 40: the small one rises to 30 (20), then both take 10 more.
    assert.deepEqual([small.box.size[0], large.box.size[0]], [40, 40]);
    const lopsided = flex({ width: "grow" }, box(10, 1));
    const wide = flex({ width: "grow" }, box(30, 1));
    lay(flex({ width: 60 }, lopsided, wide));
    assert.deepEqual([lopsided.box.size[0], wide.box.size[0]], [30, 30], "free 20 all goes to the smaller one, which reaches 30 and stops");
  });

  it("stops a child at its maximum and gives what it could not take to the others", () => {
    const capped = flex({ width: "grow", maxWidth: 10 });
    const other = flex({ width: "grow" });
    lay(flex({ width: 80 }, capped, other));
    assert.deepEqual([capped.box.size[0], other.box.size[0]], [10, 70]);
    const a = flex({ width: "grow", maxWidth: 25 });
    const b = flex({ width: "grow", maxWidth: 40 });
    const c = flex({ width: "grow" });
    lay(flex({ width: 150 }, a, b, c));
    assert.deepEqual([a.box.size[0], b.box.size[0], c.box.size[0]], [25, 40, 85]);
  });

  it("does not grow a child that is not asked to, and leaves free space when nothing grows", () => {
    const fit = flex({}, box(10, 1));
    lay(flex({ width: 100 }, fit));
    assert.equal(fit.box.size[0], 10);
  });

  it("grows heights in a column the same way, and gaps come out of the free space", () => {
    const a = flex({ height: "grow" });
    const b = flex({ height: "grow" });
    lay(flex({ direction: "column", height: 100, gap: 10, padding: 5 }, a, b));
    assert.deepEqual([a.box.size[1], b.box.size[1]], [40, 40]);
    assert.deepEqual([a.layoutY, b.layoutY], [5, 55]);
  });

  it("makes a growing child take the whole cross size, and a fit one only under alignItems stretch", () => {
    const grower = flex({ height: "grow" });
    const fit = flex({}, box(10, 3));
    const row = flex({ height: 50 }, grower, fit);
    lay(row);
    assert.equal(grower.box.size[1], 50);
    assert.equal(fit.box.size[1], 50, "stretch is the default");
    const centred = flex({ height: 50, alignItems: "center" }, flex({}, box(10, 3)));
    lay(centred);
    assert.equal((centred.children[0] as Flex).box.size[1], 3);
  });

  it("takes a share of the parent's inner size for a percentage, minus gaps along the main axis", () => {
    const half = flex({ width: "50%", height: "50%" });
    const rest = flex({ width: "grow" });
    lay(flex({ width: 110, height: 60, gap: 10 }, half, rest));
    assert.deepEqual([half.box.size[0], half.box.size[1]], [50, 30], "(110 - 10) / 2 wide, half of 60 high");
    assert.equal(rest.box.size[0], 50);
  });

  it("holds a minimum and maximum across the axis too", () => {
    const tall = flex({ height: "grow", maxHeight: 20 });
    const short = flex({ height: "grow", minHeight: 5 }, box(1, 1));
    lay(flex({ height: 50 }, tall, short));
    assert.deepEqual([tall.box.size[1], short.box.size[1]], [20, 50]);
  });
});

describe("layout: shrinking", () => {
  const cell = (width: number, smallest: number, props: FlexProps = {}): Flex => flex(props, new Squishy(width, 4, smallest));

  it("takes back what overflows from the largest box first, until it matches the next, then from both", () => {
    const a = cell(80, 20);
    const b = cell(60, 20);
    lay(flex({ width: 100 }, a, b));
    // 140 in 100: a shrinks to 60 (20), then both give 10 more.
    assert.deepEqual([a.box.size[0], b.box.size[0]], [50, 50]);
    assert.deepEqual([a.layoutX, b.layoutX], [0, 50], "later boxes close up behind a shrunk one");
  });

  it("stops a box at its minimum and takes the rest from the others", () => {
    const a = cell(80, 70);
    const b = cell(60, 20);
    lay(flex({ width: 100 }, a, b));
    assert.deepEqual([a.box.size[0], b.box.size[0]], [70, 30]);
  });

  it("counts the gaps and padding the row keeps", () => {
    const a = cell(50, 10);
    const b = cell(50, 10);
    lay(flex({ width: 80, gap: 10, padding: 5 }, a, b));
    // inner 70, gap 10, 60 left for 100: each gives 20.
    assert.deepEqual([a.box.size[0], b.box.size[0]], [30, 30]);
  });

  it("shrinks heights in a column the same way", () => {
    const a = flex({ direction: "column" }, new Squishy(5, 80, 5, 20));
    const b = flex({ direction: "column" }, new Squishy(5, 60, 5, 20));
    lay(flex({ direction: "column", height: 100 }, a, b));
    assert.deepEqual([a.box.size[1], b.box.size[1]], [50, 50]);
  });

  it("shrinks a growing box too, but not a fixed or percentage one, and never a leaf", () => {
    const grow = cell(60, 10, { width: "grow" });
    const fixed = flex({ width: 40 });
    const leaf = new Squishy(30, 4, 5);
    lay(flex({ width: 100 }, grow, fixed, leaf));
    // 130 in 100: only `grow` can give way.
    assert.deepEqual([grow.box.size[0], fixed.box.size[0]], [30, 40]);
    assert.equal(leaf.layoutX, 70);
  });

  it("lets what still does not fit overflow, at the boxes' minimums", () => {
    const a = cell(80, 60);
    const b = cell(80, 60);
    const row = lay(flex({ width: 100 }, a, b));
    assert.deepEqual([a.box.size[0], b.box.size[0]], [60, 60]);
    assert.equal(b.layoutX + (b.box.size[0] as number), 120, "past the row's 100");
    assert.equal(row.box.size[0], 100);
  });

  it("does not shrink a box that fits, or one with nothing to give", () => {
    const a = cell(30, 10);
    const b = flex({}, box(70, 4));
    lay(flex({ width: 100 }, a, b));
    assert.deepEqual([a.box.size[0], b.box.size[0]], [30, 70]);
    const c = flex({}, box(90, 4));
    const d = flex({}, box(90, 4));
    lay(flex({ width: 100 }, c, d));
    assert.deepEqual([c.box.size[0], d.box.size[0]], [90, 90], "leaves cannot shrink, so their boxes cannot either");
  });

  it("places a shrunk box's own children inside its new size", () => {
    const leaf = new Squishy(80, 4, 20);
    const a = flex({ justifyContent: "end" }, leaf);
    const b = cell(60, 20);
    lay(flex({ width: 100 }, a, b));
    assert.equal(a.box.size[0], 50);
    assert.equal(leaf.layoutX, 50 - 80, "the leaf keeps its size and, ended in a smaller box, overflows its start");
  });
});

describe("layout: positions", () => {
  const gather = (
    direction: "row" | "column",
    alignItems: FlexProps["alignItems"],
    justifyContent: FlexProps["justifyContent"]
  ): [number, number][] => {
    const kids = [box(10, 4), box(20, 8), box(10, 6)];
    lay(flex({ direction, alignItems, justifyContent, width: 100, height: 60, gap: 5 }, ...kids));
    return kids.map(at);
  };

  it("places a row's children by justifyContent along x (inner 100, used 40 + 10 gaps = 50, free 50)", () => {
    assert.deepEqual(
      gather("row", "start", "start").map((p) => p[0]),
      [0, 15, 40]
    );
    assert.deepEqual(
      gather("row", "start", "center").map((p) => p[0]),
      [25, 40, 65]
    );
    assert.deepEqual(
      gather("row", "start", "end").map((p) => p[0]),
      [50, 65, 90]
    );
    assert.deepEqual(
      gather("row", "start", "space-between").map((p) => p[0]),
      [0, 40, 90]
    );
    // Offsets are whole pixels: 50 / 6 = 8.33 -> 8, 8.33 + 10 + 16.67 + 5 = 40 and so on.
    assert.deepEqual(
      gather("row", "start", "space-around").map((p) => p[0]),
      [Math.round(50 / 6), Math.round(50 / 6 + 10 + 50 / 3 + 5), Math.round(50 / 6 + 10 + 5 + 20 + 2 * (50 / 3) + 5)]
    );
    assert.deepEqual(
      gather("row", "start", "space-evenly").map((p) => p[0]),
      [13, Math.round(12.5 + 10 + 12.5 + 5), Math.round(12.5 + 10 + 5 + 12.5 + 20 + 12.5 + 5)]
    );
  });

  it("places a column's children by justifyContent along y (inner 60, used 18 + 10 = 28, free 32)", () => {
    assert.deepEqual(
      gather("column", "start", "start").map((p) => p[1]),
      [0, 9, 22]
    );
    assert.deepEqual(
      gather("column", "start", "center").map((p) => p[1]),
      [16, 25, 38]
    );
    assert.deepEqual(
      gather("column", "start", "end").map((p) => p[1]),
      [32, 41, 54]
    );
    assert.deepEqual(
      gather("column", "start", "space-between").map((p) => p[1]),
      [0, 9 + 16, 22 + 32]
    );
  });

  it("places children across the main axis by alignItems", () => {
    assert.deepEqual(
      gather("row", "start", "start").map((p) => p[1]),
      [0, 0, 0]
    );
    assert.deepEqual(
      gather("row", "stretch", "start").map((p) => p[1]),
      [0, 0, 0],
      "a leaf keeps its size, so stretch puts it at the start"
    );
    assert.deepEqual(
      gather("row", "center", "start").map((p) => p[1]),
      [28, 26, 27]
    );
    assert.deepEqual(
      gather("row", "end", "start").map((p) => p[1]),
      [56, 52, 54]
    );
    assert.deepEqual(
      gather("column", "center", "start").map((p) => p[0]),
      [45, 40, 45]
    );
    assert.deepEqual(
      gather("column", "end", "start").map((p) => p[0]),
      [90, 80, 90]
    );
  });

  it("falls back to start for space-between, -around and -evenly when there is no free space, and overflows centred or ended content", () => {
    const kids = [box(60, 1), box(60, 1)];
    lay(flex({ width: 100, justifyContent: "space-between" }, ...kids));
    assert.deepEqual(
      kids.map((k) => k.layoutX),
      [0, 60]
    );
    const overflow = [box(60, 1), box(60, 1)];
    lay(flex({ width: 100, justifyContent: "center" }, ...overflow));
    assert.deepEqual(
      overflow.map((k) => k.layoutX),
      [-10, 50]
    );
  });

  it("covers every direction, alignItems and justifyContent combination without producing a non-number", () => {
    for (const direction of ["row", "column"] as const) {
      for (const alignItems of ["start", "center", "end", "stretch"] as const) {
        for (const justifyContent of ["start", "center", "end", "space-between", "space-around", "space-evenly"] as const) {
          for (const p of gather(direction, alignItems, justifyContent))
            assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${direction} ${alignItems} ${justifyContent}`);
        }
      }
    }
  });

  it("lays out nested boxes: an inner row's position and its own children's", () => {
    const leaf = box(10, 10);
    const inner = flex({ padding: 3 }, leaf);
    const outer = lay(flex({ padding: 5, direction: "column", gap: 2 }, box(30, 4), inner));
    assert.deepEqual(size(inner), [30, 16], "a column's default alignItems stretches a fit box across it");
    assert.deepEqual(size(outer), [5 + 30 + 5, 5 + 4 + 2 + 16 + 5]);
    assert.deepEqual(at(inner), [5, 11]);
    assert.deepEqual(at(leaf), [3, 3], "relative to its parent, as every layout offset is");
    assert.deepEqual(inner.worldTransform(), { x: 5, y: 11, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it("composes a child's own transform within its slot, without moving its neighbours", () => {
    const a = box(10, 10);
    const b = box(10, 10);
    const row = flex({ gap: 4 }, a, b);
    lay(row);
    const before = at(b);
    a.transform.x = 100;
    a.transform.y = -3;
    lay(row);
    assert.deepEqual(at(b), before, "b did not move");
    assert.deepEqual(at(a), [0, 0], "the slot is unchanged");
    assert.deepEqual([a.worldTransform().x, a.worldTransform().y], [100, -3], "the child is moved within it");
  });
});

describe("layout: whole pixels", () => {
  it("rounds a centred child's offset to a whole pixel, so it is not blurred by half a pixel", () => {
    const a = box(7, 5); // 7 wide in a 20 box: (20 - 7) / 2 = 6.5
    const row = flex({ width: 20, height: 10, alignItems: "center", justifyContent: "center" }, a);
    lay(row);
    assert.deepEqual(at(a), [7, 3], "6.5 -> 7 and 2.5 -> 3");
    const b = box(7, 6);
    lay(flex({ width: 20, height: 10, alignItems: "center", justifyContent: "center" }, b));
    assert.deepEqual(at(b), [7, 2]);
  });

  it("keeps every offset whole through nesting, so a deep child lands on a pixel too", () => {
    const leaf = box(3, 3);
    const inner = flex({ width: 11, height: 11, alignItems: "center", justifyContent: "center" }, leaf);
    const outer = flex({ width: 30, height: 30, alignItems: "center", justifyContent: "center" }, inner);
    lay(outer);
    assert.ok(Number.isInteger(inner.layoutX) && Number.isInteger(inner.layoutY), `${at(inner)}`);
    assert.ok(Number.isInteger(leaf.layoutX) && Number.isInteger(leaf.layoutY), `${at(leaf)}`);
    assert.ok(Number.isInteger(leaf.worldTransform().x) && Number.isInteger(leaf.worldTransform().y));
  });

  it("rounds each offset from the exact running position, so a row of odd widths does not drift", () => {
    const kids = [box(1, 3), box(1, 3), box(1, 3), box(1, 3)];
    lay(flex({ width: 103, justifyContent: "space-between" }, ...kids));
    // Free space 99 in three gaps of 33 -> exactly on pixels, no drift.
    assert.deepEqual(
      kids.map((k) => k.layoutX),
      [0, 34, 68, 102]
    );
    const more = [box(1, 3), box(1, 3), box(1, 3)];
    lay(flex({ width: 11, justifyContent: "space-between" }, ...more));
    assert.deepEqual(
      more.map((k) => k.layoutX),
      [0, 5, 10],
      "(11 - 3) / 2 = 4 between each: 0, 5, 10"
    );
    const odd = [box(1, 3), box(1, 3), box(1, 3)];
    lay(flex({ width: 10, justifyContent: "space-between" }, ...odd));
    assert.deepEqual(
      odd.map((k) => k.layoutX),
      [0, 5, 9],
      "3.5 between each: 0, 4.5 -> 5, 9"
    );
  });

  it("leaves sizes exact: only positions are snapped", () => {
    const grown = flex({ width: "grow" });
    lay(flex({ width: 11 }, grown, flex({ width: "grow" }), flex({ width: "grow" })));
    assert.equal(grown.box.size[0], 11 / 3);
  });
});

describe("layout: what a child is", () => {
  it("sizes an Entity (a component) by the bounding box of its children, and puts that box, not its origin, in the slot", () => {
    const sprite = new Sprite({ image: "a.png" });
    sprite.transform.x = -8;
    sprite.transform.y = -8;
    const component = new Entity();
    component.addChild(sprite);
    const other = box(10, 10);
    const row = lay(flex({ gap: 4 }, component, other));
    assert.deepEqual(size(row), [16 + 4 + 10, 16]);
    assert.deepEqual(at(component), [8, 8], "shifted so its drawing, which starts at -8, starts at the slot");
    assert.deepEqual([component.worldTransform().x + sprite.transform.x, sprite.worldTransform().y], [0, 0]);
    assert.deepEqual(at(other), [20, 0]);
  });

  it("includes every child of an Entity, at its own position", () => {
    const parent = new Entity();
    const a = box(10, 10);
    const b = box(10, 10);
    b.transform.x = 30;
    b.transform.y = 5;
    parent.addChild(a);
    parent.addChild(b);
    const row = lay(flex({}, parent));
    assert.deepEqual(size(row), [40, 15]);
  });

  it("counts a Flex inside an Entity at its fit size", () => {
    const inner = flex({ padding: 2 }, box(10, 10));
    const wrapper = new Entity();
    wrapper.addChild(inner);
    assert.deepEqual(size(lay(flex({}, wrapper))), [14, 14]);
  });

  it("measures a Text by its measured width and line height", () => {
    assert.deepEqual(size(lay(flex({}, new Text({ text: "Hello", size: 12 })))), [50, 12]);
  });

  it("gives a child that draws nothing no size", () => {
    assert.deepEqual(size(lay(flex({ gap: 5, padding: 1 }, new Entity(), box(10, 10)))), [1 + 0 + 5 + 10 + 1, 12]);
  });
});

describe("layout: keeping the numbers", () => {
  it("reuses its working arrays from frame to frame, growing them only for more children", () => {
    const row = flex({}, box(1, 1), box(2, 2));
    lay(row);
    const sizes = row.box.childSize[0];
    for (let i = 0; i < 100; i++) lay(row);
    assert.equal(row.box.childSize[0], sizes, "the same array");
    for (let i = 0; i < 20; i++) row.addChild(box(1, 1));
    lay(row);
    assert.notEqual(row.box.childSize[0], sizes, "grown once for the new children");
    const grown = row.box.childSize[0];
    lay(row);
    assert.equal(row.box.childSize[0], grown);
  });

  it("reflows when children are added or removed", () => {
    const a = box(10, 10);
    const b = box(10, 10);
    const row = flex({ gap: 2 }, a, b);
    lay(row);
    assert.equal(b.layoutX, 12);
    const c = box(30, 10);
    row.addChild(c);
    row.removeChild(a);
    lay(row);
    assert.deepEqual([b.layoutX, c.layoutX], [0, 12]);
    assert.equal(row.box.size[0], 10 + 2 + 30);
  });
});

describe("layout: floating boxes", () => {
  const badge = (props: FlexProps = {}): Flex => flex({ float: true, width: 10, height: 6, ...props });

  it("takes no space: no size, no gap, no effect on its siblings or the parent's fit size", () => {
    const plain = lay(flex({ gap: 5, padding: 2 }, box(20, 10), box(30, 10)));
    const parent = flex({ gap: 5, padding: 2 }, box(20, 10), badge({ width: 100, height: 100 }), box(30, 10));
    lay(parent);
    assert.deepEqual(size(parent), size(plain));
    assert.deepEqual(
      at(parent.children[2] as GameObject),
      at(plain.children[1] as GameObject),
      "the second box sits where it would without the badge"
    );
  });

  it("does not count as a child for justifyContent", () => {
    const parent = flex({ width: 100, height: 20, justifyContent: "space-between" }, box(10, 10), badge(), box(10, 10));
    lay(parent);
    assert.deepEqual(
      [parent.children[0], parent.children[2]].map((c) => at(c as GameObject)),
      [
        [0, 0],
        [90, 0],
      ]
    );
  });

  it("is attached by each of its nine points to each of the parent's nine", () => {
    const points = [
      ["top-left", 0, 0],
      ["top-center", 0.5, 0],
      ["top-right", 1, 0],
      ["center-left", 0, 0.5],
      ["center", 0.5, 0.5],
      ["center-right", 1, 0.5],
      ["bottom-left", 0, 1],
      ["bottom-center", 0.5, 1],
      ["bottom-right", 1, 1],
    ] as const;
    for (const [to, tx, ty] of points) {
      for (const [anchor, ax, ay] of points) {
        const f = badge({ anchor, to }); // 10 × 6 in a 100 × 60 parent
        lay(flex({ width: 100, height: 60 }, f));
        assert.deepEqual(at(f), [Math.round(100 * tx - 10 * ax), Math.round(60 * ty - 6 * ay)], `${anchor} on ${to}`);
      }
    }
  });

  it("defaults to its top-left on the parent's top-left, and moves by its offset", () => {
    const f = badge();
    lay(flex({ width: 100, height: 60, padding: 8 }, f));
    assert.deepEqual(at(f), [0, 0], "the parent's corner, not inside its padding");
    const g = badge({ anchor: "top-right", to: "top-right", offsetX: -2, offsetY: 3 });
    lay(flex({ width: 100, height: 60 }, g));
    assert.deepEqual(at(g), [88, 3]);
  });

  it("is sized like any box, against the parent's inner size for grow and percentages", () => {
    const grown = badge({ width: "grow", height: "50%" });
    lay(flex({ width: 100, height: 60, padding: 10 }, box(5, 5), grown));
    assert.deepEqual(size(grown), [80, 20]);
    const fitted = flex({ float: true }, box(12, 7));
    lay(flex({ width: 100, height: 60 }, fitted));
    assert.deepEqual(size(fitted), [12, 7]);
  });

  it("lays out its own children, and a floating box can hold another", () => {
    const inner = badge({ anchor: "bottom-right", to: "center" });
    const outer = flex({ float: true, width: 40, height: 20, gap: 2 }, box(8, 8), box(8, 8), inner);
    const root = flex({ width: 100, height: 100 }, outer);
    lay(root);
    assert.deepEqual(at(outer), [0, 0]);
    assert.deepEqual(at(outer.children[1] as GameObject), [10, 0]);
    assert.deepEqual(at(inner), [20 - 10, 10 - 6]);
  });

  it("hangs a floating root off the available box (a HUD's, the screen's)", () => {
    const f = badge({ anchor: "bottom-right", to: "bottom-right", offsetX: -4, offsetY: -4 });
    lay(f, 320, 180);
    assert.deepEqual(at(f), [306, 170]);
    const centred = badge({ anchor: "center", to: "center" });
    lay(centred, 320, 180);
    assert.deepEqual(at(centred), [155, 87]);
  });

  it("warns once about an anchor it does not know, and uses the top-left", () => {
    const warnings: string[] = [];
    const f = badge({ anchor: "middle" as never });
    new Layouter({ ...host, warn: (key) => warnings.push(key) }).layout(flex({ width: 50, height: 50 }, f), 100, 100);
    assert.deepEqual([...new Set(warnings)], ["flex-anchor:middle"], "the player's Warner says each key once");
    assert.deepEqual(at(f), [0, 0]);
  });
});

/** What a compiled component whose root is another component is: a bare container that layout sees through. */
class Contents extends Entity {
  override readonly layoutContents = true;
}

describe("layoutContents", () => {
  it("lays out a see-through container's children as the Flex's own: they grow, gap and stack as if it were not there", () => {
    const panel = flex({ width: "grow", height: 10 });
    const wrapper = new Contents();
    wrapper.addChild(panel);
    const nested = new Contents();
    const inner = new Contents();
    const second = box(20, 5);
    inner.addChild(second);
    nested.addChild(inner);
    const root = lay(flex({ direction: "column", width: 80, gap: 2, padding: 4 }, wrapper, nested, box(30, 5)));
    assert.deepEqual(size(panel), [72, 10], "the panel grows to the column, through the wrapper");
    assert.deepEqual(at(panel), [4, 4]);
    assert.deepEqual(at(second), [4, 16], "nested wrappers flatten too");
    assert.deepEqual(at(wrapper), [0, 0], "the wrapper itself is not placed");
    assert.deepEqual(size(root), [80, 4 + 10 + 2 + 5 + 2 + 5 + 4]);
  });
});
