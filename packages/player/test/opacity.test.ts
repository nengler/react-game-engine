import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Flex, Hud, Shape, Sprite, Text, getSoundSink, type FlexProps, type GameObject } from "@rge/runtime";
import { FrameBuilder } from "../src/draw.ts";
import { createPlayer } from "../src/loop.ts";
import { KEYS, RGE_IN_LEN } from "../src/protocol.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

function draw(root: GameObject, retain = false): DecodedRecord[] {
  const backend = new RecordingBackend({ textureSizes: { "assets/hero.png": { width: 20, height: 10 }, "assets/font.png": { width: 160, height: 96 } } });
  const builder = new FrameBuilder({
    loadTexture: (path) => backend.loadTexture(path),
    textureSize: (handle) => backend.textureSize(handle) ?? { width: 0, height: 0 },
    measureText: (text, size) => ({ width: text.length * 8, height: size }),
    ...(retain ? { retain: "check" as const } : {}),
  });
  const built = builder.build(root, 400, 300);
  backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return [...backend.lastFrame.records];
}

const shape = (color: string, w = 10, h = 10): Shape => new Shape({ kind: "rect", width: w, height: h, color });
function flex(props: FlexProps, ...children: GameObject[]): Flex {
  const f = new Flex({ width: 60, height: 40, ...props });
  for (const child of children) f.addChild(child);
  return f;
}
/** The colour of every record that has one, in draw order. */
const colors = (records: readonly DecodedRecord[]): string[] =>
  records.flatMap((r) => (r.op === "rect" || r.op === "ellipse" || r.op === "text" ? [r.color] : r.op === "box" ? [r.fill, r.borderColor] : r.op === "spriteRegion" ? [r.tint] : []));

