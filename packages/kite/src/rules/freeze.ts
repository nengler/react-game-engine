import { DASH_FREEZE_STEPS, DEATH_FREEZE_STEPS } from "./constants.ts";
import type { GameEvent } from "./events.ts";

/** Steps the world stays frozen after these events: a dash and a death each hold it a moment, so a hit reads. */
export function freezeFor(events: readonly GameEvent[]): number {
  let frozen = 0;
  for (const e of events) {
    if (e.type === "dash") frozen = Math.max(frozen, DASH_FREEZE_STEPS);
    if (e.type === "death") frozen = Math.max(frozen, DEATH_FREEZE_STEPS);
  }
  return frozen;
}
