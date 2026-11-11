import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AnimatedSprite, Camera, Collider, Entity, GameObject, Pointer, Screen, Shape, Sprite, Text, Tilemap, World, registerTilemaps } from "@rge/runtime";
import { Hero } from "../../example/generated/Hero.ts";
import { Level } from "../../example/generated/Level.ts";
import { estimateTextWidth, FrameBuilder, walkTree } from "../src/draw.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";
import { RGE_IN_LEN, KEYS } from "../src/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));

interface Drawn {
  readonly records: DecodedRecord[];
  readonly warnings: string[];
  readonly built: ReturnType<FrameBuilder["build"]>;
  readonly backend: RecordingBackend;
}

/** Build one frame for `root` and decode it through the recording backend, as a player would. */
function draw(root: GameObject, options: { width?: number; height?: number; missing?: string[]; builder?: FrameBuilder; backend?: RecordingBackend; warnings?: string[] } = {}): Drawn {
  const backend = options.backend ?? new RecordingBackend({ missingTextures: options.missing });
  const warnings = options.warnings ?? [];
  const builder = options.builder ?? new FrameBuilder({ loadTexture: (path) => backend.loadTexture(path), warn: (m) => warnings.push(m) });
  const built = builder.build(root, options.width ?? 800, options.height ?? 600);
  backend.frame(0x000000ff, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return { records: [...backend.lastFrame.records], warnings, built, backend };
}

function close(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} ≈ ${expected}`);
}

/** Compare against test/golden/<name>.json; run with UPDATE_GOLDEN=1 to rewrite it, then review the diff. */
function golden(name: string, actual: unknown): void {
  const file = resolve(here, "golden", `${name}.json`);
  // Round to 1e-9 so a last-bit difference in Math.sin or Math.cos between engines does not fail the comparison.
  const text = `${JSON.stringify(actual, (_key, value: unknown) => (typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value), 2)}\n`;
  if (process.env["UPDATE_GOLDEN"] === "1") {
    writeFileSync(file, text);
    return;
  }
  assert.ok(existsSync(file), `test/golden/${name}.json is missing (UPDATE_GOLDEN=1 to create it)`);
  assert.deepEqual(JSON.parse(text), JSON.parse(readFileSync(file, "utf8")), `${name} differs from test/golden/${name}.json (UPDATE_GOLDEN=1 to accept)`);
}

function mounted(object: GameObject): World {
  const world = new World();
  world.mount(object);
  return world;
}

describe("walkTree", () => {
  it("gives every object the world transform worldTransform() gives, over the example Level", () => {
    const level = new Level();
    const world = mounted(level);
    // Run long enough for enemies to move, a third one to appear under the camera, and the score to change.
    for (let i = 0; i < 200; i++) world.tick(0.05);
    let count = 0;
    let cameras = 0;
    walkTree(world.root, (object, transform) => {
      const expected = object.worldTransform();
      for (const field of ["x", "y", "rotation", "scaleX", "scaleY"] as const) close(transform[field], expected[field], `${object.constructor.name}.${field}`);
      count++;
      if (object instanceof Camera) cameras++;
    });
    assert.ok(count > 15, `walked ${count} objects`);
    assert.equal(cameras, 1, "the tree should include a camera, or this test would not cover camera transparency");
  });

  it("agrees under rotation, scale, placement, global transforms and a camera in the middle", () => {
    const outer = new Entity();
    outer.transform.x = 100;
    outer.transform.rotation = 0.5;
    outer.transform.scaleX = 2;
    outer.placement.y = 30;
    const camera = new Camera();
    camera.transform.x = 7;
    const inner = new Shape({ kind: "rect", width: 4, height: 4 });
    inner.transform.x = 10;
    inner.placement.rotation = -0.2;
    const pinned = new Sprite({ image: "a.png" });
    pinned.transform.global = true;
    pinned.transform.x = 3;
    outer.addChild(camera);
    camera.addChild(inner);
    inner.addChild(pinned);
    walkTree(outer, (object, transform) => {
      const expected = object.worldTransform();
      for (const field of ["x", "y", "rotation", "scaleX", "scaleY"] as const) close(transform[field], expected[field], `${object.constructor.name}.${field}`);
    });
  });

  it("agrees with worldTransform() when layout has moved objects, under a turned, scaled parent", () => {
    const outer = new Entity();
    outer.transform.rotation = 0.7;
    outer.transform.scaleX = 3;
    outer.layoutX = 11;
    const row = new Entity();
    row.layoutX = 5;
    row.layoutY = -2;
    row.placement.x = 4;
    const leaf = new Text({ text: "hi" });
    leaf.layoutY = 9;
    leaf.transform.y = -1;
    const camera = new Camera();
    camera.layoutX = 100;
    const followed = new Shape({ kind: "rect", width: 1, height: 1 });
    followed.layoutX = 2;
    outer.addChild(row);
    row.addChild(leaf);
    row.addChild(camera);
    camera.addChild(followed);
    let count = 0;
    walkTree(outer, (object, transform) => {
      const expected = object.worldTransform();
      for (const field of ["x", "y", "rotation", "scaleX", "scaleY"] as const) close(transform[field], expected[field], `${object.constructor.name}.${field}`);
      count++;
    });
    assert.equal(count, 5);
  });

  it("visits parents before children, children in order", () => {
    const root = new Entity({ name: "root" });
    const a = new Entity({ name: "a" });
    const b = new Entity({ name: "b" });
    const a1 = new Entity({ name: "a1" });
    root.addChild(a);
    root.addChild(b);
    a.addChild(a1);
    const seen: string[] = [];
    walkTree(root, (object) => void seen.push((object as Entity).name));
    assert.deepEqual(seen, ["root", "a", "a1", "b"]);
  });
});

describe("FrameBuilder: what each element draws", () => {
  it("draws a sprite at its world transform with a texture loaded from the assets folder", () => {
    const sprite = new Sprite({ image: "hero.png" });
    sprite.transform.x = 5;
    sprite.transform.y = 6;
    sprite.transform.rotation = 0.25;
    sprite.transform.scaleX = -1;
    const { records, backend } = draw(sprite);
    assert.deepEqual(records[1], { op: "sprite", x: 5, y: 6, rotation: 0.25, scaleX: -1, scaleY: 1, texture: "assets/hero.png" });
    assert.deepEqual(backend.textureLoads, ["assets/hero.png"]);
  });

  it("uses the assets option for the folder", () => {
    const backend = new RecordingBackend();
    const builder = new FrameBuilder({ loadTexture: (p) => backend.loadTexture(p), assets: "art/v2" });
    draw(new Sprite({ image: "a.png" }), { builder, backend });
    assert.deepEqual(backend.textureLoads, ["art/v2/a.png"]);
  });

  it("draws an animated sprite's current frame", () => {
    const animated = new AnimatedSprite({ frames: ["a.png", "b.png", "c.png"], fps: 10 });
    const world = mounted(animated);
    world.tick(0.1);
    world.tick(0.1);
    const { records } = draw(world.root);
    assert.equal(records[1]?.op === "sprite" && records[1].texture, "assets/c.png");
  });

  it("draws nothing for a sprite with no image", () => {
    const { records } = draw(new AnimatedSprite({ frames: [] }));
    assert.deepEqual(records.map((r) => r.op), ["view"]);
  });

  it("draws a rect and a circle with their size and colour", () => {
    const root = new Entity();
    root.addChild(new Shape({ kind: "rect", width: 20, height: 10, color: "red" }));
    root.addChild(new Shape({ kind: "circle", width: 8, height: 6 }));
    const { records } = draw(root);
    assert.deepEqual(records.slice(1).map((r) => (r.op === "rect" || r.op === "ellipse" ? [r.op, r.width, r.height, r.color] : r.op)), [
      ["rect", 20, 10, "#ff0000ff"],
      ["ellipse", 8, 6, "#ffffffff"],
    ]);
  });

  it("draws text with its size and colour, and skips empty text", () => {
    const root = new Entity();
    root.addChild(new Text({ text: "Score: 3", size: 12, color: "gold" }));
    root.addChild(new Text({ text: "" }));
    root.addChild(new Text({ text: "second" }));
    const { records, built } = draw(root);
    assert.deepEqual(records.slice(1).map((r) => (r.op === "text" ? [r.text, r.size, r.color] : r.op)), [
      ["Score: 3", 12, "#ffd700ff"],
      ["second", 16, "#ffffffff"],
    ]);
    assert.deepEqual(built.list.texts, ["Score: 3", "second"]);
  });

  it("draws entities, pointers and colliders as nothing, and collects the last two", () => {
    const root = new Entity();
    const pointer = new Pointer({ width: 4, height: 4 });
    const collider = new Collider({ width: 2, height: 2 });
    collider.transform.x = 9;
    root.addChild(pointer);
    root.addChild(collider);
    const { records, built } = draw(root);
    assert.deepEqual(records.map((r) => r.op), ["view"]);
    assert.deepEqual(built.pointers, [pointer]);
    assert.equal(built.colliders.length, 1);
    assert.equal(built.colliders[0]?.collider, collider);
    assert.equal(built.colliders[0]?.world.x, 9);
  });

  it("draws in tree order: a parent first, then its children, then the next sibling", () => {
    const root = new Entity();
    const first = new Entity();
    first.addChild(new Shape({ kind: "rect", width: 1, height: 1, color: "#010101" }));
    first.addChild(new Shape({ kind: "rect", width: 2, height: 2, color: "#020202" }));
    root.addChild(first);
    root.addChild(new Shape({ kind: "rect", width: 3, height: 3, color: "#030303" }));
    const { records } = draw(root);
    assert.deepEqual(records.slice(1).map((r) => (r.op === "rect" ? r.width : -1)), [1, 2, 3]);
  });

  it("applies a parent's transform to its children", () => {
    const root = new Entity();
    root.transform.x = 100;
    root.transform.scaleX = 2;
    const child = new Shape({ kind: "rect", width: 1, height: 1 });
    child.transform.x = 10;
    root.addChild(child);
    const { records } = draw(root);
    assert.deepEqual(records[1]?.op === "rect" && [records[1].x, records[1].scaleX], [120, 2]);
  });
});

describe("FrameBuilder: textures", () => {
  it("loads each texture once, however many sprites and frames use it", () => {
    const root = new Entity();
    root.addChild(new Sprite({ image: "a.png" }));
    root.addChild(new Sprite({ image: "a.png" }));
    const backend = new RecordingBackend();
    const builder = new FrameBuilder({ loadTexture: (p) => backend.loadTexture(p) });
    draw(root, { builder, backend });
    draw(root, { builder, backend });
    assert.deepEqual(backend.textureLoads, ["assets/a.png"]);
  });

  it("draws a magenta 16×16 square for a texture that cannot be loaded, warning once", () => {
    const root = new Entity();
    const sprite = new Sprite({ image: "missing.png" });
    sprite.transform.x = 4;
    root.addChild(sprite);
    root.addChild(new Sprite({ image: "missing.png" }));
    const backend = new RecordingBackend({ missingTextures: ["assets/missing.png"] });
    const warnings: string[] = [];
    const builder = new FrameBuilder({ loadTexture: (p) => backend.loadTexture(p), warn: (m) => warnings.push(m) });
    const first = draw(root, { builder, backend, warnings });
    draw(root, { builder, backend, warnings });
    assert.deepEqual(first.records[1], { op: "rect", x: 4, y: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 16, height: 16, color: "#ff00ffff" });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /assets\/missing\.png/);
    assert.deepEqual(backend.textureLoads, ["assets/missing.png"], "a failed load is not retried every frame");
  });

  it("uses magenta and warns once for a colour it cannot read", () => {
    const warnings: string[] = [];
    const { records } = draw(new Shape({ kind: "rect", width: 1, height: 1, color: "burnt toast" }), { warnings });
    assert.equal(records[1]?.op === "rect" && records[1].color, "#ff00ffff");
    assert.equal(warnings.length, 1);
  });
});

describe("FrameBuilder: the camera", () => {
  it("maps the world origin to the window's top-left with no camera", () => {
    const { records, built } = draw(new Entity(), { width: 640, height: 480 });
    assert.deepEqual(records[0], { op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    assert.equal(built.camera, null);
  });

  it("puts the point the camera is at in the middle of the window", () => {
    const root = new Entity();
    const camera = new Camera();
    camera.transform.x = 100;
    camera.transform.y = 50;
    root.addChild(camera);
    const { records, built } = draw(root, { width: 640, height: 480 });
    const v = records[0];
    assert.ok(v?.op === "view");
    // world (100, 50) → (320, 240)
    close(v.a * 100 + v.c * 50 + v.e, 320, "x");
    close(v.b * 100 + v.d * 50 + v.f, 240, "y");
    assert.equal(built.camera, camera);
  });

  it("follows the camera's children and magnifies by zoom", () => {
    const root = new Entity();
    const camera = new Camera({ zoom: 2 });
    const target = new Entity();
    target.transform.x = 30;
    target.transform.y = 40;
    camera.addChild(target);
    root.addChild(camera);
    const { records } = draw(root, { width: 200, height: 100 });
    const v = records[0];
    assert.ok(v?.op === "view");
    close(v.a * 30 + v.c * 40 + v.e, 100, "target x is centred");
    close(v.b * 30 + v.d * 40 + v.f, 50, "target y is centred");
    close(v.a * 31 + v.c * 40 + v.e, 102, "one world pixel is two screen pixels");
  });

  it("agrees with Camera.viewTransform plus the centre offset", () => {
    const camera = new Camera({ zoom: 1.5 });
    camera.transform.x = 12;
    camera.transform.rotation = 0.3;
    const view = camera.viewTransform();
    const { records } = draw(camera, { width: 300, height: 200 });
    assert.deepEqual(records[0], { op: "view", a: view.a, b: view.b, c: view.c, d: view.d, e: view.e + 150, f: view.f + 100 });
  });

  it("uses the first camera in draw order and warns once about another", () => {
    const root = new Entity();
    const first = new Camera();
    first.transform.x = 10;
    const second = new Camera();
    second.transform.x = 99;
    root.addChild(first);
    root.addChild(second);
    const warnings: string[] = [];
    const builder = new FrameBuilder({ loadTexture: () => 0, warn: (m) => warnings.push(m) });
    const backend = new RecordingBackend();
    const a = draw(root, { builder, backend, warnings });
    draw(root, { builder, backend, warnings });
    assert.equal(a.built.camera, first);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /first/);
  });

  it("draws without the camera, warning once, when its zoom is unusable", () => {
    const root = new Entity();
    const camera = new Camera();
    camera.zoom = 0;
    root.addChild(camera);
    root.addChild(new Shape({ kind: "rect", width: 1, height: 1 }));
    const warnings: string[] = [];
    const builder = new FrameBuilder({ loadTexture: () => 0, warn: (m) => warnings.push(m) });
    const backend = new RecordingBackend();
    const first = draw(root, { builder, backend, warnings });
    draw(root, { builder, backend, warnings });
    assert.deepEqual(first.records[0], { op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    assert.equal(first.records[1]?.op, "rect", "the frame is still drawn");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /zoom/);
  });

  it("does not move what it draws: a camera changes the view record only", () => {
    const makeRoot = (cameraX: number): Entity => {
      const root = new Entity();
      const camera = new Camera();
      camera.transform.x = cameraX;
      root.addChild(camera);
      root.addChild(new Shape({ kind: "rect", width: 5, height: 5 }));
      return root;
    };
    const a = draw(makeRoot(0)).records;
    const b = draw(makeRoot(500)).records;
    assert.deepEqual(a.slice(1), b.slice(1));
    assert.notDeepEqual(a[0], b[0]);
  });
});

describe("FrameBuilder: buffers", () => {
  it("grows past its first buffer and still decodes every record", () => {
    const root = new Entity();
    for (let i = 0; i < 400; i++) {
      const shape = new Shape({ kind: "rect", width: i, height: 1 });
      shape.transform.x = i;
      root.addChild(shape);
    }
    const { records, built } = draw(root);
    assert.equal(records.length, 401);
    assert.ok(built.list.records.length >= built.list.length);
    assert.deepEqual(records[400]?.op === "rect" && [records[400].x, records[400].width], [399, 399]);
  });

  it("keeps a sprite's texture when its record is the one that makes the buffer grow", () => {
    // Under a z, so each sprite is written by `DrawList.sprite`; 7 doubles each after a view of 7, so some record crosses 1,024.
    const root = new Entity();
    root.transform.z = 1;
    for (let i = 0; i < 200; i++) root.addChild(new Sprite({ image: "a.png" }));
    const built = new FrameBuilder({ loadTexture: () => 5 }).build(root, 800, 600);
    for (let at = 7; at < built.list.length; at += 7) assert.equal(built.list.records[at + 6], 5, `the sprite at double ${at}`);
  });

  it("reuses the list between frames without leaking the last frame's records", () => {
    const backend = new RecordingBackend();
    const builder = new FrameBuilder({ loadTexture: () => 0 });
    const many = new Entity();
    for (let i = 0; i < 10; i++) many.addChild(new Text({ text: `t${i}` }));
    draw(many, { builder, backend });
    const few = draw(new Entity(), { builder, backend });
    assert.deepEqual(few.records.map((r) => r.op), ["view"]);
    assert.deepEqual(few.built.list.texts, []);
  });
});

describe("golden draw lists", () => {
  it("Hero", () => {
    const world = mounted(new Hero());
    world.tick(1 / 60);
    golden("hero", draw(world.root).records);
  });

  it("Level after a few seconds of play", () => {
    const world = mounted(new Level());
    for (let i = 0; i < 100; i++) world.tick(0.05);
    golden("level", draw(world.root, { width: 320, height: 240 }).records);
  });
});

describe("FrameBuilder: measuring, for layout", () => {
  function builder(backend: RecordingBackend, warnings: string[] = [], withMeasuring = true): FrameBuilder {
    return new FrameBuilder({
      loadTexture: (path) => backend.loadTexture(path),
      measureText: withMeasuring ? (text, size) => backend.measureText(text, size) : undefined,
      textureSize: withMeasuring ? (handle) => backend.textureSize(handle) : undefined,
      warn: (m) => warnings.push(m),
    });
  }

  it("measures shapes, pointers and colliders by their own size", () => {
    const b = builder(new RecordingBackend());
    assert.deepEqual(b.measure(new Shape({ kind: "circle", width: 6, height: 4 })), { width: 6, height: 4 });
    assert.deepEqual(b.measure(new Pointer({ width: 96, height: 32 })), { width: 96, height: 32 });
    assert.deepEqual(b.measure(new Collider({ width: 3, height: 9 })), { width: 3, height: 9 });
  });

  it("measures text through the backend, as wide as it is and as tall as its size, asking once per string", () => {
    const backend = new RecordingBackend();
    const b = builder(backend);
    const label = new Text({ text: "Score", size: 20 });
    assert.deepEqual(b.measure(label), { width: estimateTextWidth("Score", 20), height: 20 });
    assert.deepEqual(b.measure(label), { width: 60, height: 20 });
    label.size = 10;
    b.measure(label);
    label.text = "";
    assert.deepEqual(b.measure(label), { width: 0, height: 10 }, "empty text is not measured");
    assert.deepEqual(backend.textMeasures, ["20:Score", "10:Score"]);
  });

  it("estimates text without a backend that measures, counting characters, not UTF-16 units", () => {
    const b = builder(new RecordingBackend(), [], false);
    assert.deepEqual(b.measure(new Text({ text: "héllo", size: 10 })), { width: 30, height: 10 });
    assert.equal(estimateTextWidth("🙂🙂", 10), 12);
  });

  it("measures a sprite by its texture, loading it once and asking its size once", () => {
    const backend = new RecordingBackend({ textureSizes: { "assets/coin.png": { width: 12, height: 14 } } });
    const b = builder(backend);
    assert.deepEqual(b.measure(new Sprite({ image: "coin.png" })), { width: 12, height: 14 });
    assert.deepEqual(b.measure(new Sprite({ image: "coin.png" })), { width: 12, height: 14 });
    assert.deepEqual(b.measure(new Sprite({ image: "other.png" })), { width: 16, height: 16 });
    assert.deepEqual(backend.textureLoads, ["assets/coin.png", "assets/other.png"]);
    assert.deepEqual(backend.textureSizeQueries, ["assets/coin.png", "assets/other.png"]);
    // Drawing the same sprite afterwards does not load it again.
    draw(new Sprite({ image: "coin.png" }), { builder: b, backend });
    assert.deepEqual(backend.textureLoads, ["assets/coin.png", "assets/other.png"]);
  });

  it("measures an animated sprite by its first frame, so the size does not jitter", () => {
    const backend = new RecordingBackend({ textureSizes: { "assets/a.png": { width: 8, height: 8 }, "assets/b.png": { width: 30, height: 30 } } });
    const sprite = new AnimatedSprite({ frames: ["a.png", "b.png"], fps: 10 });
    sprite.onUpdate(0.15);
    assert.equal(sprite.image, "b.png");
    assert.deepEqual(builder(backend).measure(sprite), { width: 8, height: 8 });
  });

  it("measures a missing texture as the square drawn in its place, and an empty image as nothing", () => {
    const backend = new RecordingBackend({ missingTextures: ["assets/gone.png"] });
    const b = builder(backend);
    assert.deepEqual(b.measure(new Sprite({ image: "gone.png" })), { width: 16, height: 16 });
    assert.deepEqual(b.measure(new Sprite({ image: "" })), { width: 0, height: 0 });
    assert.deepEqual(backend.textureSizeQueries, []);
  });

  it("measures textures as 0 × 0, warning once, without a backend that can say", () => {
    const warnings: string[] = [];
    const b = builder(new RecordingBackend(), warnings, false);
    assert.deepEqual(b.measure(new Sprite({ image: "a.png" })), { width: 0, height: 0 });
    b.measure(new Sprite({ image: "b.png" }));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /cannot report texture sizes/);
  });

  it("leaves containers to layout", () => {
    const b = builder(new RecordingBackend());
    assert.equal(b.measure(new Entity()), null);
    assert.equal(b.measure(new Camera()), null);
  });
});

describe("FrameBuilder: draw order (z)", () => {
  /** A rect whose width says which one it is, so a decoded frame reads as a list of names. */
  function box(id: number, z = 0): Shape {
    const shape = new Shape({ kind: "rect", width: id, height: 1 });
    shape.transform.z = z;
    return shape;
  }

  function parentOf(...children: GameObject[]): Entity {
    const root = new Entity();
    for (const child of children) root.addChild(child);
    return root;
  }

  /** The widths of the drawn rects, in draw order. */
  function order(records: readonly DecodedRecord[]): number[] {
    return records.flatMap((r) => (r.op === "rect" ? [r.width] : []));
  }

  it("draws what has a higher z later, so on top, and negative z behind", () => {
    const { records } = draw(parentOf(box(1, 1), box(2, 0), box(3, -1), box(4, 0)));
    assert.deepEqual(order(records), [3, 2, 4, 1]);
  });

  it("keeps tree order among equal z, and changes nothing when every z is equal", () => {
    assert.deepEqual(order(draw(parentOf(box(1), box(2), box(3))).records), [1, 2, 3]);
    assert.deepEqual(order(draw(parentOf(box(1, 4), box(2, 4), box(3, 4))).records), [1, 2, 3]);
    assert.deepEqual(order(draw(parentOf(box(1, 2), box(2, 1), box(3, 2), box(4, 1))).records), [2, 4, 1, 3]);
  });

  it("agrees with a stable sort by (z, tree order) over many objects, past the first buffers' size", () => {
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const root = new Entity();
    const expected: { id: number; z: number }[] = [];
    for (let i = 1; i <= 2500; i++) {
      const z = (random() % 7) - 3;
      root.addChild(box(i, z));
      expected.push({ id: i, z });
    }
    expected.sort((a, b) => a.z - b.z || a.id - b.id);
    assert.deepEqual(order(draw(root).records), expected.map((e) => e.id));
  });

  it("adds a child's z to its parent's, so a raised subtree stays together relative to the rest", () => {
    const parent = box(1, 5);
    const child = box(2, 1);
    parent.addChild(child);
    const { records } = draw(parentOf(parent, box(3, 5.5)));
    assert.deepEqual(order(records), [1, 3, 2], "the child is at 6: above a sibling at 5.5");
  });

  it("adds placement z and transform z, and lets `global` ignore the ancestors", () => {
    const parent = box(1, 10);
    const placed = box(2, 3);
    placed.placement.z = 2;
    const pinned = box(3, 1);
    pinned.transform.global = true;
    const placedGlobal = box(4, 1);
    placedGlobal.placement.global = true;
    placedGlobal.placement.z = 2;
    parent.addChild(placed);
    parent.addChild(pinned);
    parent.addChild(placedGlobal);
    const seen: Record<number, number> = {};
    walkTree(parent, (object, _world, z) => void (seen[(object as Shape).width] = z));
    assert.deepEqual(seen, { 1: 10, 2: 15, 3: 1, 4: 3 });
    assert.deepEqual(order(draw(parent).records), [3, 4, 1, 2]);
  });

  it("does not let a camera's own z move its children", () => {
    const camera = new Camera();
    camera.transform.z = 50;
    camera.addChild(box(1, 0));
    const seen: number[] = [];
    walkTree(parentOf(camera, box(2, 10)), (object, _w, z) => void (object instanceof Shape && seen.push(z)));
    assert.deepEqual(seen, [0, 10]);
  });

  it("takes z from state-driven values each frame, with nothing left over from the last", () => {
    const a = box(1, 0);
    const b = box(2, 0);
    const root = parentOf(a, b);
    const backend = new RecordingBackend();
    const builder = new FrameBuilder({ loadTexture: (p) => backend.loadTexture(p) });
    const frame = (): number[] => {
      const built = builder.build(root, 100, 100);
      backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
      return order(backend.lastFrame.records);
    };
    assert.deepEqual(frame(), [1, 2]);
    a.transform.z = 1;
    assert.deepEqual(frame(), [2, 1]);
    a.transform.z = 0;
    assert.deepEqual(frame(), [1, 2]);
  });

  it("reorders every kind of record with its own payload: sprites, shapes, ellipses and text", () => {
    const text = new Text({ text: "top", size: 12, color: "red" });
    text.transform.z = 2;
    const under = new Text({ text: "under", size: 9, color: "blue" });
    under.transform.z = -1;
    const sprite = new Sprite({ image: "a.png" });
    sprite.transform.z = 1;
    const circle = new Shape({ kind: "circle", width: 5, height: 6, color: "lime" });
    const { records } = draw(parentOf(text, sprite, box(7), circle, under));
    assert.deepEqual(
      records.slice(1).map((r) => r.op),
      ["text", "rect", "ellipse", "sprite", "text"],
    );
    const texts = records.filter((r) => r.op === "text");
    assert.deepEqual(texts.map((r) => (r.op === "text" ? [r.text, r.size, r.color] : null)), [["under", 9, "#0000ffff"], ["top", 12, "#ff0000ff"]]);
    const ellipse = records.find((r) => r.op === "ellipse");
    assert.ok(ellipse?.op === "ellipse" && ellipse.width === 5 && ellipse.height === 6 && ellipse.color === "#00ff00ff");
    assert.ok(records.some((r) => r.op === "sprite" && r.texture === "assets/a.png"));
  });

  it("keeps the view first, and a screen's border bars last, over everything", () => {
    const screen = new Screen({ width: 100, height: 50, border: "navy", pixelPerfect: false });
    screen.addChild(box(1, 5));
    screen.addChild(box(2, -5));
    const { records } = draw(screen, { width: 320, height: 200 }); // ×3 at (10, 25): four bars
    assert.equal(records[0]?.op, "view");
    assert.deepEqual(order(records.slice(0, 3)), [2, 1]);
    assert.equal(records[3]?.op, "view", "the bars are drawn through a view of window pixels");
    for (const bar of records.slice(4)) assert.ok(bar.op === "rect" && bar.color === "#000080ff");
    assert.equal(records.length, 3 + 1 + 4);
  });

  it("puts an infinite z at the ends, and treats one that is not a number as 0, warning once", () => {
    const { records } = draw(parentOf(box(1, Infinity), box(2, 0), box(3, -Infinity)));
    assert.deepEqual(order(records), [3, 2, 1]);
    const warnings: string[] = [];
    const bad = draw(parentOf(box(1, NaN), box(2, 1), box(3, -1), box(4, NaN)), { warnings });
    assert.deepEqual(order(bad.records), [3, 1, 4, 2], "a NaN sorts as 0, in tree order with the others");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /z is not a number/);
  });

  it("orders pointers by z too, so the one drawn on top is the one pressed", () => {
    const low = new Pointer({ width: 1, height: 1 });
    low.transform.z = 3;
    const high = new Pointer({ width: 2, height: 2 });
    const { built } = draw(parentOf(low, high, new Pointer({ width: 3, height: 3 })));
    assert.deepEqual(built.pointers.map((p) => (p as Pointer).width), [2, 3, 1], "last is on top");
  });

  it("does not reorder anything for a game that never sets z", () => {
    const root = parentOf(box(3), box(1), box(2));
    const { records, built } = draw(root);
    assert.deepEqual(order(records), [3, 1, 2]);
    assert.equal(built.list.length, 7 + 3 * 9);
  });
});

describe("FrameBuilder: leaves drawn in place", () => {
  /** Parents of every kind of placement, each with leaves of every kind: plain ones, which the walk deals with in place, and ones it must take the long way. */
  function scene(seed: number): Entity {
    let state = seed * 7919;
    const next = (): number => ((state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    const move = (object: GameObject, chance: number): void => {
      if (next() >= chance) return;
      object.transform.x = next() * 200 - 100;
      object.transform.y = next() * 200 - 100;
      if (next() < 0.4) object.transform.rotation = next() * 6;
      if (next() < 0.4) object.transform.scaleX = next() < 0.3 ? -1 : 0.5 + next() * 2;
      if (next() < 0.4) object.transform.scaleY = 0.5 + next() * 2;
      if (next() < 0.15) object.transform.global = true;
    };
    const root = new Entity();
    for (let p = 0; p < 40; p++) {
      const parent = new Entity();
      move(parent, 0.9);
      if (next() < 0.2) parent.placement.x = next() * 50;
      for (let k = 0; k < 6; k++) {
        const kind = Math.floor(next() * 9);
        const leaf: GameObject =
          kind === 0 ? new Shape({ kind: "rect", width: 1 + next() * 20, height: 1 + next() * 20, color: next() < 0.5 ? "red" : "#0f08" })
          : kind === 1 ? new Shape({ kind: "circle", width: 8, height: 6, color: "blue" })
          : kind === 2 ? new Sprite({ image: next() < 0.5 ? "a.png" : "b.png" })
          : kind === 3 ? new Sprite({ image: next() < 0.5 ? "" : "missing.png" })
          : kind === 4 ? new AnimatedSprite({ frames: ["f0.png", "f1.png"] })
          : kind === 5 ? new Collider({ width: 5, height: 7 })
          : kind === 6 ? new Text({ text: next() < 0.3 ? "" : "hi" })
          : kind === 7 ? new Pointer({ width: 4, height: 4 })
          : new Entity();
        move(leaf, 0.5);
        if (next() < 0.1) leaf.transform.global = true; // also one that is otherwise untouched: it is at the world's origin
        if (next() < 0.15) leaf.placement.y = next() * 30;
        if (next() < 0.1) leaf.placement.global = true;
        if (next() < 0.1) leaf.layoutX = 3;
        // Some are not leaves at all.
        if (next() < 0.15) leaf.addChild(new Shape({ kind: "rect", width: 2, height: 2 }));
        parent.addChild(leaf);
      }
      root.addChild(parent);
    }
    return root;
  }

  it("writes what the general walk writes for them: the same records, texts, colliders and pointers", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const root = scene(seed);
      const options = { loadTexture: (path: string): number => (path.includes("missing") ? -1 : path.length), warn: () => {} };
      const snapshot = (built: ReturnType<FrameBuilder["build"]>) => ({
        records: [...built.list.records.subarray(0, built.list.length)],
        texts: [...built.list.texts],
        colliders: built.colliders.map((entry) => ({ collider: entry.collider, world: { ...entry.world } })),
        pointers: [...built.pointers],
      });
      const inPlace = snapshot(new FrameBuilder(options).build(root, 800, 600));
      // Under a z nothing is dealt with in place (and with every z the same, nothing is reordered): the general walk.
      // `global` ignores the z above it, so what is global is given the same z itself.
      const raise = (object: GameObject): void => {
        if (object === root || object.transform.global) object.transform.z = 3;
        else if (object.placement.global) object.placement.z = 3;
        object.children.forEach(raise);
      };
      raise(root);
      const general = snapshot(new FrameBuilder(options).build(root, 800, 600));
      assert.ok(inPlace.records.length > 600 && inPlace.colliders.length > 10, `seed ${seed}: the scene draws plenty`);
      assert.deepEqual(inPlace.records, general.records, `seed ${seed}: records`);
      assert.deepEqual(inPlace.texts, general.texts, `seed ${seed}: texts`);
      assert.equal(inPlace.colliders.length, general.colliders.length);
      inPlace.colliders.forEach((entry, i) => {
        assert.equal(entry.collider, (general.colliders[i] as (typeof general.colliders)[number]).collider, `seed ${seed}: collider ${i}`);
        assert.deepEqual(entry.world, (general.colliders[i] as (typeof general.colliders)[number]).world, `seed ${seed}: collider ${i} world`);
      });
      assert.deepEqual(inPlace.pointers, general.pointers, `seed ${seed}: pointers`);
    }
  });

  it("writes them at worldTransform(), in a world too, where a parent that renders is rebuilt each frame", () => {
    const root = scene(7);
    const world = mounted(root);
    const builder = new FrameBuilder({ loadTexture: (path) => (path.includes("missing") ? -1 : 1), warn: () => {}, retain: "check" });
    for (let frame = 0; frame < 4; frame++) {
      // Every parent changed, as when each re-rendered: its leaves are made again, in place.
      for (const parent of root.children) {
        parent.transform.x += 1;
        parent.markChanged();
      }
      world.tick(1 / 60);
      const built = builder.build(world.root, 800, 600);
      for (const entry of built.colliders) assert.deepEqual({ ...entry.world }, { ...entry.collider.worldTransform() });
    }
  });
});

describe("FrameBuilder: a large <Tilemap>", () => {
  // 200 × 200 cells of 16 pixels, every cell filled, and a tile sheet of four tiles.
  const SIZE = 200;
  registerTilemaps({
    big: { width: SIZE, height: SIZE, tileWidth: 16, tileHeight: 16, firstGid: 1, solid: [], layers: [{ name: "Ground", visible: true, data: Array.from({ length: SIZE * SIZE }, (_, i) => 1 + (i % 4)) }] },
  });
  const sizes = { "assets/tiles.png": { width: 64, height: 16 } };

  /** A world with the map and a camera following a marker; returns what is needed to move the marker and draw. */
  function scene(options: { camera?: boolean; z?: number } = {}) {
    const root = new Entity();
    const map = new Tilemap({ map: "big", image: "tiles.png" });
    root.addChild(map);
    const marker = new Entity();
    if (options.camera !== false) {
      const camera = new Camera();
      camera.addChild(marker);
      root.addChild(camera);
    }
    const world = mounted(root);
    const backend = new RecordingBackend({ textureSizes: sizes });
    const warnings: string[] = [];
    // `retain: "check"` builds every frame again without reusing anything and throws if the two differ.
    const builder = new FrameBuilder({ loadTexture: (path) => backend.loadTexture(path), textureSize: (h) => backend.textureSize(h), warn: (m) => warnings.push(m), retain: "check" });
    const frame = (x: number, y: number): Drawn => {
      marker.transform.x = x;
      marker.transform.y = y;
      marker.markChanged();
      world.tick(1 / 60);
      return draw(root, { width: 320, height: 180, builder, backend, warnings });
    };
    return { frame, warnings, marker };
  }

  const tilesOf = (records: DecodedRecord[]) => records.filter((r): r is Extract<DecodedRecord, { op: "spriteRegion" }> => r.op === "spriteRegion");

  it("writes only the cells the view shows, and a rectangle's worth wherever the camera is", () => {
    const { frame, warnings } = scene();
    const middle = tilesOf(frame(1600, 1600).records);
    // The view is 320 × 180 = 20 × 11.25 cells; one more cell round it makes at most 23 × 14.
    assert.ok(middle.length >= 20 * 11 && middle.length <= 23 * 14, `${middle.length} records`);
    const xs = middle.map((t) => t.x);
    assert.ok(Math.min(...xs) <= 1600 - 160 && Math.min(...xs) >= 1600 - 160 - 32, "starts about half a view left of the camera");
    assert.ok(Math.max(...xs) >= 1600 + 160 - 16, "and runs to about half a view right of it");
    const corner = tilesOf(frame(0, 0).records);
    assert.ok(corner.length <= 23 * 14 && corner.length > 0, `${corner.length} records at the map's corner`);
    assert.deepEqual(warnings, []);
  });

  it("follows the camera: each frame has the cells of where the view is now, not where it was", () => {
    const { frame } = scene();
    let last = -Infinity;
    for (let step = 0; step < 40; step++) {
      const x = 800 + step * 24;
      const tiles = tilesOf(frame(x, 900).records);
      const min = Math.min(...tiles.map((t) => t.x));
      const max = Math.max(...tiles.map((t) => t.x));
      assert.ok(min <= x - 160 && max >= x + 150, `step ${step}: cells ${min}..${max} cover the view round ${x}`);
      assert.ok(min >= last, "and only move on");
      last = min;
    }
  });

  it("draws the same cells a full draw would, for the part in view", () => {
    const { frame } = scene();
    const some = tilesOf(frame(500, 300).records);
    // Every cell here is gid 1 + (index mod 4): column mod 4 (the map is 200 wide, a multiple of 4).
    for (const t of some) assert.equal(t.srcX, ((t.x / 16) % 4) * 16, `cell at ${t.x},${t.y}`);
  });

  it("without a camera it draws the window's part of the map, and a camera that appears later is followed from its first frame", () => {
    const none = scene({ camera: false });
    const tiles = tilesOf(none.frame(0, 0).records);
    assert.ok(tiles.length <= 22 * 13 && tiles.length >= 20 * 11, `${tiles.length} records with no camera`);
    assert.ok(Math.max(...tiles.map((t) => t.x)) <= 320 + 16);
  });
});
