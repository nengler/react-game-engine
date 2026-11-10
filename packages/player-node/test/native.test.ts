import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { Camera, Entity, Hud, Screen, Shape, Sprite, Text } from "@rge/runtime";
import { createPlayer, KEYS, RGE_ABI_VERSION, type PlayerConfig } from "@rge/player";
import { NodeBackend, checkAbi, createNodeBackend, findNativeLibrary, loadNative, type Pixels } from "../src/index.ts";

/**
 * These run the real `librge`, on the software renderer when it is the headless build (no window, no
 * GPU). Without a built library they are skipped, unless RGE_REQUIRE_NATIVE=1 (CI), where that is a failure.
 */
const library = findNativeLibrary("headless");
const required = process.env["RGE_REQUIRE_NATIVE"] === "1";
const skip = library === null && !required ? "librge is not built (npm run native:build:headless)" : false;

const scratch = mkdtempSync(join(tmpdir(), "rge-node-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A solid-colour PNG, so sprites can be tested without binary fixtures. */
function writePng(path: string, size: number, [r, g, b]: [number, number, number]): void {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

function pixel(frame: Pixels, x: number, y: number): string {
  const at = (y * frame.width + x) * 4;
  return [...frame.rgba.subarray(at, at + 4)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Open a hidden window, draw the tree for two frames, read the pixels back, and close. */
function render(root: PlayerConfig["root"], options: Partial<PlayerConfig> = {}): Pixels {
  const backend = createNodeBackend(library);
  const warnings: string[] = [];
  const player = createPlayer(backend, { width: 64, height: 48, title: "test", hidden: true, vsync: false, root, warn: (m) => warnings.push(m), ...options });
  try {
    player.step();
    player.step();
    const frame = backend.readPixels();
    assert.ok(frame !== null, "a hidden window keeps its frames");
    assert.deepEqual(warnings, []);
    return frame;
  } finally {
    player.close();
  }
}

describe("librge through koffi", { skip }, () => {
  it("matches the ABI this package was written against", () => {
    const native = loadNative(library as string);
    assert.equal(native.abiVersion(), RGE_ABI_VERSION);
    assert.equal(native.keyCount(), KEYS.length);
  });

  it("measures text and textures through librge", () => {
    const png = join(scratch, "measured.png");
    writePng(png, 6, [255, 0, 0]);
    const backend = createNodeBackend(library);
    try {
      backend.open({ width: 64, height: 48, title: "measure", hidden: true, vsync: false });
      const small = backend.measureText("Hello", 10);
      const large = backend.measureText("Hello", 20);
      assert.ok(small.width > 0 && large.width > 1.9 * small.width, `widths ${small.width} and ${large.width}`);
      assert.ok(large.height >= 20, `line height ${large.height}`);
      assert.equal(backend.measureText("", 20).width, 0);
      const texture = backend.loadTexture(png);
      assert.deepEqual(backend.textureSize(texture), { width: 6, height: 6 });
      assert.throws(() => backend.textureSize(999), /no texture/);
    } finally {
      backend.close();
    }
  });

  it("draws a rect where the player put it, over the background", () => {
    const frame = render(() => {
      const root = new Entity();
      const rect = new Shape({ kind: "rect", width: 20, height: 10, color: "red" });
      rect.transform.x = 10;
      rect.transform.y = 5;
      root.addChild(rect);
      return root;
    }, { background: "#102030" });
    assert.equal(frame.width, 64);
    assert.equal(frame.height, 48);
    assert.equal(pixel(frame, 15, 8), "ff0000ff", "inside the rect");
    assert.equal(pixel(frame, 5, 8), "102030ff", "background");
    assert.equal(pixel(frame, 15, 20), "102030ff", "below the rect: rows are top first");
  });

  it("draws a circle, rotated and scaled shapes, and text", () => {
    const frame = render(() => {
      const root = new Entity();
      const circle = new Shape({ kind: "circle", width: 20, height: 20, color: "lime" });
      circle.transform.x = 2;
      circle.transform.y = 2;
      root.addChild(circle);
      const label = new Text({ text: "Hi", size: 20, color: "white" });
      label.transform.x = 30;
      label.transform.y = 4;
      root.addChild(label);
      return root;
    });
    assert.equal(pixel(frame, 12, 12), "00ff00ff", "circle centre");
    assert.equal(pixel(frame, 3, 3), "000000ff", "circle corner is background");
    let white = 0;
    for (let y = 4; y < 28; y++) for (let x = 30; x < 62; x++) if (pixel(frame, x, y) === "ffffffff") white++;
    assert.ok(white > 10, `text drew ${white} white pixels`);
  });

  it("puts the camera's point in the middle of the window", () => {
    const frame = render(() => {
      const root = new Entity();
      const camera = new Camera();
      camera.transform.x = 100;
      camera.transform.y = 50;
      root.addChild(camera);
      const marker = new Shape({ kind: "rect", width: 4, height: 4, color: "blue" });
      marker.transform.x = 100;
      marker.transform.y = 50;
      root.addChild(marker);
      return root;
    });
    assert.equal(pixel(frame, 33, 25), "0000ffff", "marker at the world point the camera is at");
    assert.equal(pixel(frame, 5, 5), "000000ff");
  });

  it("scales a <Screen> into the window and covers the rest with its border", () => {
    // A 20 × 12 game in a 64 × 48 window: ×3 is the largest whole scale, so 60 × 36 at (2, 6).
    const frame = render(() => {
      const screen = new Screen({ width: 20, height: 12, border: "blue" });
      screen.addChild(new Shape({ kind: "rect", width: 20, height: 12, color: "red" }));
      const dot = new Shape({ kind: "rect", width: 1, height: 1, color: "lime" });
      dot.transform.x = 5;
      dot.transform.y = 4;
      screen.addChild(dot);
      return screen;
    });
    assert.equal(pixel(frame, 2, 6), "ff0000ff", "the game's top-left pixel");
    assert.equal(pixel(frame, 61, 41), "ff0000ff", "the game's bottom-right pixel");
    for (const [x, y] of [[17, 18], [19, 20]] as const) assert.equal(pixel(frame, x, y), "00ff00ff", `game pixel (5, 4) covers window (${x}, ${y})`);
    assert.equal(pixel(frame, 20, 18), "ff0000ff", "and stops after three window pixels");
    for (const [x, y] of [[1, 20], [62, 20], [30, 5], [30, 42], [0, 0], [63, 47]] as const) assert.equal(pixel(frame, x, y), "0000ffff", `border at (${x}, ${y})`);
  });

  it("keeps a turned shape on the game's pixel grid when the game is pixel-perfect, and not when it is not", () => {
    const make = (pixelPerfect: boolean) => () => {
      const screen = new Screen({ width: 20, height: 12, border: "blue", pixelPerfect });
      const diamond = new Shape({ kind: "rect", width: 8, height: 8, color: "red" });
      diamond.transform.x = 10;
      diamond.transform.y = 6;
      diamond.transform.rotation = Math.PI / 4;
      screen.addChild(diamond);
      return screen;
    };
    // The game is 20 × 12 at ×3, at (2, 6) in a 64 × 48 window. Every game pixel is a 3 × 3 block of one colour when pixel-perfect.
    const chunky = render(make(true));
    for (let gy = 0; gy < 12; gy++) {
      for (let gx = 0; gx < 20; gx++) {
        const first = pixel(chunky, 2 + gx * 3, 6 + gy * 3);
        for (const [dx, dy] of [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]] as const) {
          assert.equal(pixel(chunky, 2 + gx * 3 + dx, 6 + gy * 3 + dy), first, `game pixel (${gx}, ${gy}) is one colour`);
        }
      }
    }
    assert.equal(pixel(chunky, 2 + 10 * 3 + 1, 6 + 6 * 3 + 1), "ff0000ff", "the diamond's middle");
    assert.equal(pixel(chunky, 0, 0), "0000ffff", "the border");
    const smooth = render(make(false));
    let blocky = true;
    for (let gy = 0; gy < 12 && blocky; gy++) {
      for (let gx = 0; gx < 20 && blocky; gx++) blocky = pixel(smooth, 2 + gx * 3, 6 + gy * 3) === pixel(smooth, 2 + gx * 3 + 2, 6 + gy * 3 + 2);
    }
    assert.ok(!blocky, "drawn at the window's resolution, the diamond's edge is finer than a game pixel");
  });

  it("draws a <Hud> over the world, where it is put, whatever the camera does, in both pixel-perfect modes", () => {
    for (const pixelPerfect of [true, false]) {
      const frame = render(() => {
        const screen = new Screen({ width: 20, height: 12, border: "blue", pixelPerfect });
        const camera = new Camera({ zoom: 2 });
        camera.transform.x = 7;
        camera.transform.y = 3;
        screen.addChild(camera);
        const world = new Shape({ kind: "rect", width: 400, height: 400, color: "red" });
        world.transform.x = -200;
        world.transform.y = -200;
        screen.addChild(world);
        const layer = new Hud();
        const badge = new Shape({ kind: "rect", width: 4, height: 2, color: "lime" });
        badge.transform.x = 1;
        badge.transform.y = 1;
        layer.addChild(badge);
        screen.addChild(layer);
        return screen;
      });
      assert.equal(pixel(frame, 2 + 1 * 3, 6 + 1 * 3), "00ff00ff", `the badge's corner (${pixelPerfect})`);
      assert.equal(pixel(frame, 2 + 4 * 3, 6 + 2 * 3), "00ff00ff", `the badge's far corner (${pixelPerfect})`);
      assert.equal(pixel(frame, 2 + 5 * 3 + 1, 6 + 1 * 3), "ff0000ff", `the world next to it (${pixelPerfect})`);
      assert.equal(pixel(frame, 0, 0), "0000ffff", `the border (${pixelPerfect})`);
    }
  });

  it("keeps the border over anything drawn past the game, under a turned camera", () => {
    const frame = render(() => {
      const screen = new Screen({ width: 20, height: 12, border: "blue" });
      const camera = new Camera({ zoom: 1.3 });
      camera.transform.rotation = 0.6;
      screen.addChild(camera);
      const big = new Shape({ kind: "rect", width: 400, height: 400, color: "red" });
      big.transform.x = -200;
      big.transform.y = -200;
      screen.addChild(big);
      return screen;
    });
    assert.equal(pixel(frame, 32, 24), "ff0000ff", "the middle of the game");
    for (let x = 0; x < 64; x++) {
      assert.equal(pixel(frame, x, 0), "0000ffff", `top border at x=${x}`);
      assert.equal(pixel(frame, x, 47), "0000ffff", `bottom border at x=${x}`);
    }
    for (let y = 0; y < 48; y++) {
      assert.equal(pixel(frame, 0, y), "0000ffff", `left border at y=${y}`);
      assert.equal(pixel(frame, 63, y), "0000ffff", `right border at y=${y}`);
    }
  });

  it("draws what has a higher z on top, whatever the tree order, and equal z in tree order", () => {
    const frame = render(() => {
      const root = new Entity();
      // Tree order: red, green, blue, all overlapping at (10..30, 10..30), offset so each leaves a corner showing.
      const make = (color: string, x: number, z: number): Shape => {
        const rect = new Shape({ kind: "rect", width: 20, height: 20, color });
        rect.transform.x = x;
        rect.transform.y = 10;
        rect.transform.z = z;
        root.addChild(rect);
        return rect;
      };
      make("red", 10, 2);
      make("lime", 20, 0);
      make("blue", 30, 0);
      return root;
    });
    assert.equal(pixel(frame, 25, 20), "ff0000ff", "red is first in the tree but has the highest z, so it covers green");
    assert.equal(pixel(frame, 35, 20), "0000ffff", "blue and green are equal: blue is later, so on top");
    assert.equal(pixel(frame, 45, 20), "0000ffff");
    assert.equal(pixel(frame, 12, 20), "ff0000ff");
  });

  it("loads a texture through the assets folder and flips it with a negative scale", () => {
    writePng(join(scratch, "red.png"), 8, [255, 0, 0]);
    const build = (scaleX: number) => () => {
      const root = new Entity();
      const sprite = new Sprite({ image: "red.png" });
      sprite.transform.x = 20;
      sprite.transform.y = 10;
      sprite.transform.scaleX = scaleX;
      root.addChild(sprite);
      return root;
    };
    const plain = render(build(1), { assets: scratch });
    assert.equal(pixel(plain, 24, 14), "ff0000ff");
    assert.equal(pixel(plain, 16, 14), "000000ff");
    const flipped = render(build(-1), { assets: scratch });
    assert.equal(pixel(flipped, 16, 14), "ff0000ff", "drawn to the left of its origin");
    assert.equal(pixel(flipped, 24, 14), "000000ff");
  });

  it("draws a magenta square for a texture that does not exist, with one warning", () => {
    const backend = createNodeBackend(library);
    const warnings: string[] = [];
    const player = createPlayer(backend, {
      width: 64, height: 48, title: "t", hidden: true, vsync: false, assets: scratch,
      warn: (m) => warnings.push(m),
      root: () => {
        const root = new Entity();
        root.addChild(new Sprite({ image: "nope.png" }));
        return root;
      },
    });
    try {
      player.step();
      player.step();
      assert.equal(pixel(backend.readPixels() as Pixels, 5, 5), "ff00ffff");
      assert.equal(warnings.length, 1);
    } finally {
      player.close();
    }
  });

  it("reports the window size, and no one asking to quit", () => {
    const backend = createNodeBackend(library);
    const player = createPlayer(backend, { width: 80, height: 60, title: "t", hidden: true, vsync: false, root: () => new Entity() });
    try {
      assert.equal(player.step(), true);
    } finally {
      player.close();
    }
  });

  it("refuses to open a second window while one is open, and can open again after close", () => {
    const first = new NodeBackend(loadNative(library as string));
    first.open({ width: 16, height: 16, title: "a", hidden: true });
    assert.throws(() => first.open({ width: 16, height: 16, title: "b", hidden: true }), /librge error/);
    first.close();
    first.open({ width: 16, height: 16, title: "c", hidden: true });
    first.close();
  });
});

describe("loading the library", () => {
  it("explains how to build it when it is missing", () => {
    assert.throws(() => createNodeBackend(null), /npm run native:build/);
  });

  it("finds the library named by RGE_NATIVE_LIB, or none when that file is missing", () => {
    assert.equal(findNativeLibrary("desktop", { RGE_NATIVE_LIB: join(scratch, "missing.so") }), null);
    writeFileSync(join(scratch, "fake.so"), "");
    assert.equal(findNativeLibrary("desktop", { RGE_NATIVE_LIB: join(scratch, "fake.so") }), join(scratch, "fake.so"));
  });

  it("rejects a library whose ABI version or key count differs, naming both", () => {
    assert.throws(() => checkAbi({ abiVersion: () => RGE_ABI_VERSION + 1, keyCount: () => KEYS.length }), new RegExp(`version ${RGE_ABI_VERSION + 1}.*expects ${RGE_ABI_VERSION}`));
    assert.throws(() => checkAbi({ abiVersion: () => RGE_ABI_VERSION, keyCount: () => KEYS.length - 1 }), new RegExp(`has ${KEYS.length - 1} keys.*expects ${KEYS.length}`));
    assert.doesNotThrow(() => checkAbi({ abiVersion: () => RGE_ABI_VERSION, keyCount: () => KEYS.length }));
  });
});