describe("<Flex opacity>", () => {
  it("draws a box with no opacity, or an opacity of 1, exactly as it always did", () => {
    const plain = colors(draw(flex({ background: "red" }, shape("white"))));
    assert.deepEqual(plain, ["#ff0000ff", "#ffffffff"]);
    assert.deepEqual(colors(draw(flex({ background: "red", opacity: 1 }, shape("white")))), plain);
  });

  it("multiplies the alpha of the box's own colours and of everything under it, leaving the red, green and blue alone", () => {
    const f = flex({ background: "red", opacity: 0.5 }, shape("white"), new Text({ text: "Hi", size: 10, color: "#0000ff" }));
    assert.deepEqual(colors(draw(f)), ["#ff000080", "#ffffff80", "#0000ff80"]);
  });

  it("fades a border and its fill, both in a box record", () => {
    const f = flex({ background: "red", borderWidth: 2, borderColor: "blue", borderRadius: 4, opacity: 0.5 });
    assert.deepEqual(colors(draw(f)), ["#ff000080", "#0000ff80"]);
  });

  it("scales a colour that already has an alpha", () => {
    assert.deepEqual(colors(draw(flex({ background: "#ff000080", opacity: 0.5 }))), ["#ff000040"]);
  });

  it("goes to a box inside it too, multiplying: 0.5 inside 0.5 is 0.25", () => {
    const inner = flex({ background: "red", opacity: 0.5, width: 20, height: 20 }, shape("white"));
    const outer = flex({ opacity: 0.5 }, inner, shape("blue"));
    assert.deepEqual(colors(draw(outer)), ["#ff000040", "#ffffff40", "#0000ff80"], "the inner box and its child at 0.25, the shape after it at 0.5");
  });

  it("is only for the box and what is in it: a sibling after it is as it was", () => {
    const root = new Entity();
    root.addChild(flex({ background: "red", opacity: 0.5 }, shape("white")));
    root.addChild(shape("blue"));
    root.addChild(flex({ background: "green" }, shape("gray")));
    assert.deepEqual(colors(draw(root)), ["#ff000080", "#ffffff80", "#0000ffff", "#008000ff", "#808080ff"]);
  });

  it("restores the opacity after a box with nothing in it, and after one in a Hud", () => {
    const root = new Entity();
    root.addChild(flex({ background: "red", opacity: 0.5 }));
    root.addChild(shape("blue"));
    const hud = new Hud();
    hud.addChild(flex({ background: "red", opacity: 0.25 }, shape("white")));
    hud.addChild(shape("green"));
    root.addChild(hud);
    assert.deepEqual(colors(draw(root)), ["#ff000080", "#0000ffff", "#ff000040", "#ffffff40", "#008000ff"]);
  });

  it("fades a shape that is the first child at no offset, which is written in place when nothing is faded", () => {
    const f = flex({ opacity: 0.5 }, shape("white"));
    assert.equal((f.children[0] as Shape).layoutX, 0);
    assert.deepEqual(colors(draw(f)), ["#ffffff80"]);
  });

  it("draws a plain sprite as a tinted region of itself, so it can fade, and a styled one with its own opacity on top", () => {
    const plain = new Sprite({ image: "hero.png" });
    const records = draw(flex({ opacity: 0.5 }, plain));
    const region = records.find((r) => r.op === "spriteRegion");
    assert.ok(region?.op === "spriteRegion");
    assert.deepEqual([region.texture, region.srcX, region.srcY, region.srcW, region.srcH, region.tint], ["assets/hero.png", 0, 0, 20, 10, "#ffffff80"]);
    assert.equal(records.filter((r) => r.op === "sprite").length, 0);
    const own = new Sprite({ image: "hero.png", opacity: 0.5 });
    const both = draw(flex({ opacity: 0.5 }, own)).find((r) => r.op === "spriteRegion");
    assert.equal(both?.op === "spriteRegion" ? both.tint : "", "#ffffff40");
  });

  it("leaves a sprite outside a faded box a plain sprite record", () => {
    const records = draw(flex({}, new Sprite({ image: "hero.png" })));
    assert.equal(records.filter((r) => r.op === "sprite").length, 1);
  });

  it("fades the glyphs of a bitmap font", () => {
    const f = flex({ opacity: 0.5 }, new Text({ text: "AB", font: "font.png", color: "red" }));
    assert.deepEqual(colors(draw(f)), ["#ff000080", "#ff000080"]);
  });

  it("draws nothing at 0, for the box and for what is in it, and still draws what is beside it", () => {
    const root = new Entity();
    root.addChild(flex({ background: "red", opacity: 0 }, shape("white"), new Sprite({ image: "hero.png" })));
    root.addChild(shape("blue"));
    assert.deepEqual(draw(root).map((r) => r.op), ["view", "rect"]);
  });

  it("uses an opacity as 0 to 1: more is 1, less is 0, and something that is not a number is 1", () => {
    for (const [opacity, expected] of [[2, "#ff0000ff"], [-1, undefined], [Number.NaN, "#ff0000ff"], [Number.POSITIVE_INFINITY, "#ff0000ff"], [Number.NEGATIVE_INFINITY, undefined]] as const) {
      assert.deepEqual(colors(draw(flex({ background: "red", opacity }))), expected === undefined ? [] : [expected], String(opacity));
    }
  });

  it("is still laid out and still takes the mouse at 0", () => {
    const f = flex({ opacity: 0, onPress: () => {} }, shape("white"));
    const built = new FrameBuilder({ loadTexture: () => 0 }).build(f, 400, 300);
    assert.deepEqual(f.box.size, new Float64Array([60, 40]));
    assert.deepEqual(built.pointers, [f]);
  });

  it("works with a clip and with z: the clip is still there, and a child's own z does not undo the fade", () => {
    const high = shape("white");
    high.transform.z = 5;
    const f = flex({ opacity: 0.5, overflow: "hidden" }, high, shape("blue"));
    const records = draw(f);
    assert.ok(records.some((r) => r.op === "scissor"));
    assert.deepEqual(colors(records).sort(), ["#0000ff80", "#ffffff80"]);
  });

  it("is the same frame when it is built again from scratch (retain check)", () => {
    const root = new Entity();
    root.addChild(flex({ background: "red", opacity: 0.5 }, shape("white")));
    root.addChild(shape("blue"));
    assert.deepEqual(colors(draw(root, true)), ["#ff000080", "#ffffff80", "#0000ffff"]);
  });
});

