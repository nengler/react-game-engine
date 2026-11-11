import type { Battle, Command } from "./battle.ts";
import type { PadSpot } from "./path.ts";
import type { TowerKind } from "./towers.ts";

/** What the player can do in one step: the keys and buttons, as actions (see `controls.ts`). Mouse clicks are not here: they call the game's actions. */
export interface Intent {
  /** A cursor move: -1, 0 or 1 on each axis. */
  readonly dx: number;
  readonly dy: number;
  readonly confirm: boolean;
  readonly back: boolean;
  readonly buy: TowerKind | null;
  readonly upgrade: boolean;
  readonly sell: boolean;
  readonly wave: boolean;
  readonly fast: boolean;
  readonly pause: boolean;
}

export const NO_INTENT: Intent = { dx: 0, dy: 0, confirm: false, back: false, buy: null, upgrade: false, sell: false, wave: false, fast: false, pause: false };

/** What the side panel and the cursor hold between steps. */
export interface Ui {
  /** The pad the cursor is on (and the mouse last clicked). */
  readonly cursor: number;
  /** The panel shows that pad's build menu or upgrade panel. */
  readonly open: boolean;
  readonly speed: 1 | 2;
  readonly paused: boolean;
}

export const START_UI: Ui = { cursor: 0, open: false, speed: 1, paused: false };

/** The nearest pad from `from` in a direction (the pad must lie in that half-plane; the sideways distance counts double). Null when none. */
export function padInDirection(pads: readonly PadSpot[], from: number, dx: number, dy: number): number | null {
  const here = pads[from];
  if (here === undefined) return null;
  let best: number | null = null;
  let bestScore = Infinity;
  for (const p of pads) {
    if (p.id === from) continue;
    const along = (p.x - here.x) * dx + (p.y - here.y) * dy;
    if (along <= 0) continue;
    const across = Math.abs((p.x - here.x) * dy) + Math.abs((p.y - here.y) * dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

export interface Applied {
  readonly ui: Ui;
  readonly commands: readonly Command[];
}

/**
 * What one step of intent does: moves the cursor, opens and closes the panel, buys, upgrades, sells, starts a wave, changes the
 * speed. Pausing is the caller's (it also stops the battle).
 */
export function applyIntent(ui: Ui, intent: Intent, battle: Battle): Applied {
  let { cursor, open, speed } = ui;
  const commands: Command[] = [];
  if (intent.dx !== 0 || intent.dy !== 0) {
    // A move along the stick's strongest axis; a diagonal prefers horizontal.
    const next = padInDirection(battle.pads, cursor, intent.dx, intent.dx !== 0 ? 0 : intent.dy);
    if (next !== null) cursor = next;
  }
  const pad = battle.pads[cursor];
  if (intent.confirm) open = true;
  if (intent.back) open = false;
  if (pad !== undefined) {
    if (intent.buy !== null) {
      commands.push({ type: "build", pad: cursor, kind: intent.buy });
      open = true;
    }
    if (intent.upgrade) commands.push({ type: "upgrade", pad: cursor });
    if (intent.sell) commands.push({ type: "sell", pad: cursor });
  }
  if (intent.wave) commands.push({ type: "startWave" });
  if (intent.fast) speed = speed === 1 ? 2 : 1;
  return { ui: { ...ui, cursor, open, speed }, commands };
}
