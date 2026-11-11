import { FixedDriver, RGE_KEY_DOWN, RGE_KEY_PRESSED } from "@rge/player";
import type { Controls } from "./body.ts";
import type { GameEvent } from "./events.ts";
import { freezeFor } from "./freeze.ts";
import { stepSim, type Sim } from "./level.ts";

/** The game's steps per second (`fixedStep` in `Main.tsx`). */
const STEP_HZ = 60;

/** The two presses a freeze must not lose, as the keys the driver keeps edges for. */
const JUMP = 0;
const DASH = 1;
const PRESSES = 2;

/**
 * What the engine does around the rules, for a driver that has no engine: the player's own fixed-step driver (`FixedDriver`)
 * decides when a step runs and which presses it sees, and the world freezes for a few steps when a dash starts or the character
 * dies (`freeze()` in `effects.ts`). A press that lands during the freeze is kept for the first step after it. The solver and the
 * rule-level replay test play frames through this, so they see what the game sees, by the same code and not a copy of it.
 */
export interface Playback extends Sim {
  /** Fixed steps still to be skipped. */
  readonly frozen: number;
  /** The driver's timing and kept edges. Never changed: a frame plays on a copy, so a state can be played from again. */
  readonly driver: FixedDriver;
}

export function startPlayback(sim: Sim): Playback {
  return { ...sim, frozen: 0, driver: new FixedDriver(STEP_HZ, PRESSES) };
}

/** One frame of input, which is one fixed step: skipped while frozen (its presses are kept), played otherwise. */
export function playFrame(p: Playback, c: Controls, dt: number): Playback {
  const driver = p.driver.clone();
  const raw = new Uint8Array(PRESSES);
  if (c.jumpPressed) raw[JUMP] = RGE_KEY_DOWN | RGE_KEY_PRESSED;
  if (c.dashPressed) raw[DASH] = RGE_KEY_DOWN | RGE_KEY_PRESSED;
  let sim: Sim = p;
  let frozen = p.frozen;
  driver.advance(dt, raw, (_input, update, stepDt) => {
    if (frozen > 0) {
      frozen--;
      return true;
    }
    const events: GameEvent[] = [];
    sim = stepSim(sim, { ...c, jumpPressed: ((update[JUMP] as number) & RGE_KEY_PRESSED) !== 0, dashPressed: ((update[DASH] as number) & RGE_KEY_PRESSED) !== 0 }, stepDt, events);
    frozen = freezeFor(events);
    return false;
  });
  return { ...sim, frozen, driver };
}
