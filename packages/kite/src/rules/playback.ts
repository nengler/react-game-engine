import type { Controls } from "./body.ts";
import { DASH_FREEZE_STEPS, DEATH_FREEZE_STEPS } from "./constants.ts";
import { stepRun, type Run } from "./level.ts";

/**
 * What the engine does around the rules, for a driver that has no engine: the world freezes for a few steps when a dash
 * starts or the character dies (`freeze()` in the game state), and a press that lands during the freeze is kept for the first
 * step after it. The solver and the rule-level replay test play frames through this, so they see what the game sees.
 */
export interface Playback {
  readonly run: Run;
  /** Fixed steps still to be skipped. */
  readonly frozen: number;
  readonly edgeJump: boolean;
  readonly edgeDash: boolean;
}

export function startPlayback(run: Run): Playback {
  return { run, frozen: 0, edgeJump: false, edgeDash: false };
}

/** One frame of input, which is one fixed step: skipped while frozen (its presses are kept), played otherwise. */
export function playFrame(p: Playback, c: Controls, dt: number): Playback {
  if (p.frozen > 0) return { run: p.run, frozen: p.frozen - 1, edgeJump: p.edgeJump || c.jumpPressed, edgeDash: p.edgeDash || c.dashPressed };
  const next = stepRun(p.run, { ...c, jumpPressed: c.jumpPressed || p.edgeJump, dashPressed: c.dashPressed || p.edgeDash }, dt);
  let frozen = 0;
  if (next.player.dashCount !== p.run.player.dashCount) frozen = DASH_FREEZE_STEPS;
  if (next.deathCount !== p.run.deathCount) frozen = Math.max(frozen, DEATH_FREEZE_STEPS);
  return { run: next, frozen, edgeJump: false, edgeDash: false };
}
