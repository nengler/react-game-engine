import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Camera,
  Entity,
  Fade,
  Hud,
  NO_SHAKE,
  Particles,
  Screen,
  Text,
  Tilemap,
  World,
  freeze,
  registerTilemaps,
  shakeOn,
  type TilemapData,
} from "@tsengine/runtime";

import { createPlayer, RecordingBackend, type DecodedRecord, type PlayerConfig } from "../src/index.ts";

const SIZES = {
  "assets/tiles.png": { width: 30, height: 20 },
  "assets/font.png": { width: 80, height: 48 },
  "assets/props.png": { width: 64, height: 40 },
};

function run(
  root: PlayerConfig["root"],
  steps: number,
  config: Partial<PlayerConfig> = {},
  dts: number[] = []
): { backend: RecordingBackend; warnings: string[] } {
  const backend = new RecordingBackend({ textureSizes: SIZES });
  const warnings: string[] = [];
  for (const dt of dts) backend.queueInput({ dt });
  const player = createPlayer(backend, { root, retain: "check", warn: (m) => warnings.push(m), ...config });
  for (let i = 0; i < steps; i++) player.step();
  player.close();
  return { backend, warnings };
}
const ofOp = <T extends DecodedRecord["op"]>(frame: readonly DecodedRecord[], op: T): Extract<DecodedRecord, { op: T }>[] =>
  frame.filter((r): r is Extract<DecodedRecord, { op: T }> => r.op === op);

const MAP: TilemapData = {
  width: 4,
  height: 2,
  tileWidth: 10,
  tileHeight: 10,
  firstGid: 1,
  solid: [2],
  layers: [
    { name: "Back", visible: true, data: [1, 1, 0, 3, 0, 0, 0, 0] },
    { name: "Hidden", visible: false, data: [1, 1, 1, 1, 1, 1, 1, 1] },
    { name: "Front", visible: true, data: [0, 0, 0, 0, 5, 2, 0, 6], flips: [0, 0, 0, 0, 1, 2, 0, 4] },
  ],
};

