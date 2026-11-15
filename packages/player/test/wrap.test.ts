import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Flex, Shape, type FlexProps, type GameObject } from "@rge/runtime";

import { FrameBuilder } from "../src/draw.ts";
import { Layouter, type MeasuredSize } from "../src/layout.ts";
import { KEYS, RGE_IN_LEN } from "../src/protocol.ts";
import { RecordingBackend } from "../src/recording.ts";

const warnings: string[] = [];
const host = {
  measure(object: GameObject, out: MeasuredSize): boolean {
    if (object instanceof Shape) {
      out.width = object.width;
      out.height = object.height;
      return true;
    }
    return false;
  },
  warn(key: string): void {
    warnings.push(key);
  },
};

const box = (width: number, height: number): Shape => new Shape({ kind: "rect", width, height });
const boxes = (count: number, width = 30, height = 10): Shape[] => Array.from({ length: count }, () => box(width, height));

function flex(props: FlexProps, ...children: GameObject[]): Flex {
  const f = new Flex(props);
  for (const child of children) f.addChild(child);
  return f;
}

function lay(root: Flex, width = 1000, height = 1000): Flex {
  new Layouter(host).layout(root, width, height);
  return root;
}

const at = (kids: readonly GameObject[]): [number, number][] => kids.map((k) => [k.layoutX, k.layoutY]);
const size = (f: Flex): [number, number] => [f.box.size[0] as number, f.box.size[1] as number];

