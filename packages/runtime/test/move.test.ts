import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moveActorX, moveActorY, type PixelActor } from "../src/index.ts";

const wallAt = (wx: number) => (x: number) => x + 8 > wx;

describe("moveActorX / moveActorY", () => {
  it("move whole pixels, carry the remainder, and stop at the first blocked pixel however far the move", () => {
    const a: PixelActor = { x: 0, y: 0, rx: 0, ry: 0 };
    moveActorX(a, 0.4, wallAt(100));
    assert.deepEqual([a.x, a.rx], [0, 0.4]);
    moveActorX(a, 0.4, wallAt(100));
    assert.equal(a.x, 1, "two fifths and two fifths make a pixel");
    const hits: number[] = [];
    assert.equal(moveActorX(a, 500, wallAt(100), (d) => hits.push(d)), true);
    assert.deepEqual([a.x, a.rx, hits], [92, 0, [1]], "stopped touching the wall, remainder dropped, told the direction");
    assert.equal(moveActorX(a, -5, wallAt(100)), false);
    assert.equal(a.x, 87);
  });

  it("let the callback move the actor itself (around a corner), and stop the move there", () => {
    const ceiling = (x: number, y: number) => y < 50 && x < 24; // a ceiling over x < 24, from y 50 up
    const a: PixelActor = { x: 20, y: 60, rx: 0, ry: 0 };
    moveActorY(a, -20, ceiling, () => {
      a.x += 4; // the game's corner rule: past the ceiling's edge
    });
    assert.deepEqual([a.x, a.y], [24, 50], "stopped under the ceiling, moved past its edge by the game, and no further this move");
  });
});
