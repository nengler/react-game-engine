import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AnimatedSprite, Camera, Collider, Entity, GameObject, Pointer, Shape, Sprite, Text, World } from "@rge/runtime";
import { Hero } from "../../example/generated/Hero.ts";
import { Level } from "../../example/generated/Level.ts";
import { FrameBuilder, walkTree } from "../src/draw.ts";
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

  it("visits parents before children, children in order", () => {
    const root = new Entity({ name: "root" });
    const a = new Entity({ name: "a" });
    const b = new Entity({ name: "b" });
    const a1 = new Entity({ name: "a1" });
    root.addChild(a);
    root.addChild(b);
    a.addChild(a1);
    const seen: string[] = [];
    walkTree(root, (object) => seen.push((object as Entity).name));
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