describe("<Flex wrap>", () => {
  it("starts a new line when the next child will not fit, and fills a line exactly when it can", () => {
    // 30 + 5 + 30 + 5 + 30 = 100: three fit exactly, the rest are the next line, 10 + 5 lower
    const f = lay(flex({ wrap: true, width: 100, gap: 5 }, ...boxes(5)));
    assert.deepEqual(at(f.children), [
      [0, 0],
      [35, 0],
      [70, 0],
      [0, 15],
      [35, 15],
    ]);
    assert.deepEqual(size(f), [100, 25], "as tall as its two lines and the gap between");
    assert.deepEqual([...f.box.lineEnd.subarray(0, f.box.lineCount)], [3, 5]);
  });

  it("is one line when everything fits, and no different from a row without wrap", () => {
    const wrapped = lay(flex({ wrap: true, width: 200, gap: 5, padding: 3 }, ...boxes(3)));
    const plain = lay(flex({ width: 200, gap: 5, padding: 3 }, ...boxes(3)));
    assert.deepEqual(at(wrapped.children), at(plain.children));
    assert.deepEqual(size(wrapped), size(plain));
  });

  it("takes columnGap between the children of a line and rowGap between lines, each over gap", () => {
    const f = lay(flex({ wrap: true, width: 70, gap: 99, columnGap: 10, rowGap: 4 }, ...boxes(4)));
    assert.deepEqual(at(f.children), [
      [0, 0],
      [40, 0],
      [0, 14],
      [40, 14],
    ]);
    const onlyGap = lay(flex({ wrap: true, width: 70, gap: 6 }, ...boxes(4)));
    assert.deepEqual(at(onlyGap.children), [
      [0, 0],
      [36, 0],
      [0, 16],
      [36, 16],
    ]);
  });

  it("makes each line as tall as its tallest child, and puts the next one under it", () => {
    const f = lay(flex({ wrap: true, width: 70 }, box(30, 10), box(30, 25), box(30, 5), box(30, 8)));
    assert.deepEqual(at(f.children), [
      [0, 0],
      [30, 0],
      [0, 25],
      [30, 25],
    ]);
    assert.deepEqual(size(f), [70, 33]);
  });

  it("places the children of a line by alignItems inside the line's height", () => {
    const place = (alignItems: FlexProps["alignItems"]) =>
      at(lay(flex({ wrap: true, width: 70, alignItems }, box(30, 10), box(30, 30), box(30, 4), box(30, 4))).children);
    assert.deepEqual(place("start"), [
      [0, 0],
      [30, 0],
      [0, 30],
      [30, 30],
    ]);
    assert.deepEqual(place("center"), [
      [0, 10],
      [30, 0],
      [0, 30 + 0],
      [30, 30],
    ]);
    assert.deepEqual(place("end"), [
      [0, 20],
      [30, 0],
      [0, 30],
      [30, 30],
    ]);
  });

  it("stretches a Flex child to the height of its line, and not beyond", () => {
    const kid = (): Flex => flex({ width: 30 }, box(10, 5));
    const tall = flex({ width: 30 }, box(10, 20));
    const f = lay(flex({ wrap: true, width: 70, alignItems: "stretch" }, kid(), tall, kid(), kid()));
    const [a, b, c, d] = f.children as Flex[];
    assert.deepEqual([a?.box.size[1], b?.box.size[1]], [20, 20], "the short one fills the line of the tall one");
    assert.deepEqual([c?.box.size[1], d?.box.size[1]], [5, 5], "and a line of its own is as tall as it is");
  });

  it("places each line's children by justifyContent on their own, so a short last line is not spread like a full one", () => {
    const place = (justifyContent: FlexProps["justifyContent"]) =>
      at(lay(flex({ wrap: true, width: 100, justifyContent }, ...boxes(5))).children).map(([x]) => x);
    // lines of 3 (90 of 100) and 2 (60 of 100)
    assert.deepEqual(place("start"), [0, 30, 60, 0, 30]);
    assert.deepEqual(place("center"), [5, 35, 65, 20, 50]);
    assert.deepEqual(place("end"), [10, 40, 70, 40, 70]);
    assert.deepEqual(place("space-between"), [0, 35, 70, 0, 70]);
    // 10 free in the first line: 2.5 each side of three, rounded to whole pixels; 40 free in the second: 13.33 around two
    assert.deepEqual(place("space-evenly"), [3, 35, 68, 13, 57]);
  });

  it("counts padding and a border as room inside, for the width of a line and where the first one starts", () => {
    const f = lay(flex({ wrap: true, width: 100, padding: 4, borderWidth: 2, borderColor: "red" }, ...boxes(4)));
    // inner width 100 - 12 = 88: two of 30 fit (60), three do not (90); lines of 2, starting at 6
    assert.deepEqual(at(f.children), [
      [6, 6],
      [36, 6],
      [6, 16],
      [36, 16],
    ]);
    assert.deepEqual(size(f), [100, 6 + 20 + 6]);
  });

  it("puts a child wider than the box alone on a line, where it sticks out", () => {
    const f = lay(flex({ wrap: true, width: 50 }, box(30, 10), box(80, 10), box(20, 10)));
    assert.deepEqual(at(f.children), [
      [0, 0],
      [0, 10],
      [0, 20],
    ]);
    assert.deepEqual(f.box.lineCount, 3);
  });

  it("is as wide as one line and no more when it only fits its children, and wraps when a maxWidth holds it", () => {
    const free = lay(flex({ wrap: true, gap: 5 }, ...boxes(4)));
    assert.deepEqual(size(free), [30 * 4 + 15, 10]);
    const held = lay(flex({ wrap: true, gap: 5, maxWidth: 70 }, ...boxes(4)));
    assert.deepEqual(size(held), [70, 25]);
    assert.deepEqual(at(held.children), [
      [0, 0],
      [35, 0],
      [0, 15],
      [35, 15],
    ]);
  });

  it("gives a percentage child a share of the inner width, not of what a line has left", () => {
    const kid = (): Flex => flex({ width: "50%", height: 10 });
    const f = lay(flex({ wrap: true, width: 100, columnGap: 10 }, kid(), kid(), kid()));
    assert.deepEqual(
      (f.children as Flex[]).map((k) => k.box.size[0]),
      [50, 50, 50]
    );
    assert.deepEqual(
      at(f.children),
      [
        [0, 0],
        [0, 10],
        [0, 20],
      ],
      "two of 50 with a gap of 10 do not fit in 100"
    );
  });

  it("keeps the size of a growing child: a wrapping row does not share space out", () => {
    const grower = flex({ width: "grow" }, box(20, 10));
    lay(flex({ wrap: true, width: 100 }, grower, box(30, 10)));
    assert.equal(grower.box.size[0], 20);
  });

  it("does not count a floating child in a line, and still attaches it to the box", () => {
    const badge = flex({ float: true, anchor: "top-right", to: "top-right", width: 6, height: 6 });
    const f = lay(flex({ wrap: true, width: 70 }, box(30, 10), badge, box(30, 10), box(30, 10)));
    assert.deepEqual(at([f.children[0]!, f.children[2]!, f.children[3]!]), [
      [0, 0],
      [30, 0],
      [0, 10],
    ]);
    assert.deepEqual([badge.layoutX, badge.layoutY], [64, 0]);
  });

  it("warns, and lays a column out in one line as without wrap", () => {
    warnings.length = 0;
    const f = lay(flex({ wrap: true, direction: "column", width: 40, height: 15 }, ...boxes(3)));
    assert.deepEqual(at(f.children), [
      [0, 0],
      [0, 10],
      [0, 20],
    ]);
    assert.ok(warnings.includes("flex-wrap-column"), "the host is told, and keeps it to once");
    warnings.length = 0;
    lay(flex({ wrap: true, direction: "row", width: 40 }, ...boxes(3)));
    assert.deepEqual(warnings, [], "a row says nothing");
  });

  it("is as tall as its lines inside a column that fits its children, and shrinks to its widest child in a row that is short of room", () => {
    const grid = flex({ wrap: true, width: "grow", gap: 5 }, ...boxes(5));
    const column = lay(flex({ direction: "column", width: 100 }, grid, box(20, 7)));
    assert.deepEqual(size(grid), [100, 25]);
    assert.deepEqual(
      at(column.children),
      [
        [0, 0],
        [0, 25],
      ],
      "the thing below it starts under the second line"
    );
    // in a row too short for it, it gives up width down to its widest child, and wraps more
    const squeezed = flex({ wrap: true, width: "grow" }, ...boxes(3));
    lay(flex({ width: 60 }, squeezed, box(20, 10)));
    assert.equal(squeezed.box.size[0], 40, "20 of the row is the box beside it");
    assert.equal(squeezed.box.lineCount, 3, "a line takes one of 30 and a second does not fit in 40");
  });

  it("works out how far a scroll box with a wrapping row can scroll, from its lines", () => {
    const f = lay(flex({ wrap: true, width: 70, height: 20, overflow: "scroll", scrollY: 999 }, ...boxes(8)));
    // lines of 2: four of them, 10 high each, in a box of 20
    assert.deepEqual([...f.box.contentEnd], [60, 40]);
    assert.deepEqual([...f.box.scrollMax], [0, 20]);
    assert.equal(f.scrollY, 20);
    assert.deepEqual(at(f.children.slice(0, 3)), [
      [0, -20],
      [30, -20],
      [0, -10],
    ]);
  });

  it("is laid out the same again, and again after a child is added or removed", () => {
    const f = flex({ wrap: true, width: 100, gap: 5 }, ...boxes(5));
    lay(f);
    const first = at(f.children);
    lay(f);
    assert.deepEqual(at(f.children), first);
    f.addChild(box(30, 10));
    lay(f);
    assert.deepEqual(size(f), [100, 25], "six: two full lines");
    f.removeChild(f.children[0]!);
    f.removeChild(f.children[0]!);
    f.removeChild(f.children[0]!);
    f.removeChild(f.children[0]!);
    lay(f);
    assert.deepEqual(size(f), [100, 10]);
    assert.equal(f.box.lineCount, 1);
  });

  it("lays out a box with no children, or only a floating one", () => {
    assert.deepEqual(size(lay(flex({ wrap: true, width: 50, padding: 2 }))), [50, 4]);
    const lonely = lay(flex({ wrap: true, width: 50 }, flex({ float: true, width: 5, height: 5 })));
    assert.equal(lonely.box.lineCount, 0);
  });

  it("is drawn where it is laid out, in a frame, with the box's own background behind", () => {
    const f = flex({ wrap: true, width: 70, columnGap: 4, rowGap: 6, background: "navy" }, ...boxes(3));
    const backend = new RecordingBackend();
    const built = new FrameBuilder({ loadTexture: () => 0 }).build(f, 400, 300);
    backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
    const rects = backend.lastFrame.records.flatMap((r) => (r.op === "rect" ? [[r.x, r.y, r.width, r.height]] : []));
    assert.deepEqual(rects, [
      [0, 0, 70, 26],
      [0, 0, 30, 10],
      [34, 0, 30, 10],
      [0, 16, 30, 10],
    ]);
  });
});
