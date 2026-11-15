import { Entity, Shape, Tilemap, useBody, useMutable, useUpdate } from "@rge/runtime/jsx";

import * as K from "./rules/constants.ts";
import { readControls } from "./rules/controls.ts";
import { ROOM_LIST } from "./rules/rooms.ts";

interface RunnerProps {
  /** The room it runs in, by index: its Tiled map, drawn solid, and where it starts. */
  room: number;
}

const approach = (value: number, target: number, amount: number): number =>
  value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Kite's running, falling and jumping written as a component with `useBody` and `useMutable` (REACT_FEEL_PLAN.md, A2), beside the rules the game
 * plays (`rules/body.ts`), to compare the two: the same numbers and the same order each step, with the room's solid tiles found by
 * the body instead of by `solidAt`. Not in the game: `test/runner.test.ts` plays both on the same input. Only the normal state's
 * ground moves are here (run, fall, a held jump with its grace and buffer, speed kept into a wall, a jump sliding past a ceiling's
 * corner); the dash, climbing, wall jumps, wall slides and ducking are the rules' alone.
 */
export function Runner({ room }: RunnerProps) {
  const start = ROOM_LIST[room]!;
  const { x, y, move, blocked } = useBody({ x: start.spawnX, y: start.spawnY, width: K.BODY_W, height: K.BODY_H });
  const s = useMutable({
    vx: 0,
    vy: 0,
    /** Seconds left of the jump's grace after leaving the ground, of a jump pressed early, and of a held jump keeping its speed. */
    coyote: 0,
    buffer: 0,
    varJump: 0,
    varJumpSpeed: 0,
    /** Speed into a wall kept a moment, taken back up if the way clears. */
    wallSpeed: 0,
    wallSpeedTime: 0,
  });

  useUpdate((dt, input) => {
    const c = readControls(input);
    const moveX = (c.right ? 1 : 0) - (c.left ? 1 : 0);
    s.buffer = c.jumpPressed ? K.JUMP_BUFFER : s.buffer - dt;
    if (s.varJump > 0) s.varJump -= dt;

    // The ground: asked of the body, now.
    const onGround = s.vy >= 0 && blocked(0, 1);
    s.coyote = onGround ? K.COYOTE : s.coyote - dt;

    // Speed kept into a wall: taken back up once the way is clear.
    if (s.wallSpeedTime > 0) {
      if (sign(s.vx) === -sign(s.wallSpeed)) s.wallSpeedTime = 0;
      else if (!blocked(sign(s.wallSpeed), 0)) {
        s.vx = s.wallSpeed;
        s.wallSpeedTime = 0;
      } else s.wallSpeedTime -= dt;
    }

    // Running, slowing toward the run speed when faster.
    const mult = onGround ? 1 : K.AIR_MULT;
    if (Math.abs(s.vx) > K.RUN_SPEED && sign(s.vx) === moveX) s.vx = approach(s.vx, K.RUN_SPEED * moveX, K.RUN_REDUCE * mult * dt);
    else s.vx = approach(s.vx, K.RUN_SPEED * moveX, K.RUN_ACCEL * mult * dt);

    // Gravity, halved near the top of a held jump.
    if (!onGround) s.vy = approach(s.vy, K.MAX_FALL, K.GRAVITY * (Math.abs(s.vy) < K.HALF_GRAV_THRESHOLD && c.jumpHeld ? 0.5 : 1) * dt);

    // A held jump keeps its speed for a while; letting go ends that.
    if (s.varJump > 0) {
      if (c.jumpHeld) s.vy = Math.min(s.vy, s.varJumpSpeed);
      else s.varJump = 0;
    }

    // A jump, from the ground or just after leaving it, pressed now or a moment ago.
    if (s.buffer > 0 && s.coyote > 0) {
      s.buffer = 0;
      s.coyote = 0;
      s.varJump = K.VAR_JUMP_TIME;
      s.vx += K.JUMP_H_BOOST * moveX;
      s.vy = -K.JUMP_SPEED;
      s.varJumpSpeed = s.vy;
    }

    // Move. Stopped sideways, the speed is kept a moment in case the way clears.
    const hit = move(s.vx * dt, s.vy * dt);
    if (hit.left || hit.right) {
      if (s.wallSpeedTime <= 0) {
        s.wallSpeed = s.vx;
        s.wallSpeedTime = K.WALL_SPEED_RETENTION_TIME;
      }
      s.vx = 0;
    }
    if (hit.up) {
      // Into a ceiling's corner: slide past it, the way the body is moving, and keep rising.
      let slid = false;
      for (const side of s.vx < 0 ? [-1] : s.vx > 0 ? [1] : [-1, 1]) {
        for (let i = 1; i <= K.UPWARD_CORNER_CORRECTION && !slid; i++) {
          if (!blocked(side * i, -1)) {
            move(side * i, -1);
            slid = true;
          }
        }
      }
      if (!slid) {
        if (s.varJump < K.VAR_JUMP_TIME - K.CEILING_VAR_JUMP_GRACE) s.varJump = 0;
        s.vy = 0;
      }
    }
    if (hit.down) s.vy = 0;
  });

  return (
    <Entity>
      <Tilemap map={start.map} image="tiles.png" layer="Tiles" solid />
      <Shape kind="rect" width={K.BODY_W} height={K.BODY_H} color="#f6c177" x={x} y={y} />
    </Entity>
  );
}