describe("<Flex opacity> with a transition, in the loop", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });
  const WINDOW = { width: 200, height: 100, title: "t" };

  /** The alpha (0 to 255) of the box's background after each step; the box is told to go to each opacity in turn. */
  function run(props: FlexProps, opacities: readonly number[]): (number | null)[] {
    const backend = new RecordingBackend();
    const root = new Entity();
    const f = flex({ background: "#ff0000", transition: 0.4, ...props });
    root.addChild(f);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    const seen: (number | null)[] = [];
    for (const opacity of opacities) {
      f.opacity = opacity;
      backend.queueInput({ dt: 0.1 });
      p.step();
      const r = backend.lastFrame.records.find((x) => x.op === "rect" && x.width === 60);
      seen.push(r?.op === "rect" ? parseInt(r.color.slice(7, 9), 16) : null);
    }
    p.close();
    return seen;
  }

  it("fades in the colour the opacity went to, through the values between, and arrives", () => {
    const seen = run({}, [1, 1, 0, 0, 0, 0, 0, 0]);
    assert.equal(seen[0], 255);
    const falling = seen.slice(2).filter((a): a is number => a !== null);
    assert.ok(falling.length >= 2 && falling.every((a, i) => i === 0 || a <= (falling[i - 1] as number)), `getting fainter: ${seen.join(" ")}`);
    assert.ok(seen.some((a) => a !== null && a > 0 && a < 255), "some frame in between");
    assert.equal(seen.at(-1), null, "gone at the end, and nothing drawn for it");
  });

  it("fades back in from nothing, and turns round part way", () => {
    const seen = run({}, [0, 0, 1, 1, 1, 1, 1, 1]);
    assert.equal(seen[0], null);
    assert.equal(seen.at(-1), 255);
    const turned = run({}, [1, 1, 0, 0, 1, 1, 1, 1, 1, 1]);
    assert.equal(turned.at(-1), 255, "back to full after going part way down");
  });

  it("snaps with no transition, as it does for a colour", () => {
    const seen = run({ transition: 0 }, [1, 1, 0.5, 0.5, 0.5]);
    assert.deepEqual(new Set(seen), new Set([255, 128]));
  });

  it("shows the opacity it starts with at once, with nothing to fade from", () => {
    assert.equal(run({}, [0.5, 0.5])[0], 128);
  });
});

describe("transform={{ opacity }}", () => {
  const faded = <T extends GameObject>(object: T, opacity: number): T => {
    object.transform.opacity = opacity;
    return object;
  };

  it("fades an object and everything under it, multiplying down the tree; a sibling is as it was", () => {
    const root = new Entity();
    const group = faded(new Entity(), 0.5);
    group.addChild(shape("white"));
    group.addChild(faded(shape("#ff0000"), 0.5));
    root.addChild(group);
    root.addChild(shape("blue"));
    assert.deepEqual(colors(draw(root)), ["#ffffff80", "#ff000040", "#0000ffff"]);
  });

  it("fades a leaf on its own, and multiplies with a <Flex opacity> above it", () => {
    const root = new Entity();
    root.addChild(faded(shape("white"), 0.5));
    root.addChild(flex({ opacity: 0.5 }, faded(shape("#00ff00"), 0.5)));
    assert.deepEqual(colors(draw(root)), ["#ffffff80", "#00ff0040"]);
  });

  it("fades what is in a <Hud>", () => {
    const root = new Entity();
    const hud = new Hud();
    hud.addChild(faded(shape("white"), 0.5));
    hud.addChild(shape("blue"));
    root.addChild(hud);
    assert.deepEqual(colors(draw(root)), ["#ffffff80", "#0000ffff"]);
  });

  it("is the same frame when built again from scratch (retain check)", () => {
    const root = new Entity();
    const group = faded(new Entity(), 0.25);
    group.addChild(shape("white"));
    root.addChild(group);
    assert.deepEqual(colors(draw(root, true)), ["#ffffff40"]);
  });

  it("follows a change from frame to frame, as a move is reported: no record keeps last frame's alpha", () => {
    const backend = new RecordingBackend();
    const root = new Entity();
    const group = new Entity();
    const leaf = shape("white");
    group.addChild(leaf);
    root.addChild(group);
    root.addChild(shape("blue"));
    const p = createPlayer(backend, { width: 200, height: 100, title: "t", root: () => root, warn: () => {} });
    const seen: string[][] = [];
    const frame = (change: () => void): void => {
      change();
      backend.queueInput({ dt: 1 / 60 });
      p.step();
      seen.push(colors(backend.lastFrame.records));
    };
    frame(() => {});
    frame(() => {});
    frame(() => ((group.transform.opacity = 0.5), group.markMoved()));
    frame(() => {});
    frame(() => ((leaf.transform.opacity = 0.5), leaf.markMoved()));
    frame(() => ((group.transform.opacity = 1), group.markMoved()));
    frame(() => ((leaf.transform.opacity = 1), leaf.markMoved()));
    frame(() => {});
    p.close();
    assert.deepEqual(seen, [
      ["#ffffffff", "#0000ffff"],
      ["#ffffffff", "#0000ffff"],
      ["#ffffff80", "#0000ffff"],
      ["#ffffff80", "#0000ffff"],
      ["#ffffff40", "#0000ffff"],
      ["#ffffff80", "#0000ffff"],
      ["#ffffffff", "#0000ffff"],
      ["#ffffffff", "#0000ffff"],
    ]);
  });
});
