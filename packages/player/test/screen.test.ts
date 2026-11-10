import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Camera, Entity, GameObject, Pointer, Screen, Shape, getSoundSink, World, type InputState, type ScreenProps, type ViewTransform } from "@rge/runtime";
import { FrameBuilder } from "../src/draw.ts";
import { createPlayer } from "../src/loop.ts";
import { KEYS, RGE_IN_LEN } from "../src/protocol.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";
import { borderRects, fitScreen, onScreen, viewToWindow, type ScreenPlacement } from "../src/screen.ts";

function close(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} ≈ ${expected}`);
}

function apply(v: ViewTransform, x: number, y: number): { x: number; y: number } {
  return { x: v.a * x + v.c * y + v.e, y: v.b * x + v.d * y + v.f };
}

function screen(props: Partial<ScreenProps> = {}, ...children: GameObject[]): Screen {
  const root = new Screen({ width: 320, height: 180, ...props });
  for (const child of children) root.addChild(child);
  return root;
}

function draw(root: GameObject, width: number, height: number): { records: DecodedRecord[]; warnings: string[]; built: ReturnType<FrameBuilder["build"]> } {
  const backend = new RecordingBackend();
  const warnings: string[] = [];
  const builder = new FrameBuilder({ loadTexture: (path) => backend.loadTexture(path), warn: (m) => warnings.push(m) });
  const built = builder.build(root, width, height);
  backend.frame(0x000000ff, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return { records: [...backend.lastFrame.records], warnings, built };
}

describe("fitScreen", () => {
  it("scales 320 × 180 by a whole 4 into 1280 × 720, with no bars", () => {
    const at = fitScreen(320, 180, 1280, 720, "integer");
    assert.deepEqual(at, { width: 320, height: 180, scaleX: 4, scaleY: 4, left: 0, top: 0 });
    assert.deepEqual(borderRects(at, 1280, 720), []);
  });

  it("uses the largest whole scale that fits, centred on a whole pixel", () => {
    const at = fitScreen(320, 180, 1000, 600, "integer");
    assert.deepEqual(at, { width: 320, height: 180, scaleX: 3, scaleY: 3, left: 20, top: 30 });
    const odd = fitScreen(320, 180, 961, 541, "integer");
    assert.deepEqual([odd.left, odd.top], [0, 0], "half a pixel of slack rounds down, so pixels stay on the window's grid");
  });

  it("falls back to contain when the window is smaller than the game, rather than cutting it off", () => {
    const at = fitScreen(320, 180, 160, 120, "integer");
    assert.equal(at.scaleX, 0.5);
    assert.equal(at.scaleY, 0.5);
    assert.deepEqual([at.left, at.top], [0, 15]);
  });

  it("contains with any scale, keeping the shape", () => {
    const at = fitScreen(320, 180, 1000, 600, "contain");
    assert.equal(at.scaleX, 3.125);
    assert.equal(at.scaleY, 3.125);
    assert.deepEqual([at.left, at.top], [0, (600 - 562.5) / 2]);
  });

  it("stretches each axis to fill the window", () => {
    assert.deepEqual(fitScreen(320, 180, 1000, 600, "stretch"), { width: 320, height: 180, scaleX: 3.125, scaleY: 600 / 180, left: 0, top: 0 });
  });

  it("keeps a scale of 1 for a window with no area, so the mouse can still be mapped", () => {
    assert.deepEqual(fitScreen(320, 180, 0, 0, "integer"), { width: 320, height: 180, scaleX: 1, scaleY: 1, left: 0, top: 0 });
  });
});

describe("borderRects and onScreen", () => {
  it("covers exactly the window outside the game", () => {
    const at = fitScreen(320, 180, 1000, 600, "integer"); // 960 × 540 at (20, 30)
    assert.deepEqual(borderRects(at, 1000, 600), [
      { x: 0, y: 0, width: 20, height: 600 },
      { x: 980, y: 0, width: 20, height: 600 },
      { x: 20, y: 0, width: 960, height: 30 },
      { x: 20, y: 570, width: 960, height: 30 },
    ]);
  });

  it("knows the game from the bars", () => {
    const at = fitScreen(320, 180, 1000, 600, "integer");
    assert.ok(onScreen(at, 20, 30));
    assert.ok(onScreen(at, 979, 569));
    assert.ok(!onScreen(at, 19, 300));
    assert.ok(!onScreen(at, 500, 570));
  });

  it("maps a view through the placement", () => {
    const at: ScreenPlacement = { width: 320, height: 180, scaleX: 3, scaleY: 2, left: 10, top: 5 };
    const view: ViewTransform = { a: 0, b: 1, c: -1, d: 0, e: 7, f: 9 };
    const both = viewToWindow(view, at);
    const inner = apply(view, 4, 6);
    assert.deepEqual(apply(both, 4, 6), { x: inner.x * 3 + 10, y: inner.y * 2 + 5 });
  });
});

describe("FrameBuilder: a root <Screen>", () => {
  it("draws game pixels into a canvas the window shows at the game's place, in the border colour around it", () => {
    const { records, built } = draw(screen({ border: "navy" }), 1000, 600);
    assert.deepEqual(records, [
      { op: "canvas", width: 320, height: 180, destX: 20, destY: 30, destW: 960, destH: 540, borderColor: "#000080ff" },
      { op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    ]);
    // The mouse is still taken back through the window's map, so the views the records carry do not matter to it.
    assert.deepEqual(built.view, { a: 3, b: 0, c: 0, d: 3, e: 20, f: 30 });
  });

  it("centres a pixel-perfect camera on the canvas, in game pixels", () => {
    const camera = new Camera({ zoom: 2 });
    camera.transform.x = 100;
    const { records } = draw(screen({}, camera), 1000, 600);
    const view = records[1];
    assert.ok(view?.op === "view");
    assert.equal(view.a, 2);
    close(view.a * 100 + view.e, 160, "the followed point is the canvas's middle");
  });

  it("draws game pixels scaled into the window, the game's corner at its place, when it is not pixel-perfect", () => {
    const { records, built } = draw(screen({ pixelPerfect: false }), 1000, 600);
    assert.deepEqual(records[0], { op: "view", a: 3, b: 0, c: 0, d: 3, e: 20, f: 30 });
    assert.deepEqual(built.screen, { width: 320, height: 180, scaleX: 3, scaleY: 3, left: 20, top: 30 });
    assert.deepEqual(built.view, { a: 3, b: 0, c: 0, d: 3, e: 20, f: 30 });
  });

  it("centres the camera on the game's middle, not the window's", () => {
    const camera = new Camera();
    camera.transform.x = 100;
    camera.transform.y = 50;
    const { built } = draw(screen({}, camera), 1000, 600);
    // world (100, 50) is the game's centre (160, 90), which is window (20 + 480, 30 + 270).
    const at = apply(built.view, 100, 50);
    close(at.x, 500, "x");
    close(at.y, 300, "y");
  });

  it("draws bars in the border colour over the window outside the game, last", () => {
    const { records } = draw(screen({ border: "navy", pixelPerfect: false }, new Shape({ kind: "rect", width: 400, height: 400 })), 1000, 600);
    const bars = records.slice(3);
    assert.equal(records[1]?.op, "rect", "the game's own shape comes first");
    assert.deepEqual(records[2], { op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, "then a view in window pixels");
    assert.equal(bars.length, 4);
    for (const bar of bars) assert.ok(bar.op === "rect" && bar.color === "#000080ff");
  });

  it("places each bar on its window rectangle, whatever the camera does, in a view of window pixels", () => {
    for (const fit of ["integer", "contain", "stretch"] as const) {
      const camera = new Camera({ zoom: 1.7 });
      camera.transform.rotation = 0.8;
      const window = { width: 1000, height: 700 };
      const { records, built } = draw(screen({ fit, pixelPerfect: false }, camera), window.width, window.height);
      const expected = borderRects(built.screen!, window.width, window.height);
      if (expected.length === 0) {
        assert.equal(fit, "stretch", "only a stretched game fills the window");
        assert.equal(records.length, 1);
        continue;
      }
      const bars = records.slice(2);
      assert.deepEqual(records[1], { op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      assert.deepEqual(
        bars.map((bar) => (bar.op === "rect" ? { x: bar.x, y: bar.y, width: bar.width, height: bar.height, rotation: bar.rotation, scaleX: bar.scaleX, scaleY: bar.scaleY } : null)),
        expected.map((r) => ({ ...r, rotation: 0, scaleX: 1, scaleY: 1 })),
        fit,
      );
    }
  });

  it("draws no bars when the game fills the window", () => {
    const { records } = draw(screen({ pixelPerfect: false }), 1280, 720);
    assert.deepEqual(records, [{ op: "view", a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 }]);
    assert.equal(draw(screen(), 1280, 720).records[0]?.op, "canvas", "a pixel-perfect game always has its canvas");
  });

  it("follows the screen's props as they change", () => {
    const root = screen();
    const builder = new FrameBuilder({ loadTexture: () => 0 });
    assert.equal(builder.build(root, 1280, 720).screen?.scaleX, 4);
    root.width = 640;
    root.height = 360;
    assert.equal(builder.build(root, 1280, 720).screen?.scaleX, 2);
    root.fit = "stretch";
    assert.equal(builder.build(root, 1280, 1000).screen?.scaleY, 1000 / 360);
  });

  it("draws at the window's size, warning once, for a screen with no usable size", () => {
    const { records, built, warnings } = draw(screen({ width: 0 }), 1000, 600);
    assert.deepEqual(records, [{ op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }]);
    assert.equal(built.screen, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /positive width and height/);
  });

  it("uses integer, warning once, for a fit it does not know", () => {
    const root = screen();
    (root as { fit: string }).fit = "cover";
    const { built, warnings } = draw(root, 1000, 600);
    assert.equal(built.screen?.scaleX, 3);
    assert.match(warnings[0]!, /Unknown <Screen fit> 'cover'/);
  });

  it("finds the screen a World mounted, under the world's own root", () => {
    const world = new World();
    world.mount(screen());
    assert.equal(draw(world.root, 1000, 600).built.screen?.scaleX, 3);
  });

  it("treats a screen below the root as a plain container, warning once", () => {
    const root = new Entity();
    const inner = screen({}, new Shape({ kind: "rect", width: 4, height: 4 }));
    root.addChild(new Entity());
    root.addChild(inner);
    const { records, built, warnings } = draw(root, 1000, 600);
    assert.equal(built.screen, null);
    assert.deepEqual(records[0], { op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    assert.equal(records.length, 2);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /only sets the game's resolution as the root/);
  });

  it("is the same frame as an Entity's when it exactly fills the window at scale 1", () => {
    const shape = () => {
      const s = new Shape({ kind: "circle", width: 10, height: 6, color: "red" });
      s.transform.x = 5;
      return s;
    };
    const plain = new Entity();
    plain.addChild(shape());
    assert.deepEqual(draw(screen({ pixelPerfect: false }, shape()), 320, 180).records, draw(plain, 320, 180).records);
  });
});

describe("createPlayer: a root <Screen>", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  const WINDOW = { width: 1000, height: 600, title: "test" };

  it("presses a pointer where it is drawn in the scaled game, and nothing in the bars", () => {
    const presses: string[] = [];
    const button = new Pointer({ width: 10, height: 10, onPress: () => presses.push("button") });
    button.transform.x = 0;
    button.transform.y = 0;
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { ...WINDOW, root: () => screen({}, button) });
    // Game (0..10, 0..10) is window (20..50, 30..60) at ×3.
    backend.queueInput({ mouse: { x: 35, y: 45 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    assert.deepEqual(presses, ["button"]);
    // A pointer that reaches past the game into the bars is not pressed there.
    button.transform.x = -5;
    backend.queueInput({ mouse: { x: 18, y: 45 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    p.close();
    assert.deepEqual(presses, ["button"]);
  });

  it("gives handlers the mouse in game pixels, through the camera", () => {
    const seen: string[] = [];
    class Probe extends Entity {
      override onInput(input: InputState): void {
        seen.push(`${input.pointerX},${input.pointerY}`);
      }
    }
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { ...WINDOW, root: () => screen({}, new Probe()) });
    backend.queueInput({ mouse: { x: 20 + 3 * 100, y: 30 + 3 * 50 } });
    p.step();
    p.step();
    p.close();
    assert.equal(seen.at(-1), "100,50");
  });
});
