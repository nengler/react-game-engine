import type { Controls } from "./body.ts";
import { DASH_FREEZE_STEPS, DEATH_FREEZE_STEPS } from "./constants.ts";
import type { GameEvent } from "./events.ts";
import { stepSim, type Sim } from "./level.ts";

/**
 * What the engine does around the rules, for a driver that has no engine: the world freezes for a few steps when a dash
 * starts or the character dies (`freeze()` in `effects.ts`), and a press that lands during the freeze is kept for the first
 * step after it. The solver and the rule-level replay test play frames through this, so they see what the game sees.
 */
export interface Playback extends Sim {
  /** Fixed steps still to be skipped. */
  readonly frozen: number;
  readonly edgeJump: boolean;
  readonly edgeDash: boolean;
}

export function startPlayback(sim: Sim): Playback {
  return { ...sim, frozen: 0, edgeJump: false, edgeDash: false };
}

/** One frame of input, which is one fixed step: skipped while frozen (its presses are kept), played otherwise. */
export function playFrame(p: Playback, c: Controls, dt: number): Playback {
  if (p.frozen > 0) return { ...p, frozen: p.frozen - 1, edgeJump: p.edgeJump || c.jumpPressed, edgeDash: p.edgeDash || c.dashPressed };
  const events: GameEvent[] = [];
  const next = stepSim(p, { ...c, jumpPressed: c.jumpPressed || p.edgeJump, dashPressed: c.dashPressed || p.edgeDash }, dt, events);
  return { ...next, frozen: freezeFor(events), edgeJump: false, edgeDash: false };
}

/** Steps the world stays frozen after these events: a dash and a death each hold it a moment, so a hit reads. */
export function freezeFor(events: readonly GameEvent[]): number {
  let frozen = 0;
  for (const e of events) {
    if (e.type === "dash") frozen = Math.max(frozen, DASH_FREEZE_STEPS);
    if (e.type === "death") frozen = Math.max(frozen, DEATH_FREEZE_STEPS);
  }
  return frozen;
}
