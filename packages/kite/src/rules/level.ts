import type { Controls } from "./body.ts";
import type { GameEvent } from "./events.ts";
import { spawnIn, stepPlayer, type Outcome, type PlayerState } from "./player.ts";
import { ROOM_LIST, type Room } from "./rooms.ts";

/**
 * A run of the level: which room the character is in, how many times it died, whether it is dead right now, whether the
 * level is finished, and how long it took. The game state keeps this and the HUD and end screen read it; the character itself
 * (its body, its respawn timer) is the `<Player>`'s own state (`player.ts`). Each change is a plain function here, so the game
 * state's actions and the solver make the same ones.
 */
export interface Run {
  /** Index into `ROOM_LIST`. */
  room: number;
  /** Where that room's top left is in the world (what the room's own coordinates are added to). */
  originX: number;
  originY: number;
  deaths: number;
  /** The character is dead and has not come back yet: the screen dims. */
  dead: boolean;
  /** The last room's exit was reached. */
  finished: boolean;
  /** Seconds played, for the end screen: every step but the camera's slides between rooms (and freezes, when nothing runs). */
  time: number;
}

/** A run at the start of room `room` (the first, for a new game; another, for a test or the solver). */
export function newRun(room = 0): Run {
  const r = ROOM_LIST[room] as Room;
  return { room, originX: r.ox, originY: r.oy, deaths: 0, dead: false, finished: false, time: 0 };
}

/** The run after the character reports `outcome`. */
export function afterOutcome(run: Run, outcome: Outcome): Run {
  switch (outcome) {
    case "none":
      return run;
    case "died":
      return { ...run, dead: true, deaths: run.deaths + 1 };
    case "respawned":
      return { ...run, dead: false };
    case "entered": {
      const to = ROOM_LIST[run.room + 1] as Room;
      return { ...run, room: to.index, originX: to.ox, originY: to.oy };
    }
    case "finished":
      return { ...run, finished: true };
  }
}

/**
 * The whole game without the engine, for the solver and the rule-level tests: the run and the character, stepped together
 * the way `<Player>` and the game state do it in the game.
 */
export interface Sim {
  readonly run: Run;
  readonly player: PlayerState;
}

/** A run starting in room `room`, with the character at its start. */
export function newSim(room = 0): Sim {
  return { run: newRun(room), player: spawnIn(room) };
}

/** One fixed step of `dt` seconds. What happened is pushed onto `events`. */
export function stepSim(sim: Sim, c: Controls, dt: number, events: GameEvent[] = []): Sim {
  if (sim.run.finished) return sim;
  const { next, outcome, events: happened, played } = stepPlayer(sim.player, sim.run.room, c, dt);
  events.push(...happened);
  return { run: afterOutcome(played ? { ...sim.run, time: sim.run.time + dt } : sim.run, outcome), player: next };
}
