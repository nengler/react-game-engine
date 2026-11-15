import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseInputScript, type PlayerConfig } from "@rge/player";
import { Entity, Shape, type InputState } from "@rge/runtime";

import { contactSheet, decodePng, encodePng, findNativeLibrary, renderRun, type Pixels } from "../src/index.ts";

const library = findNativeLibrary("headless");
const required = process.env["RGE_REQUIRE_NATIVE"] === "1";
const skip = library === null && !required ? "librge is not built (npm run native:build:headless)" : false;

const solid = (width: number, height: number, [r, g, b]: [number, number, number]): Pixels => ({
  width,
  height,
  rgba: Uint8Array.from({ length: width * height * 4 }, (_, i) => [r, g, b, 255][i % 4] as number),
});

describe("PNG encoding", () => {
  it("round-trips pixels", () => {
    const pixels: Pixels = { width: 3, height: 2, rgba: Uint8Array.from({ length: 24 }, (_, i) => (i * 11) % 256) };
    const back = decodePng(encodePng(pixels));
    assert.deepEqual([back.width, back.height], [3, 2]);
    assert.deepEqual([...back.rgba], [...pixels.rgba]);
  });

  it("lays frames out in a grid with labels and gaps", () => {
    const sheet = contactSheet([solid(8, 6, [255, 0, 0]), solid(8, 6, [0, 255, 0]), solid(8, 6, [0, 0, 255])], {
      columns: 2,
      gap: 2,
      scale: 2,
      labels: [0, 10, 20],
    });
    assert.deepEqual([sheet.width, sheet.height], [2 * 16 + 3 * 2, 2 * 12 + 3 * 2]);
    const at = (x: number, y: number): number[] => [...sheet.rgba.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 3)];
    assert.deepEqual(at(2 + 15, 2 + 11), [255, 0, 0], "the bottom right of the first frame, enlarged");
    assert.deepEqual(at(2 + 16 + 2 + 15, 2 + 11), [0, 255, 0], "the second frame, to its right");
    assert.deepEqual(at(2 + 15, 2 + 12 + 2 + 11), [0, 0, 255], "the third on the next row");
    assert.throws(() => contactSheet([solid(2, 2, [0, 0, 0]), solid(3, 2, [0, 0, 0])]), /same size/);
  });
});

/** A 4 × 4 square that moves right 2 pixels a frame while Space is held. */
class Mover extends Entity {
  override onInput(input: InputState): void {
    if (input.down("Space")) this.transform.x += 2;
  }
  override onUpdate(): void {
    this.markChanged();
  }
}

describe("renderRun", { skip }, () => {
  const config = (): PlayerConfig => ({
    width: 32,
    height: 16,
    background: "#000000",
    root: () => {
      const root = new Mover();
      root.addChild(new Shape({ kind: "rect", width: 4, height: 4, color: "#ffffff" }));
      return root;
    },
  });

  it("renders the steps asked for, the game having played its script", () => {
    const shots = renderRun(config(), parseInputScript("_, Space*4, _*2"), { at: [0, 4, 6] });
    assert.deepEqual(
      shots.map((s) => s.step),
      [0, 4, 6]
    );
    const white = (shot: Pixels): number => {
      for (let x = 0; x < shot.width; x++) if (shot.rgba[(2 * shot.width + x) * 4] === 255) return x;
      return -1;
    };
    const [first, last] = [shots[0] as { pixels: Pixels }, shots[2] as { pixels: Pixels }];
    assert.ok(white(last.pixels) > white(first.pixels), "the square moved while the key was held");
  });
});

describe("sharp upscaling, through librge", { skip }, () => {
  it("keeps the picture the right way up at a scale between whole numbers (full screen), as nearest does", async () => {
    const { Game, Screen } = await import("@rge/runtime");
    const topLeftIsRed = (upscale: "nearest" | "sharp"): [boolean, boolean] => {
      const [shot] = renderRun(
        {
          root: () => {
            // 1000 × 563 shows a 320 × 180 game at 3.125 times: the sharp path's two render textures.
            const game = new Game({ width: 1000, height: 563, upscale, background: "#000000" });
            const screen = new Screen({ width: 320, height: 180, fit: "contain" });
            screen.addChild(new Shape({ kind: "rect", width: 40, height: 20, color: "#ff0000" }));
            game.addChild(screen);
            return game;
          },
        },
        [{ dt: 1 / 60, down: [], pressed: [], released: [] }],
        { at: [0], library }
      );
      const p = shot!.pixels;
      const red = (x: number, y: number): boolean =>
        (p.rgba[(y * p.width + x) * 4] as number) > 200 && (p.rgba[(y * p.width + x) * 4 + 1] as number) < 50;
      return [red(20, 20), red(20, p.height - 20)];
    };
    assert.deepEqual(topLeftIsRed("nearest"), [true, false]);
    assert.deepEqual(topLeftIsRed("sharp"), [true, false], "not flipped by the second render texture");
  });
});