describe("<Tilemap>", () => {
  registerTilemaps({ room: MAP });

  it("draws a record for each filled cell of each visible layer, from the right part of the sheet", () => {
    const { backend, warnings } = run(() => {
      const root = new Entity();
      const map = new Tilemap({ map: "room", image: "tiles.png" });
      map.transform.x = 100;
      map.transform.y = 50;
      root.addChild(map);
      return root;
    }, 1);
    assert.deepEqual(warnings, []);
    const tiles = ofOp(backend.lastFrame.records, "spriteRegion");
    // Back: cells 0, 1, 3 (tiles 1, 1, 3); Front: cells 4, 5, 7 (tiles 5, 2, 6). The hidden layer is not drawn.
    assert.equal(tiles.length, 6);
    const [first, , third] = tiles;
    assert.deepEqual([first?.x, first?.y, first?.srcX, first?.srcY, first?.srcW, first?.srcH], [100, 50, 0, 0, 10, 10]);
    assert.deepEqual(
      [third?.x, third?.y, third?.srcX, third?.srcY],
      [130, 50, 20, 0],
      "the 4th column, and tile 3 is the third in the sheet's first row"
    );
    const frontOne = tiles[3] as (typeof tiles)[number];
    assert.deepEqual(
      [frontOne.x, frontOne.y, frontOne.srcX, frontOne.srcY],
      [100 + 5, 50 + 10 + 5, 10, 10],
      "a flipped tile is placed by its middle: tile 5 is the second of the sheet's second row (3 columns)"
    );
    assert.deepEqual([frontOne.flipX, frontOne.flipY, frontOne.originX, frontOne.originY], [true, false, 5, 5]);
    assert.deepEqual([tiles[4]?.flipX, tiles[4]?.flipY], [false, true], "vertical flip");
    assert.equal(tiles[5]?.rotation.toFixed(4), (Math.PI / 2).toFixed(4), "diagonal alone: a quarter turn and a mirror");
    assert.equal(tiles[5]?.flipY, true);
  });

  it("draws one layer only when asked, and nothing, with one warning, for a map that is not registered", () => {
    const one = run(() => new Tilemap({ map: "room", image: "tiles.png", layer: "Front" }), 1);
    assert.equal(ofOp(one.backend.lastFrame.records, "spriteRegion").length, 3);
    const missing = run(() => new Tilemap({ map: "nowhere", image: "tiles.png" }), 3);
    assert.equal(ofOp(missing.backend.lastFrame.records, "spriteRegion").length, 0);
    assert.equal(missing.warnings.length, 1);
    assert.match(missing.warnings[0] as string, /no map of that name is registered/);
  });

  it("without `image`, cuts each tile from its own tileset's sheet: margins, spacing, and a taller tile on the bottom of its cell", () => {
    // Two tilesets: the ground (ids 1 to 6, the 3 × 2 sheet of 10 px tiles) and props (ids 20 on: 10 × 20 tiles with a margin of
    // 2 and spacing of 1, 3 across, in `props.png`). A third tileset has no sheet (a collection of images): its tiles are skipped.
    registerTilemaps({
      sets: {
        width: 3,
        height: 2,
        tileWidth: 10,
        tileHeight: 10,
        firstGid: 1,
        solid: [],
        layers: [{ name: "Ground", visible: true, data: [1, 6, 0, 0, 24, 40] }],
        tilesets: [
          { firstGid: 1, image: "tiles.png", columns: 3, tileWidth: 10, tileHeight: 10, margin: 0, spacing: 0 },
          { firstGid: 20, image: "props.png", columns: 3, tileWidth: 10, tileHeight: 20, margin: 2, spacing: 1 },
          { firstGid: 40, image: "", columns: 0, tileWidth: 10, tileHeight: 10, margin: 0, spacing: 0 },
        ],
      },
    });
    const { backend, warnings } = run(() => new Tilemap({ map: "sets" }), 1);
    assert.deepEqual(warnings, []);
    const tiles = ofOp(backend.lastFrame.records, "spriteRegion");
    assert.equal(tiles.length, 3, "tile 40 has no sheet, so it is not drawn from the wrong one");
    const [a, b, c] = tiles;
    assert.deepEqual([a?.x, a?.y, a?.srcX, a?.srcY, a?.srcW, a?.srcH], [0, 0, 0, 0, 10, 10]);
    assert.deepEqual([b?.x, b?.y, b?.srcX, b?.srcY], [10, 0, 20, 10], "tile 6: the last of the ground sheet");
    assert.notEqual(a?.texture, c?.texture, "the prop comes from its own sheet");
    // Tile 24 is the fifth of the props (frame 4: column 1, row 1): 2 + 1 × 11 across, 2 + 1 × 21 down; 10 × 20, drawn with its bottom
    // on the bottom of cell (1, 1), which ends at y 20, so its top is at 20 - 20.
    assert.deepEqual([c?.x, c?.y, c?.srcX, c?.srcY, c?.srcW, c?.srcH], [10, 0, 13, 23, 10, 20]);
    // With `image`, the map's tilesets are ignored and every tile is cut from that one sheet, as before.
    const one = run(() => new Tilemap({ map: "sets", image: "tiles.png" }), 1);
    assert.equal(
      ofOp(one.backend.lastFrame.records, "spriteRegion").every((r) => r.srcH === 10),
      true
    );
  });

  it("without `image` and with no sheet in the map, draws nothing and warns once", () => {
    const { backend, warnings } = run(() => new Tilemap({ map: "room" }), 3);
    assert.equal(ofOp(backend.lastFrame.records, "spriteRegion").length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /has no `image`, and the map names no tile sheet/);
  });

  it("is the same grid movement code asks: solid cells by cell and by pixel, markers by tile", async () => {
    const { getTilemap } = await import("@tsengine/runtime");
    const grid = getTilemap("room");
    assert.equal(grid.solidAt(1, 1), true, "tile 2 is solid");
    assert.equal(grid.solidAt(0, 0), false);
    assert.equal(grid.solidAt(-1, 0) || grid.solidAt(0, 9), false, "outside the map is empty");
    assert.equal(grid.solidAtPixel(15, 12), true);
    assert.deepEqual(grid.find("Back", 3), [[3, 0, 3]]);
    assert.throws(() => getTilemap("nope"), /No tilemap named 'nope' is registered \(registered: room/);
    assert.equal(grid.property("name"), undefined, "a map with no properties");
  });
});

describe("<Particles>", () => {
  const particles = (props: ConstructorParameters<typeof Particles>[0]) => new Particles(props);

  it("bursts when it starts emitting, lives for its lifetime, and then there are none", () => {
    const emitter = particles({ burst: 8, lifetime: 0.5, speed: 30, spread: 180, size: 2 });
    const world = new World();
    world.mount(emitter);
    world.tick(1 / 60);
    assert.equal(emitter.count, 8);
    for (let i = 0; i < 40; i++) world.tick(1 / 60);
    assert.equal(emitter.count, 0, "all gone after the lifetime");
    // Turned off and on again, it bursts again.
    emitter.emitting = false;
    world.tick(1 / 60);
    emitter.emitting = true;
    world.tick(1 / 60);
    assert.equal(emitter.count, 8);
  });

  it("emits at its rate, caps at max, and repeats exactly with the same seed", () => {
    const a = particles({ rate: 60, lifetime: 10, max: 5, seed: 7 });
    const b = particles({ rate: 60, lifetime: 10, max: 5, seed: 7 });
    const c = particles({ rate: 60, lifetime: 10, max: 5, seed: 8 });
    for (const e of [a, b, c]) {
      const world = new World();
      world.mount(e);
      for (let i = 0; i < 30; i++) world.tick(1 / 60);
    }
    assert.equal(a.count, 5);
    const at = (e: Particles) => {
      const out = { x: 0, y: 0, t: 0 };
      e.read(2, out);
      return [out.x, out.y];
    };
    assert.deepEqual(at(a), at(b));
    assert.notDeepEqual(at(a), at(c));
  });

  it("is drawn as squares that shrink, fade and move with gravity, in whole pixels", () => {
    const { backend } = run(
      () => {
        const root = new Entity();
        const e = particles({
          burst: 4,
          lifetime: 1,
          speed: 20,
          spread: 0,
          angle: 270,
          gravity: 100,
          color: "#ff0000",
          fade: true,
          shrink: true,
          size: 4,
        });
        e.transform.x = 50;
        e.transform.y = 60;
        root.addChild(e);
        return root;
      },
      40,
      {},
      Array.from({ length: 40 }, () => 1 / 30)
    );
    const first = ofOp(backend.frames[1]?.records ?? [], "rect");
    const later = ofOp(backend.frames[20]?.records ?? [], "rect");
    assert.equal(first.length, 4);
    assert.ok(first.every((r) => Number.isInteger(r.x) && Number.isInteger(r.y)));
    assert.ok(later.length > 0 && later.length <= 4);
    assert.ok((later[0]?.width ?? 99) < (first[0]?.width ?? 0), "smaller with age");
    assert.ok(parseInt((later[0]?.color ?? "#00000000").slice(7), 16) < 255, "fainter with age");
    assert.equal(ofOp(backend.frames[39]?.records ?? [], "rect").length, 0, "gone at the end");
  });

  it("starts particles anywhere in its area, and prewarmed starts full, each partway through its life", () => {
    const e = particles({ rate: 10, lifetime: 2, speed: 0, width: 100, height: 50, prewarm: true, max: 64 });
    e.transform.x = 20;
    const world = new World();
    world.mount(e);
    world.tick(1 / 60);
    assert.ok(e.count >= 15, `full at once (less any at the very end of their life): ${e.count}`);
    const out = { x: 0, y: 0, t: 0 };
    const xs: number[] = [];
    const ts: number[] = [];
    for (let i = 0; i < e.count; i++) {
      e.read(i, out);
      assert.ok(out.x >= 0 && out.x <= 100 && out.y >= 0 && out.y <= 50, "inside the area (in the emitter's space)");
      xs.push(out.x);
      ts.push(out.t);
    }
    assert.ok(Math.max(...xs) - Math.min(...xs) > 50, "spread across it");
    assert.ok(Math.max(...ts) - Math.min(...ts) > 0.5, "at different ages, so they do not all end together");
    const point = particles({ rate: 10, lifetime: 2, speed: 0 });
    const w2 = new World();
    w2.mount(point);
    w2.tick(1 / 60);
    assert.equal(point.count, 0, "not prewarmed: it fills in over time");
  });

  it("keeps world-space particles where they were made when the emitter moves", () => {
    const e = particles({ burst: 1, lifetime: 5, speed: 0, space: "world" });
    e.transform.x = 100;
    const world = new World();
    world.mount(e);
    world.tick(0.1);
    e.transform.x = 300;
    world.tick(0.1);
    const out = { x: 0, y: 0, t: 0 };
    e.read(0, out);
    assert.equal(out.x, 100);
  });
});

describe("<Fade>", () => {
  it("moves toward on and off by dt over its duration, and no further", () => {
    const f = new Fade({ color: "#000000", duration: 0.5 });
    const world = new World();
    world.mount(f);
    world.tick(0.1);
    assert.equal(f.amount, 0, "clear while off");
    f.on = true;
    world.tick(0.25);
    assert.equal(f.amount, 0.5);
    world.tick(0.5);
    assert.equal(f.amount, 1);
    f.on = false;
    world.tick(0.1);
    assert.ok(Math.abs(f.amount - 0.8) < 1e-9);
    const instant = new Fade({ on: true, duration: 0 });
    const w2 = new World();
    w2.mount(instant);
    w2.tick(1 / 60);
    assert.equal(instant.amount, 1);
  });

  it("draws its colour with the alpha of how far along it is", () => {
    const { backend } = run(() => {
      const screen = new Screen({ width: 64, height: 36 });
      const hud = new Hud();
      const fade = new Fade({ color: "#102030", on: true, duration: 0 });
      hud.addChild(fade);
      screen.addChild(hud);
      return screen;
    }, 3);
    const cover = ofOp(backend.lastFrame.records, "rect").find((r) => r.width === 64);
    assert.equal(cover?.color, "#102030ff");
  });
});

describe("<Camera> bounds, slide and shake", () => {
  const camera = (props: ConstructorParameters<typeof Camera>[0]): Camera => {
    const c = new Camera(props);
    c.viewWidth = 320;
    c.viewHeight = 180;
    return c;
  };

  it("keeps the view inside its bounds, centres it on bounds smaller than the view, and follows inside them", () => {
    const c = camera({ bounds: [0, 0, 640, 180] });
    const follow = new Entity();
    c.addChild(follow);
    const centreOf = (x: number): number => {
      follow.transform.x = x;
      return -c.viewTransform().e;
    };
    assert.equal(centreOf(10), 160, "pushed in from the left edge: the view's centre is half a view from it");
    assert.equal(centreOf(400), 400);
    assert.equal(centreOf(900), 480, "and from the right edge");
    const small = camera({ bounds: [100, 0, 200, 100] });
    small.addChild(new Entity());
    assert.equal(-small.viewTransform().e, 200, "an area smaller than the view is centred");
    const y = camera({ bounds: [0, 0, 640, 180] });
    assert.equal(y.viewTransform().f, -90, "vertical too: the 180 high area is exactly the view");
  });

  it("slides to the new bounds over its slide time instead of jumping, and stays put when nothing changes", () => {
    const c = camera({ bounds: [0, 0, 320, 180], slide: 0.4 });
    assert.equal(-c.viewTransform().e, 160);
    c.bounds = [320, 0, 320, 180];
    const first = -c.viewTransform().e;
    assert.equal(first, 160, "the first view after the change is still where it was");
    const seen: number[] = [first];
    for (let i = 0; i < 60; i++) {
      c.onUpdate(1 / 60);
      seen.push(-c.viewTransform().e);
    }
    assert.ok(
      seen.every((x, i) => i === 0 || x >= (seen[i - 1] as number)),
      "moves one way, never back"
    );
    assert.equal(seen.at(-1), 480, "and arrives");
    assert.ok(seen[10]! > 160 && seen[10]! < 480, "partway after ten steps");
    const none = camera({ bounds: [0, 0, 320, 180] });
    none.viewTransform();
    none.bounds = [320, 0, 320, 180];
    assert.equal(-none.viewTransform().e, 480, "no slide time: it jumps");
  });

  it("shakes by the shake it is given, in whole pixels, dying away over its duration, the same every run", () => {
    const run1 = (): number[] => {
      const c = camera({});
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 2) c.shake = { strength: 4, duration: 0.2 };
        else if (c.shake !== undefined) c.shake = shakeOn(c.shake, 1 / 60);
        c.onUpdate(1 / 60);
        out.push(c.viewTransform().e);
      }
      return out;
    };
    const a = run1();
    assert.deepEqual(a, run1());
    assert.ok(
      a.slice(0, 2).every((e) => e === 0),
      "still before it is set"
    );
    assert.ok(a.slice(2, 6).some((e) => e !== 0));
    assert.ok(a.every((e) => Number.isInteger(e) || e === 0));
    assert.ok(Math.max(...a.slice(2, 5).map(Math.abs)) <= 4);
    assert.ok(
      a.slice(-4).every((e) => e === 0),
      "over by the end"
    );
    assert.equal(shakeOn(NO_SHAKE, 0.1), NO_SHAKE, "no shake: the same object, so a state holding it does not change");
  });
});

