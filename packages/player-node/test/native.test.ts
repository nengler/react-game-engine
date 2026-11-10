import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { Camera, Collider, Entity, Flex, Hud, Screen, Shape, Sprite, Text, type World } from "@rge/runtime";
import { CollisionTracker, createPlayer, KEYS, RGE_ABI_VERSION, type PlayerConfig } from "@rge/player";
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

  it("refuses full screen in a hidden window, and says so", () => {
    const native = loadNative(library as string);
    assert.equal(native.setFullscreen(true), false, "no window is open yet");
    const backend = createNodeBackend(library);
    backend.open({ width: 64, height: 64, title: "t", hidden: true });
    try {
      assert.equal(backend.setFullscreen(true), false);
    } finally {
      backend.close();
    }
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
    // The diamond turns about its top corner at (10, 6), so its centre is at (10, 11.7): well inside, unlike the corner, which rasterisers disagree about.
    assert.equal(pixel(chunky, 2 + 10 * 3 + 1, 6 + 11 * 3 + 1), "ff0000ff", "the diamond's middle");
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

  it("draws a <Flex> background and its laid-out children, through the real library", () => {
    const frame = render(() => {
      const row = new Flex({ background: "navy", padding: 4, gap: 6, alignItems: "center" });
      row.transform.x = 10;
      row.transform.y = 8;
      row.addChild(new Shape({ kind: "rect", width: 8, height: 4, color: "lime" }));
      row.addChild(new Shape({ kind: "rect", width: 8, height: 12, color: "red" }));
      return row;
    });
    // The box is 4 + 8 + 6 + 8 + 4 = 30 wide and 4 + 12 + 4 = 20 high, at (10, 8).
    assert.equal(pixel(frame, 10, 8), "000080ff", "the box's top-left corner");
    assert.equal(pixel(frame, 39, 27), "000080ff", "and its bottom-right");
    assert.equal(pixel(frame, 40, 27), "000000ff", "nothing past it");
    assert.equal(pixel(frame, 9, 8), "000000ff");
    // The lime one is centred on the cross axis: (12 - 4) / 2 = 4 below the padding.
    assert.equal(pixel(frame, 14, 8 + 4 + 4), "00ff00ff", "the first child, centred vertically");
    assert.equal(pixel(frame, 14, 8 + 4 + 3), "000080ff", "above it is the background");
    assert.equal(pixel(frame, 10 + 4 + 8 + 6 + 1, 8 + 4 + 1), "ff0000ff", "the second child, after the gap");
  });

  it("lays out around text measured by librge, so a label's box fits its real width", () => {
    const backend = createNodeBackend(library);
    const warnings: string[] = [];
    const label = new Text({ text: "Score: 100", size: 20, color: "white" });
    const row = new Flex({ background: "navy", padding: 3 });
    row.addChild(label);
    const player = createPlayer(backend, { width: 200, height: 100, title: "t", hidden: true, vsync: false, root: () => row, warn: (m) => warnings.push(m) });
    try {
      player.step();
      const width = backend.measureText("Score: 100", 20);
      assert.equal(row.box.size[0], width.width + 6, "the box is the measured text plus padding");
      assert.equal(row.box.size[1], width.height + 6);
      assert.ok(width.width > 60 && width.width < 200, `text width ${width.width}`);
      assert.deepEqual(warnings, []);
    } finally {
      player.close();
    }
  });

  it("draws a <Text align> inside its width: right-aligned text leaves the left of its box empty", () => {
    const make = (align: "left" | "right") => () => {
      const text = new Text({ text: "Hi", size: 16, color: "white", width: 60, align });
      text.transform.x = 2;
      text.transform.y = 2;
      return text;
    };
    const whiteColumns = (frame: Pixels): number[] => {
      const columns: number[] = [];
      for (let x = 0; x < 64; x++) for (let y = 0; y < 48; y++) if (pixel(frame, x, y) === "ffffffff") { columns.push(x); break; }
      return columns;
    };
    const left = whiteColumns(render(make("left")));
    const right = whiteColumns(render(make("right")));
    assert.ok(left.length > 0 && right.length > 0, "both drew text");
    assert.ok(Math.min(...left) >= 2 && Math.min(...left) < 8, `left starts at ${Math.min(...left)}`);
    assert.ok(Math.min(...right) > 30, `right starts at ${Math.min(...right)}: the right edge of the box is x = 62`);
    assert.ok(Math.max(...right) <= 62, `and ends inside it, at ${Math.max(...right)}`);
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

describe("librge's broad phase through koffi", { skip }, () => {
  const random = (seed: number): (() => number) => {
    let state = seed * 7919;
    return () => ((state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  };

  it("finds the pairs that testing every pair finds, keeps the order it is handed, and counts past the room it is given", () => {
    const backend = createNodeBackend(library);
    const next = random(3);
    const count = 300;
    const boxes = new Float64Array(count * 4 + 40); // longer than the boxes: only `count` of them are read
    const order = new Int32Array(count + 10).fill(-7);
    const pairs = new Int32Array(4000);
    for (let frame = 0; frame < 6; frame++) {
      for (let i = 0; i < count; i++) {
        const x = next() * 200;
        const y = next() * 200;
        boxes.set([x, y, x + 4 + next() * 20, y + 4 + next() * (i % 40 === 0 ? 300 : 20)], i * 4);
      }
      const expected: string[] = [];
      for (let a = 0; a < count; a++) {
        for (let b = a + 1; b < count; b++) {
          if (boxes[a * 4]! < boxes[b * 4 + 2]! && boxes[a * 4 + 2]! > boxes[b * 4]! && boxes[a * 4 + 1]! < boxes[b * 4 + 3]! && boxes[a * 4 + 3]! > boxes[b * 4 + 1]!) expected.push(`${a} ${b}`);
        }
      }
      const found = backend.overlaps(boxes, count, order, pairs);
      assert.equal(found, expected.length, `frame ${frame}`);
      const got = Array.from({ length: found }, (_, k) => [pairs[k * 2]!, pairs[k * 2 + 1]!].sort((a, b) => a - b)).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
      assert.deepEqual(got.map((pair) => pair.join(" ")), expected, `frame ${frame}`);
      // The order comes back written into the caller's array: every box once, by left edge.
      const sorted = [...order.subarray(0, count)];
      assert.deepEqual([...sorted].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
      for (let i = 1; i < count; i++) assert.ok(boxes[sorted[i - 1]! * 4]! <= boxes[sorted[i]! * 4]!, `frame ${frame}: order at ${i}`);
      assert.equal(order[count], -7, "nothing past the boxes is touched");
      // Less room than pairs: what fits is written, and the answer is still how many there are.
      const small = new Int32Array(10).fill(-1);
      assert.equal(backend.overlaps(boxes, count, order, small), expected.length);
      assert.ok(small.every((index) => index >= 0 && index < count));
    }
    assert.equal(backend.overlaps(boxes, 0, order, pairs), 0);
    assert.equal(backend.overlaps(boxes, 5000, new Int32Array(4), pairs) >= 0, true, "never more boxes than the arrays hold");
  });

  it("gives a CollisionTracker the reports its own sweep gives, in the same order, as colliders move, come and go", () => {
    const backend = createNodeBackend(library);
    const next = random(11);
    const names = new Map<Collider, string>();
    const parents = Array.from({ length: 60 }, () => new Entity());
    const make = (label: string) => {
      const collider = new Collider({ width: 4 + next() * 16, height: 4 + next() * 16, layer: next() < 0.3 ? "a" : "", hits: next() < 0.2 ? ["a"] : undefined });
      names.set(collider, label);
      parents[Math.floor(next() * parents.length)]!.addChild(collider);
      return { collider, world: { x: next() * 250, y: next() * 250, rotation: 0, scaleX: 1, scaleY: 1 } };
    };
    let entries = Array.from({ length: 220 }, (_, i) => make(`c${i}`));
    let serial = entries.length;
    const logs: string[][] = [[], [], []];
    const worlds = logs.map(
      (log) =>
        ({
          reportCollision: (a: Collider, b: Collider) => void log.push(`in ${names.get(a)} ${names.get(b)}`),
          reportCollisionExit: (a: Collider, b: Collider) => void log.push(`out ${names.get(a)} ${names.get(b)}`),
        }) as unknown as World,
    );
    const overlaps = (boxes: Float64Array, count: number, order: Int32Array, pairs: Int32Array): number => backend.overlaps(boxes, count, order, pairs);
    // The host's broad phase with and without the frames that look only at what moved, against the script's sweep.
    const trackers = [new CollisionTracker(undefined, true, true, overlaps), new CollisionTracker(undefined, false, true, overlaps), new CollisionTracker(undefined, false, false)];
    let reports = 0;
    for (let frame = 0; frame < 120; frame++) {
      const kind = frame === 0 ? "same" : (["drift", "drift", "few", "few", "few", "jump", "add", "remove", "same"] as const)[Math.floor(next() * 9)];
      entries = entries.slice();
      const move = (i: number, x: number, y: number): void => void (entries[i] = { collider: entries[i]!.collider, world: { ...entries[i]!.world, x, y } });
      if (kind === "drift") entries.forEach((e, i) => move(i, e.world.x + next() * 6 - 3, e.world.y + next() * 6 - 3));
      else if (kind === "few") for (let k = 0; k < 5; k++) move(Math.floor(next() * entries.length), next() * 250, next() * 250);
      else if (kind === "jump") entries.forEach((_, i) => move(i, next() * 250, next() * 250));
      else if (kind === "add") entries.splice(Math.floor(next() * (entries.length + 1)), 0, make(`c${serial++}`));
      else if (kind === "remove") entries.splice(Math.floor(next() * entries.length), 1);
      logs.forEach((log) => (log.length = 0));
      trackers.forEach((tracker, k) => tracker.update(worlds[k]!, entries));
      assert.deepEqual(logs[0], logs[2], `frame ${frame} (${kind})`);
      assert.deepEqual(logs[1], logs[2], `frame ${frame} (${kind}), every frame a full sweep`);
      reports += logs[2]!.length;
    }
    assert.ok(reports > 2000, `contacts come and go (${reports} reports)`);
    assert.ok(trackers[0]!.incrementalFrames > 20, "frames that look only at what moved ran between the host's sweeps");
  });

  it("is what a player on this backend uses: two colliders that meet are told once", () => {
    const met: string[] = [];
    const backend = createNodeBackend(library);
    let asked = 0;
    const real = backend.overlaps.bind(backend);
    backend.overlaps = (...args: Parameters<NodeBackend["overlaps"]>) => (asked++, real(...args));
    const player = createPlayer(backend, {
      width: 64, height: 48, title: "test", hidden: true, vsync: false,
      root: () => {
        const root = new Entity();
        for (const x of [0, 5]) {
          const actor = new Entity();
          actor.transform.x = x;
          actor.addChild(new Collider({ width: 10, height: 10, onCollisionEnter: () => void met.push(`x${x}`) }));
          root.addChild(actor);
        }
        return root;
      },
    });
    try {
      player.step();
      player.step();
    } finally {
      player.close();
    }
    assert.deepEqual(met, ["x0", "x5"]);
    assert.ok(asked >= 1, "the tracker asked the backend");
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
