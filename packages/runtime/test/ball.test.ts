import assert from "node:assert/strict";
/** Balls (`useBall`): the solver alone, over a space of fixed solid boxes (DESIGN.md, "Balls: `useBall`"). */
import { describe, it } from "node:test";

import { Ball, stepBalls, type BallSpace, type SolidBox } from "../src/ball.ts";

const DT = 1 / 60;

/** A jar: a floor at y = 100 from x = 0 to 60, and walls on both sides. */
const JAR: SolidBox[] = [
  { x: -10, y: 100, width: 80, height: 10 },
  { x: -10, y: -100, width: 10, height: 210 },
  { x: 60, y: -100, width: 10, height: 210 },
];

function space(boxes: readonly SolidBox[]): BallSpace {
  return {
    solidBoxesNear: (x, y, width, height) =>
      boxes.filter((b) => x < b.x + b.width && b.x < x + width && y < b.y + b.height && b.y < y + height),
  };
}

function run(balls: Ball[], steps: number, boxes: readonly SolidBox[] = JAR): void {
  const s = space(boxes);
  for (let i = 0; i < steps; i++) stepBalls(balls, s, DT);
}

function worstOverlap(balls: readonly Ball[]): number {
  let worst = 0;
  for (let i = 0; i < balls.length; i++)
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i]!;
      const b = balls[j]!;
      worst = Math.max(worst, a.radius + b.radius - Math.hypot(a.x - b.x, a.y - b.y));
    }
  return worst;
}

describe("balls", () => {
  it("fall under gravity and come to rest on a solid floor", () => {
    const ball = new Ball({ x: 30, y: 0, radius: 5, gravity: 600 });
    run([ball], 120);
    assert.ok(Math.abs(ball.y - 95) < 0.05, `rests on the floor (y = ${ball.y})`);
    assert.ok(ball.speed() < 1, "at rest");
  });

  it("without gravity, stay where they are", () => {
    const ball = new Ball({ x: 30, y: 20, radius: 5 });
    run([ball], 30);
    assert.deepEqual([ball.x, ball.y], [30, 20]);
  });

  it("pile up inside the walls without sinking into each other", () => {
    const balls = Array.from({ length: 24 }, (_, i) => new Ball({ x: 6 + ((i * 7) % 48), y: -i * 9, radius: 3 + (i % 4), gravity: 600 }));
    run(balls, 300);
    for (const b of balls) {
      assert.ok(b.x - b.radius >= -0.5 && b.x + b.radius <= 60.5, `inside the walls (x = ${b.x})`);
      assert.ok(b.y + b.radius <= 100.5, `above the floor (y = ${b.y})`);
      assert.ok(b.speed() < 15, `settled (${b.speed()} px/s)`);
    }
    assert.ok(worstOverlap(balls) < 0.75, `overlap ${worstOverlap(balls)}`);
  });

  it("are solved in an order that depends on where they are, not on the order they are listed in", () => {
    const make = () =>
      Array.from({ length: 12 }, (_, i) => new Ball({ x: 8 + ((i * 11) % 44), y: -i * 10, radius: 4 + (i % 3), gravity: 600 }));
    const forward = make();
    const backward = make();
    run(forward, 90);
    run([...backward].reverse(), 90);
    assert.deepEqual(
      forward.map((b) => [b.x, b.y, b.px, b.py]),
      backward.map((b) => [b.x, b.y, b.px, b.py])
    );
  });

  it("push the lighter ball further: a heavy ball barely moves", () => {
    const heavy = new Ball({ x: 30, y: 50, radius: 5, mass: 1000 });
    const light = new Ball({ x: 36, y: 50, radius: 5, mass: 1 });
    run([heavy, light], 1, []);
    assert.ok(Math.abs(heavy.x - 30) < 0.02, `heavy moved ${heavy.x - 30}`);
    assert.ok(light.x >= 39.9, `light pushed to ${light.x}`);
  });

  it("push adds velocity in pixels per second, and place puts it at rest", () => {
    const ball = new Ball({ x: 30, y: 50, radius: 5, drag: 0 });
    run([ball], 1, []);
    ball.push(120, 0);
    run([ball], 30, []);
    assert.ok(Math.abs(ball.x - 90) < 1e-6, `moved 60 px in half a second (${ball.x - 30})`);
    assert.ok(Math.abs(ball.speed() - 120) < 1e-6);
    ball.place(10, 10);
    run([ball], 10, []);
    assert.deepEqual([ball.x, ball.y], [10, 10]);
  });

  it("a ball whose centre is inside a solid is pushed out of the nearest side", () => {
    const ball = new Ball({ x: 30, y: 102, radius: 4 });
    run([ball], 1);
    assert.ok(Math.abs(ball.y - 96) < 0.01, `out of the top (y = ${ball.y})`);
  });

  it("friction slows a ball sliding on the floor; without it, it keeps sliding", () => {
    const rough = new Ball({ x: 10, y: 95, radius: 5, gravity: 600, friction: 0.3 });
    const smooth = new Ball({ x: 10, y: 95, radius: 5, gravity: 600, friction: 0 });
    run([rough], 1);
    run([smooth], 1);
    rough.push(60, 0);
    smooth.push(60, 0);
    run([rough], 20);
    run([smooth], 20);
    assert.ok(rough.x < smooth.x - 5, `rough ${rough.x}, smooth ${smooth.x}`);
  });

  it("a pinned ball stays where it is, holds what lands on it, takes no push, and falls from rest when let go", () => {
    const peg = new Ball({ x: 30, y: 50, radius: 8, gravity: 600, pinned: true });
    const fruit = new Ball({ x: 30, y: 20, radius: 5, gravity: 600 });
    run([peg, fruit], 120);
    assert.deepEqual([peg.x, peg.y], [30, 50], "not moved by gravity or by what fell on it");
    assert.ok(fruit.y < 50 && worstOverlap([peg, fruit]) < 0.01, `the fruit rests on it or has rolled off, not through (y = ${fruit.y})`);
    peg.push(500, 0);
    run([peg], 10);
    assert.deepEqual([peg.x, peg.y], [30, 50], "a push does nothing to it");

    peg.pinned = false;
    run([peg], 1);
    assert.ok(peg.y > 50 && peg.y < 50.5, `let go, it starts from rest (y = ${peg.y})`);
    run([peg], 120);
    assert.ok(Math.abs(peg.y - 92) < 0.01, `and falls to the floor (y = ${peg.y})`);
  });

  it("a ball's gravity can change: none hangs it where it is, a negative one floats it up", () => {
    const ball = new Ball({ x: 30, y: 50, radius: 5, gravity: 600, drag: 1 });
    run([ball], 10);
    assert.ok(ball.y > 50, "falling");
    ball.gravity = 0;
    ball.place(30, 60);
    run([ball], 30);
    assert.deepEqual([ball.x, ball.y], [30, 60], "hangs");
    ball.gravity = -600;
    run([ball], 10);
    assert.ok(ball.y < 60, `floats up (y = ${ball.y})`);
  });
});