describe("freeze frames", () => {
  class Counter extends Entity {
    updates = 0;
    inputs = 0;
    override onInput(): void {
      this.inputs++;
    }
    override onUpdate(): void {
      this.updates++;
    }
  }

  it("pauses onUpdate for the asked steps, starting with the next tick, while onInput and renders carry on", () => {
    const world = new World();
    const c = new Counter();
    world.mount(c);
    world.tick(1 / 60);
    freeze(3);
    world.tick(1 / 60);
    assert.deepEqual([c.updates, c.inputs], [2, 2], "the tick that asked still updates");
    for (let i = 0; i < 3; i++) world.tick(1 / 60);
    assert.deepEqual([c.updates, c.inputs], [2, 5]);
    world.tick(1 / 60);
    assert.equal(c.updates, 3);
  });
});

describe("bitmap fonts", () => {
  it("draw a region of the font sheet for each character but spaces, from a 16 × 6 grid, scaled to the size", () => {
    const { backend } = run(() => new Text({ text: "A B", font: "font.png", size: 16, color: "#ffcc00" }), 1);
    const glyphs = ofOp(backend.lastFrame.records, "spriteRegion");
    // The sheet is 80 × 48: cells of 5 × 8. A size of 16 is a scale of 2, so a glyph advances 10.
    assert.equal(glyphs.length, 2);
    assert.deepEqual(
      [glyphs[0]?.srcX, glyphs[0]?.srcY, glyphs[0]?.srcW, glyphs[0]?.srcH],
      [((65 - 32) % 16) * 5, Math.floor((65 - 32) / 16) * 8, 5, 8]
    );
    assert.deepEqual([glyphs[0]?.x, glyphs[1]?.x], [0, 20], "the space is skipped but still takes room");
    assert.equal(glyphs[0]?.scaleX, 2);
    assert.equal(glyphs[0]?.tint, "#ffcc00ff");
  });

  it("measure the text for layout by the glyph cell, and centre inside their width", () => {
    const { backend } = run(() => new Text({ text: "AB", font: "font.png", size: 8, width: 30, align: "center" }), 1);
    const glyphs = ofOp(backend.lastFrame.records, "spriteRegion");
    assert.equal(glyphs[0]?.x, 10, "30 wide, the 10 of text in the middle");
  });

  it("draw tse:small, the font built into libtse, from its 64 × 36 sheet: 4 pixels a character, 6 a line", () => {
    const { backend } = run(() => new Text({ text: "AB\nC", font: "tse:small", color: "white" }), 1);
    assert.ok(backend.textureLoads.includes("tse:small"), "loaded by its name, not from the assets folder");
    assert.ok(!backend.textureLoads.some((p) => p.endsWith("/tse:small")));
    const glyphs = ofOp(backend.lastFrame.records, "spriteRegion");
    assert.equal(glyphs.length, 3);
    assert.deepEqual(
      [glyphs[0]?.srcX, glyphs[0]?.srcY, glyphs[0]?.srcW, glyphs[0]?.srcH],
      [((65 - 32) % 16) * 4, Math.floor((65 - 32) / 16) * 6, 4, 6],
      "the cell of A"
    );
    assert.equal(glyphs[0]?.scaleX, 1, "no size given: drawn at the cell's own height");
    assert.deepEqual([glyphs[0]?.x, glyphs[1]?.x], [0, 4]);
    assert.deepEqual([glyphs[2]?.x, (glyphs[2]?.y ?? 0) - (glyphs[0]?.y ?? 0)], [0, 6], "the next line is 6 pixels down");
  });

  it("align without a width on their x: centred, or ending there, line by line", () => {
    const centre = run(() => new Text({ text: "AB\nC", font: "tse:small", align: "center" }), 1);
    const glyphs = ofOp(centre.backend.lastFrame.records, "spriteRegion");
    assert.deepEqual(
      glyphs.map((g) => g.x),
      [-4, 0, -2],
      "AB is 8 wide, so it starts 4 to the left; C is 4 wide, 2 to the left"
    );
    const right = run(() => new Text({ text: "AB", font: "tse:small", align: "right" }), 1);
    assert.deepEqual(
      ofOp(right.backend.lastFrame.records, "spriteRegion").map((g) => g.x),
      [-8, -4]
    );
  });

  it("refuse a tse: name that is not built in, naming the ones there are, and load nothing for it", () => {
    const { backend, warnings } = run(() => new Text({ text: "A", font: "tse:huge" }), 1);
    assert.ok(
      warnings.some((w) => w.includes("There is no built-in 'tse:huge' (there is: tse:small)")),
      warnings.join("\n")
    );
    assert.ok(!backend.textureLoads.some((p) => p.includes("tse:huge")));
  });

  it("show anything outside the font as a question mark", () => {
    const { backend } = run(() => new Text({ text: "é", font: "font.png", size: 8 }), 1);
    const g = ofOp(backend.lastFrame.records, "spriteRegion")[0];
    assert.equal(g?.srcX, ((63 - 32) % 16) * 5);
  });
});
