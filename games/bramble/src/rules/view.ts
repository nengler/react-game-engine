/**
 * What the screen shows of a run, worked out from it: the components call these while they render (`spotsOf(run).map(…)`), as a
 * React component computes what it draws from its state. Nothing here is kept in the game state.
 */
import { BODY, REACH, TILE } from "./constants.ts";
import { DIALOGUE } from "./dialogue.ts";
import { MAPS } from "./maps.ts";
import { bushKey, pagesOf, type Run } from "./run.ts";

export interface Spot {
  /** Unique among everything on the map: the kind, then the thing's own id (`door:cave`, `bush:4,7`). */
  readonly id: string;
  /** Top left of the thing's sprite, in map pixels. */
  readonly x: number;
  readonly y: number;
  /** Which 16 x 16 frame of `things.png` draws it. */
  readonly frame: number;
}

/** What the dialogue box shows: the speaker, the page, how many of its characters have typed out, and a mark when there is more. */
export interface DialogueView {
  readonly name: string;
  readonly page: string;
  readonly shown: number;
  /** ">" when the page is all showing and another follows, "." when it is the last, "" while typing. */
  readonly more: string;
}

/** Frames of `things.png` (see tools/make-assets.ts). */
const FRAME = {
  heroDown: 0,
  heroUp: 1,
  heroLeft: 2,
  heroRight: 3,
  beetle: 4,
  wisp: 5,
  npc: 6,
  lantern: 7,
  key: 8,
  shears: 9,
  bell: 10,
  shrine: 11,
  door: 12,
  gate: 13,
  bush: 14,
  swing: 15,
} as const;
const ITEM_FRAME = { lantern: FRAME.lantern, key: FRAME.key, shears: FRAME.shears, bell: FRAME.bell } as const;

/** Which way the character faces, as a frame: the larger of the two axes decides. */
function heroFrame(run: Run): number {
  if (Math.abs(run.fx) > Math.abs(run.fy) || (Math.abs(run.fx) === Math.abs(run.fy) && run.fx !== 0 && run.fy === 0))
    return run.fx < 0 ? FRAME.heroLeft : FRAME.heroRight;
  return run.fy < 0 ? FRAME.heroUp : FRAME.heroDown;
}

const at = (id: string, col: number, row: number, frame: number): Spot => ({ id, x: col * TILE, y: row * TILE, frame });
// The sprites are 16 x 16 and the hitboxes 10 x 10, so a sprite sits 3 pixels up and left of its box.
const onBox = (id: string, x: number, y: number, frame: number): Spot => ({
  id,
  x: x - (TILE - BODY) / 2,
  y: y - (TILE - BODY) / 2,
  frame,
});

/** The character's sprite. */
export function heroOf(run: Run): Spot {
  return onBox("hero", run.x, run.y, heroFrame(run));
}

/**
 * Everything on the run's map but the character, in drawing order: doors, the gate, shrines, pickups, people, enemies, uncut bushes,
 * and the swing while it lasts.
 */
export function spotsOf(run: Run): Spot[] {
  const def = MAPS[run.map];
  const bushes: Spot[] = [];
  def.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "b" && !run.cut.includes(bushKey(run.map, c, r))) bushes.push(at(`bush:${c},${r}`, c, r, FRAME.bush));
    }
  });
  const here = run.enemies.filter((e) => e.map === run.map);
  const length = Math.hypot(run.fx, run.fy) || 1;
  const swing: Spot[] =
    run.swing > 0
      ? [
          {
            id: "swing",
            x: run.x + BODY / 2 + (run.fx / length) * REACH - TILE / 2,
            y: run.y + BODY / 2 + (run.fy / length) * REACH - TILE / 2,
            frame: FRAME.swing,
          },
        ]
      : [];
  return [
    ...def.doors.map((d) => at(`door:${d.id}`, d.col, d.row, FRAME.door)),
    ...(def.gate === undefined ? [] : [at("gate", def.gate.col, def.gate.row, FRAME.gate)]),
    ...def.shrines.map((s) => at(`shrine:${s.id}`, s.col, s.row, FRAME.shrine)),
    ...def.pickups.filter((p) => !run.taken.includes(p.id)).map((p) => at(`pickup:${p.id}`, p.col, p.row, ITEM_FRAME[p.item])),
    ...def.npcs.map((n) => at(`npc:${n.id}`, n.col, n.row, FRAME.npc)),
    ...here.filter((e) => e.kind === "beetle").map((e) => onBox(`enemy:${e.id}`, e.x, e.y, FRAME.beetle)),
    ...here.filter((e) => e.kind === "wisp").map((e) => onBox(`enemy:${e.id}`, e.x, e.y, FRAME.wisp)),
    ...bushes,
    ...swing,
  ];
}

/** A light in the dark: its middle in map pixels, how far it reaches, its colour and strength (for `<Light>`). */
export interface Glow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: string;
  readonly intensity: number;
}

/**
 * What glows on the map besides the lantern: an item still lying there (warm, faint, so a dark cave shows where to look), and each
 * wisp (cold, as it drifts). Numbers *(guess)*: not played yet.
 */
export function glowsOf(run: Run): Glow[] {
  const def = MAPS[run.map];
  const items = def.pickups
    .filter((p) => !run.taken.includes(p.id))
    .map((p) => ({
      id: `pickup:${p.id}`,
      x: p.col * TILE + TILE / 2,
      y: p.row * TILE + TILE / 2,
      radius: 20,
      color: "#ffd890",
      intensity: 0.5,
    }));
  const wisps = run.enemies
    .filter((e) => e.map === run.map && e.kind === "wisp")
    .map((e) => ({ id: `wisp:${e.id}`, x: e.x + BODY / 2, y: e.y + BODY / 2, radius: 28, color: "#8fb8ff", intensity: 0.6 }));
  return [...items, ...wisps];
}

const NO_DIALOGUE: DialogueView = { name: "", page: "", shown: 0, more: "" };

/** The conversation on screen, if any. */
export function dialogueOf(run: Run): DialogueView {
  if (run.talk === null) return NO_DIALOGUE;
  const pages = pagesOf(run, run.talk.npc);
  const page = pages[run.talk.page] ?? "";
  const length = [...page].length;
  const shown = Math.floor(run.talk.shown);
  return { name: DIALOGUE[run.talk.npc].name, page, shown, more: shown < length ? "" : run.talk.page + 1 < pages.length ? ">" : "." };
}
