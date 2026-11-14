import { Entity, Shape, Tilemap, useBody, useState, useUpdate } from "@rge/runtime/jsx";
import * as K from "./rules/constants.ts";
import { readControls } from "./rules/controls.ts";
import { ROOM_LIST } from "./rules/rooms.ts";

interface RunnerProps {
  /** The room it runs in, by index: its Tiled map, drawn solid, and where it starts. */
  room: number;
}

const approach = (value: number, target: number, amount: number): number => (value < target ? Math.min(value + amount, target) : Math.max(value - amount, target));
const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Kite's running, falling and jumping written as a component with `useBody` (REACT_FEEL_PLAN.md, A2), beside the rules the game
 * plays (`rules/body.ts`), to compare the two: the same numbers and the same order each step, with the room's solid tiles found by
 * the body instead of by `solidAt`. Not in the game: `test/runner.test.ts` plays both on the same input. Only the normal state's
 * ground moves are here (run, fall, a held jump with its grace and buffer, speed kept into a wall, a jump sliding past a ceiling's
 * corner); the dash, climbing, wall jumps, wall slides and ducking are the rules' alone.
 */
export function Runner({ room }: RunnerProps) {
  const start = ROOM_LIST[room]!;
  const { x, y, move, blocked } = useBody({ x: start.spawnX, y: start.spawnY, width: K.BODY_W, height: K.BODY_H });
  const [vx, setVx] = useState(0);
  const [vy, setVy] = useState(0);
  /** Seconds left of the jump's grace after leaving the ground, of a jump pressed early, and of a held jump keeping its speed. */
  const [coyote, setCoyote] = useState(0);
  const [buffer, setBuffer] = useState(0);
  const [varJump, setVarJump] = useState(0);
  const [varJumpSpeed, setVarJumpSpeed] = useState(0);
  /** Speed into a wall kept a moment, taken back up if the way clears. */
  const [wallSpeed, setWallSpeed] = useState(0);
  const [wallSpeedTime, setWallSpeedTime] = useState(0);

  useUpdate((dt, input) => {
    const c = readControls(input);
    const moveX = (c.right ? 1 : 0) - (c.left ? 1 : 0);
    let nvx = vx;
    let nvy = vy;
    let nBuffer = c.jumpPressed ? K.JUMP_BUFFER : buffer - dt;
    let nVarJump = varJump > 0 ? varJump - dt : varJump;
    let nVarJumpSpeed = varJumpSpeed;
    let nWallSpeed = wallSpeed;
    let nWallSpeedTime = wallSpeedTime;

    // The ground: asked of the body, now.
    const onGround = nvy >= 0 && blocked(0, 1);
    let nCoyote = onGround ? K.COYOTE : coyote - dt;

    // Speed kept into a wall: taken back up once the way is clear.
    if (nWallSpeedTime > 0) {
      if (sign(nvx) === -sign(nWallSpeed)) nWallSpeedTime = 0;
      else if (!blocked(sign(nWallSpeed), 0)) {
        nvx = nWallSpeed;
        nWallSpeedTime = 0;
      } else nWallSpeedTime -= dt;
    }

    // Running, slowing toward the run speed when faster.
    const mult = onGround ? 1 : K.AIR_MULT;
    if (Math.abs(nvx) > K.RUN_SPEED && sign(nvx) === moveX) nvx = approach(nvx, K.RUN_SPEED * moveX, K.RUN_REDUCE * mult * dt);
    else nvx = approach(nvx, K.RUN_SPEED * moveX, K.RUN_ACCEL * mult * dt);

    // Gravity, halved near the top of a held jump.
    if (!onGround) nvy = approach(nvy, K.MAX_FALL, K.GRAVITY * (Math.abs(nvy) < K.HALF_GRAV_THRESHOLD && c.jumpHeld ? 0.5 : 1) * dt);

    // A held jump keeps its speed for a while; letting go ends that.
    if (nVarJump > 0) {
      if (c.jumpHeld) nvy = Math.min(nvy, nVarJumpSpeed);
      else nVarJump = 0;
    }

    // A jump, from the ground or just after leaving it, pressed now or a moment ago.
    if (nBuffer > 0 && nCoyote > 0) {
      nBuffer = 0;
      nCoyote = 0;
      nVarJump = K.VAR_JUMP_TIME;
      nvx += K.JUMP_H_BOOST * moveX;
      nvy = -K.JUMP_SPEED;
      nVarJumpSpeed = nvy;
    }

    // Move. Stopped sideways, the speed is kept a moment in case the way clears.
    const hit = move(nvx * dt, nvy * dt);
    if (hit.left || hit.right) {
      if (nWallSpeedTime <= 0) {
        nWallSpeed = nvx;
        nWallSpeedTime = K.WALL_SPEED_RETENTION_TIME;
      }
      nvx = 0;
    }
    if (hit.up) {
      // Into a ceiling's corner: slide past it, the way the body is moving, and keep rising.
      let slid = false;
      for (const side of nvx < 0 ? [-1] : nvx > 0 ? [1] : [-1, 1]) {
        for (let i = 1; i <= K.UPWARD_CORNER_CORRECTION && !slid; i++) {
          if (!blocked(side * i, -1)) {
            // `x` and `y` are this step's snapshot, from before the move: the body is moved from where it is now.
            move(side * i, -1);
            slid = true;
          }
        }
      }
      if (!slid) {
        if (nVarJump < K.VAR_JUMP_TIME - K.CEILING_VAR_JUMP_GRACE) nVarJump = 0;
        nvy = 0;
      }
    }
    if (hit.down) nvy = 0;

    setVx(nvx);
    setVy(nvy);
    setCoyote(nCoyote);
    setBuffer(nBuffer);
    setVarJump(nVarJump);
    setVarJumpSpeed(nVarJumpSpeed);
    setWallSpeed(nWallSpeed);
    setWallSpeedTime(nWallSpeedTime);
  });

  return (
    <Entity>
      <Tilemap map={start.map} image="tiles.png" layer="Tiles" solid />
      <Shape kind="rect" width={K.BODY_W} height={K.BODY_H} color="#f6c177" x={x} y={y} />
    </Entity>
  );
}
