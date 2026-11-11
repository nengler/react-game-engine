import { heightOf, newBody, stepBody, type Body, type Controls } from "./body.ts";
import { BODY_H, BODY_W, ENTRY_LIFT, RESPAWN_DELAY, ROOM_H, ROOM_W, TILE, TRANSITION_TIME, VOID_MARGIN } from "./constants.ts";
import type { GameEvent } from "./events.ts";
import { gridOf, hazardRect, overlapsRect, ROOM_LIST, type Room, type RoomGrid } from "./rooms.ts";

/**
 * The state of a run of the level, and one fixed step of it: the character's body in the current room, dying and
 * coming back, and moving on to the next room. A plain function of that state and the buttons, so the game state holds it
 * as leaves, tests step it directly, and the solver that finds each room's replay searches over it.
 */
export interface Run {
  /** Index into `ROOM_LIST`. */
  room: number;
  /** Where that room's top left is in the world (what the room's own coordinates are added to). */
  originX: number;
  originY: number;
  player: Body;
  dead: boolean;
  /** Seconds until the character is back at the room's start, while dead. */
  deathTimer: number;
  deaths: number;
  /** Seconds of room change left: the world waits while the camera slides. */
  transition: number;
  /** The last room's exit was reached. */
  finished: boolean;
  /** Fixed steps played while the world was running: the clock the end screen shows. */
  steps: number;
}

const grids = new Map<number, RoomGrid>();
function gridFor(room: Room): RoomGrid {
  let grid = grids.get(room.index);
  if (grid === undefined) grids.set(room.index, (grid = gridOf(room)));
  return grid;
}

/** A run at the start of the first room. */
export function newRun(): Run {
  const room = ROOM_LIST[0] as Room;
  return { room: 0, originX: room.ox, originY: room.oy, player: newBody(room.spawnX, room.spawnY), dead: false, deathTimer: 0, deaths: 0, transition: 0, finished: false, steps: 0 };
}

/** Which of a room's tiles the hitbox at (x, y) touches, as the characters found. */
function touching(room: Room, x: number, y: number, h: number, want: (ch: string, col: number, row: number) => boolean): boolean {
  const grid = gridFor(room);
  const c0 = Math.floor(x / TILE);
  const c1 = Math.floor((x + BODY_W - 1) / TILE);
  const r0 = Math.floor(y / TILE);
  const r1 = Math.floor((y + h - 1) / TILE);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (want(grid.tile(c, r), c, r)) return true;
  return false;
}

/** Is the body on spikes? */
export function onSpikes(room: Room, b: Body): boolean {
  return touching(room, b.x, b.y, heightOf(b), (ch, c, r) => {
    const rect = hazardRect(ch, c, r);
    return rect !== null && overlapsRect(b.x, b.y, rect, heightOf(b));
  });
}

/** Is the body in the room's exit? */
export function inExit(room: Room, b: Body): boolean {
  return touching(room, b.x, b.y, heightOf(b), (ch) => ch === "E");
}

/** Out of the room by more than the margin, below it or past its sides (above it is fine: that is how a room is left). */
export function outOfBounds(b: Body): boolean {
  return b.y > ROOM_H + VOID_MARGIN || b.x < -VOID_MARGIN || b.x > ROOM_W + VOID_MARGIN;
}

/** One fixed step of `dt` seconds. Returns the next state; `run` is not changed. What happened is pushed onto `events`. */
export function stepRun(run: Run, c: Controls, dt: number, events: GameEvent[] = []): Run {
  if (run.finished) return run;
  const room = ROOM_LIST[run.room] as Room;
  const next: Run = { ...run };
  if (run.transition > 0) {
    next.transition = Math.max(0, run.transition - dt);
    return next;
  }
  next.steps++;
  if (run.dead) {
    next.deathTimer = run.deathTimer - dt;
    if (next.deathTimer <= 0) {
      next.dead = false;
      next.deathTimer = 0;
      next.player = newBody(room.spawnX, room.spawnY);
    }
    return next;
  }
  const body = stepBody(run.player, c, gridFor(room).solidAt, dt, events);
  next.player = body;
  if (onSpikes(room, body) || outOfBounds(body)) {
    next.dead = true;
    next.deathTimer = RESPAWN_DELAY;
    next.deaths++;
    events.push({ type: "death", x: body.x + BODY_W / 2, y: body.y + BODY_H / 2 });
    next.player = { ...body, vx: 0, vy: 0, state: "normal", dashTime: 0 };
    return next;
  }
  if (inExit(room, body)) {
    if (room.exit === "end" || run.room + 1 >= ROOM_LIST.length) {
      next.finished = true;
      return next;
    }
    const to = ROOM_LIST[run.room + 1] as Room;
    next.room = to.index;
    next.originX = to.ox;
    next.originY = to.oy;
    events.push({ type: "room", x: body.x + BODY_W / 2, y: body.y + BODY_H, room: to.index });
    next.transition = TRANSITION_TIME;
    // The body stays where it is in the world: the next room is laid out so its opening is right there.
    // Coming up out of the room below, the body arrives a little above the new room's floor (the slide hides the jump); an exit to the side keeps its height.
    next.player = { ...body, x: Math.max(0, body.x - (to.ox - room.ox)), y: Math.min(ROOM_H - BODY_H - ENTRY_LIFT, body.y - (to.oy - room.oy)) };
  }
  return next;
}
