import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Entity, Fade, Hud, Particles, Screen, Sprite, Text, Tilemap, registerTilemaps } from "@rge/runtime";
import { createPlayer, type PlayerConfig } from "@rge/player";
import { createNodeBackend, encodePng, findNativeLibrary, type Pixels } from "../src/index.ts";

/** What tiles, sprite sheets, particles, fades and bitmap fonts really look like, through the software renderer. */
const library = findNativeLibrary("headless");
const required = process.env["RGE_REQUIRE_NATIVE"] === "1";
const skip = library === null && !required ? "librge is not built (npm run native:build:headless)" : false;

const scratch = mkdtempSync(join(tmpdir(), "rge-feel-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const GREEN: [number, number, number] = [0, 255, 0];

function sheet(name: string, width: number, height: number, color: (x: number, y: number) => [number, number, number] | null): void {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = color(x, y);
      rgba.set(c === null ? [0, 0, 0, 0] : [...c, 255], (y * width + x) * 4);
    }
  }
  writeFileSync(join(scratch, name), encodePng({ width, height, rgba }));
}

// A 20 × 10 tile sheet: tile 1 has a red left half and a blue right half; tile 2 is green with a red top row.
sheet("tiles.png", 20, 10, (x, y) => (x < 10 ? (x < 5 ? RED : BLUE) : y === 0 ? RED : GREEN));
// A 5 × 8 font with a single lit pixel per glyph at its top left, 16 × 6 cells.
sheet("font.png", 80, 48, (x, y) => (x % 5 === 0 && y % 8 === 0 ? GREEN : null));

const pixel = (frame: Pixels, x: number, y: number): string => {
  const at = (y * frame.width + x) * 4;
  return [...frame.rgba.subarray(at, at + 3)].map((v) => v.toString(16).padStart(2, "0")).join("");
};

function render(root: PlayerConfig["root"], steps = 2): Pixels {
  const backend = createNodeBackend(library);
  const warnings: string[] = [];
  const player = createPlayer(backend, { width: 64, height: 32, title: "t", hidden: true, vsync: false, assets: scratch, background: "#000000", root, warn: (m) => warnings.push(m) });
  try {
    for (let i = 0; i < steps; i++) player.step();
    const frame = backend.readPixels();
    assert.ok(frame !== null);
    assert.deepEqual(warnings, []);
    return frame;
  } finally {
    player.close();
  }
}

describe("drawing the new built-ins in a hidden window", { skip }, () => {
  it("draws tiles from a sheet, mirrored and turned as Tiled says", () => {
    registerTilemaps({
      native: {
        width: 4, height: 1, tileWidth: 10, tileHeight: 10, firstGid: 1, solid: [],
        layers: [{ name: "T", visible: true, data: [1, 1, 1, 2], flips: [0, 1, 6, 0] }],
      },
    });
    const frame = render(() => new Tilemap({ map: "native", image: "tiles.png" }));
    assert.equal(pixel(frame, 2, 5), "ff0000", "tile 1 as it is: red on the left");
    assert.equal(pixel(frame, 7, 5), "0000ff", "and blue on the right");
    assert.equal(pixel(frame, 12, 5), "0000ff", "mirrored left to right: blue first");
    assert.equal(pixel(frame, 17, 5), "ff0000");
    // Tile 3: the diagonal and vertical flips (6) = a quarter turn counter-clockwise: the red left half ends up at the bottom.
    assert.equal(pixel(frame, 25, 8), "ff0000", "turned: red at the bottom");
    assert.equal(pixel(frame, 25, 1), "0000ff", "and blue at the top");
    assert.equal(pixel(frame, 35, 5), "00ff00", "tile 2 is green");
    assert.equal(pixel(frame, 35, 0), "ff0000", "with a red top row");
  });

  it("draws a frame of a sheet, mirrored about its origin, with a tint and an opacity", () => {
    const frame = render(() => {
      const root = new Entity();
      const plain = new Sprite({ image: "tiles.png", frameWidth: 10, frameHeight: 10, frame: 0 });
      plain.transform.x = 2;
      const mirrored = new Sprite({ image: "tiles.png", frameWidth: 10, frameHeight: 10, frame: 0, flipX: true, originX: 10 });
      mirrored.transform.x = 40;
      mirrored.transform.y = 12;
      const faint = new Sprite({ image: "tiles.png", frameWidth: 10, frameHeight: 10, frame: 1, opacity: 0.5 });
      faint.transform.y = 20;
      root.addChild(plain);
      root.addChild(mirrored);
      root.addChild(faint);
      return root;
    });
    assert.equal(pixel(frame, 4, 3), "ff0000", "frame 0, red left");
    assert.equal(pixel(frame, 9, 3), "0000ff");
    // Mirrored about an origin at its right edge: the picture swings round that line, so it lies to the right of the position, blue first.
    assert.equal(pixel(frame, 42, 15), "0000ff");
    assert.equal(pixel(frame, 47, 15), "ff0000");
    assert.equal(pixel(frame, 35, 15), "000000", "nothing left of the origin");
    // Half opacity over black: green (0, 255, 0) at about half.
    const g = Number.parseInt(pixel(frame, 5, 26).slice(2, 4), 16);
    assert.ok(g > 100 && g < 160, `half-faint green is ${g}`);
  });

  it("covers the screen with a Fade's colour, and a particle is a square of its colour", () => {
    const frame = render(() => {
      const screen = new Screen({ width: 64, height: 32, fit: "stretch" });
      const world = new Entity();
      const emitter = new Particles({ burst: 1, lifetime: 5, speed: 0, size: 6, color: "#ffff00" });
      emitter.transform.x = 20;
      emitter.transform.y = 10;
      world.addChild(emitter);
      screen.addChild(world);
      return screen;
    });
    assert.equal(pixel(frame, 20, 10), "ffff00", "the particle");
    const covered = render(() => {
      const screen = new Screen({ width: 64, height: 32, fit: "stretch" });
      const hud = new Hud();
      hud.addChild(new Fade({ color: "#202080", on: true, duration: 0 }));
      screen.addChild(new Tilemap({ map: "native", image: "tiles.png" }));
      screen.addChild(hud);
      return screen;
    }, 3);
    assert.equal(pixel(covered, 3, 3), "202080");
    assert.equal(pixel(covered, 60, 28), "202080");
  });

  it("draws text from a bitmap font, glyph by glyph", () => {
    // "!" is character 33: column 1, row 2 of the grid; "A" is 65. The lit pixel of each glyph is at its top left.
    const frame = render(() => new Text({ text: "AA", font: "font.png", size: 8, color: "#ff8000" }));
    // The glyph's lit pixel is green and the text is orange: the tint multiplies, leaving half the green channel.
    assert.equal(pixel(frame, 0, 0), "008000");
    assert.equal(pixel(frame, 5, 0), "008000", "the second A, one cell (5 pixels at this size) along");
    assert.equal(pixel(frame, 2, 3), "000000", "and nothing between");
  });
});
