import { newBody, stepBody, type Body, type Controls } from "./body.ts";
import { BODY_H, BODY_W, ENTRY_LIFT, RESPAWN_DELAY, ROOM_H, TRANSITION_TIME } from "./constants.ts";
import type { GameEvent } from "./events.ts";
import { inExit, onSpikes, outOfBounds, ROOM_LIST, type Room } from "./rooms.ts";

/**
 * The character's own step: what `<Player>` keeps in its state and runs in its update. Its body moves (`body.ts`); spikes or
 * falling out of the room kill it, and it comes back at the room's start; an exit takes it into the next room, where it waits
 * while the camera slides. It knows nothing of deaths counted or screens shown: it says what happened to the run (`outcome`),
 * which the caller reports (`<Player>` through the game state's actions, the solver through `level.ts`), and what happened
 * to be seen and heard (`events`: a jump, a landing, a death), which `effects.ts` answers.
 */
export interface PlayerState {
  readonly body: Body;
  /** Seconds until the character is back at the room's start; 0 while alive. */
  readonly deadFor: number;
  /** Seconds of a room change left: the character waits while the camera slides. */
  readonly entering: number;
}

/** What a step did that the run cares about: nothing, a death, a respawn, the next room, or the end of the level. */
export type Outcome = "none" | "died" | "respawned" | "entered" | "finished";

/** The character standing at a room's start. */
export function spawnIn(room: number): PlayerState {
  const r = ROOM_LIST[room] as Room;
  return { body: newBody(r.spawnX, r.spawnY), deadFor: 0, entering: 0 };
}

/** What a step of the character did. */
export interface PlayerStep {
  readonly next: PlayerState;
  readonly outcome: Outcome;
  readonly events: GameEvent[];
  /** The step was played: false while the camera slides to a new room, when the character waits. What the clock counts. */
  readonly played: boolean;
}

/** One fixed step of the character in room `room`; `p` is not changed. */
export function stepPlayer(p: PlayerState, room: number, c: Controls, dt: number): PlayerStep {
  const events: GameEvent[] = [];
  if (p.entering > 0) return { next: { ...p, entering: Math.max(0, p.entering - dt) }, outcome: "none", events, played: false };
  if (p.deadFor > 0) {
    const deadFor = p.deadFor - dt;
    return deadFor > 0 ? { next: { ...p, deadFor }, outcome: "none", events, played: true } : { next: spawnIn(room), outcome: "respawned", events, played: true };
  }

  const here = ROOM_LIST[room] as Room;
  const body = stepBody(p.body, c, here.solidAt, dt, events);
  if (onSpikes(here, body) || outOfBounds(body)) {
    events.push({ type: "death", x: body.x + BODY_W / 2, y: body.y + BODY_H / 2 });
    return { next: { body: { ...body, vx: 0, vy: 0, state: "normal", dashTime: 0 }, deadFor: RESPAWN_DELAY, entering: 0 }, outcome: "died", events, played: true };
  }
  if (!inExit(here, body)) return { next: { ...p, body }, outcome: "none", events, played: true };
  if (here.exit === "end" || room + 1 >= ROOM_LIST.length) return { next: { ...p, body }, outcome: "finished", events, played: true };

  const to = ROOM_LIST[room + 1] as Room;
  events.push({ type: "room", x: body.x + BODY_W / 2, y: body.y + BODY_H, room: to.index });
  // The body stays where it is in the world: the next room is laid out so its opening is right there. Coming up out of the
  // room below, it arrives a little above the new room's floor (the slide hides the jump); an exit to the side keeps its height.
  const x = Math.max(0, body.x - (to.ox - here.ox));
  const y = Math.min(ROOM_H - BODY_H - ENTRY_LIFT, body.y - (to.oy - here.oy));
  return { next: { body: { ...body, x, y }, deadFor: 0, entering: TRANSITION_TIME }, outcome: "entered", events, played: true };
}
