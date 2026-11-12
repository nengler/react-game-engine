/**
 * What the screen shows of a map, as plain lists: the compiler's lists come from state or props, not from a computation in a
 * component, so the rules make them and the game state holds them (`view`), updated when the run changes.
 */
import { BODY, REACH, TILE } from "./constants.ts";
import { DIALOGUE } from "./dialogue.ts";
import { MAPS } from "./maps.ts";
import { bushKey, pagesOf, slotsOf, type Run, type Slot } from "./run.ts";

export interface Spot {
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

export interface View {
  readonly bushes: readonly Spot[];
  /** The character, as a one-item list (the camera follows it). */
  readonly hero: readonly Spot[];
  readonly doors: readonly Spot[];
  readonly gates: readonly Spot[];
  readonly shrines: readonly Spot[];
  readonly pickups: readonly Spot[];
  readonly npcs: readonly Spot[];
  /** The inventory's eight slots, empty ones too. */
  readonly slots: readonly Slot[];
  /** The enemies on this map, by kind, and the swing's box while it lasts (zero or one). */
  readonly beetles: readonly Spot[];
  readonly wisps: readonly Spot[];
  readonly swings: readonly Spot[];
  readonly dialogue: DialogueView;
}

/** Frames of `things.png` (see tools/make-assets.ts). */
const FRAME = { heroDown: 0, heroUp: 1, heroLeft: 2, heroRight: 3, beetle: 4, wisp: 5, npc: 6, lantern: 7, key: 8, shears: 9, bell: 10, shrine: 11, door: 12, gate: 13, bush: 14, swing: 15 } as const;
const ITEM_FRAME = { lantern: FRAME.lantern, key: FRAME.key, shears: FRAME.shears, bell: FRAME.bell } as const;

/** Which way the character faces, as a frame: the larger of the two axes decides. */
function heroFrame(run: Run): number {
  if (Math.abs(run.fx) > Math.abs(run.fy) || (Math.abs(run.fx) === Math.abs(run.fy) && run.fx !== 0 && run.fy === 0)) return run.fx < 0 ? FRAME.heroLeft : FRAME.heroRight;
  return run.fy < 0 ? FRAME.heroUp : FRAME.heroDown;
}

export function viewOf(run: Run): View {
  const def = MAPS[run.map];
  const bushes: Spot[] = [];
  def.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "b" && !run.cut.includes(bushKey(run.map, c, r))) bushes.push({ id: `${c},${r}`, x: c * TILE, y: r * TILE, frame: FRAME.bush });
    }
  });
  const at = (id: string, col: number, row: number, frame: number): Spot => ({ id, x: col * TILE, y: row * TILE, frame });
  // The sprites are 16 x 16 and the hitboxes 10 x 10, so a sprite sits 3 pixels up and left of its box.
  const onBox = (id: string, x: number, y: number, frame: number): Spot => ({ id, x: x - (TILE - BODY) / 2, y: y - (TILE - BODY) / 2, frame });
  const ahead = (run.fx / (Math.hypot(run.fx, run.fy) || 1)) * REACH;
  const aheadY = (run.fy / (Math.hypot(run.fx, run.fy) || 1)) * REACH;
  return {
    bushes,
    hero: [onBox("hero", run.x, run.y, heroFrame(run))],
    doors: def.doors.map((d) => at(d.id, d.col, d.row, FRAME.door)),
    gates: def.gate === undefined ? [] : [at("gate", def.gate.col, def.gate.row, FRAME.gate)],
    shrines: def.shrines.map((s) => at(s.id, s.col, s.row, FRAME.shrine)),
    pickups: def.pickups.filter((p) => !run.taken.includes(p.id)).map((p) => at(p.id, p.col, p.row, ITEM_FRAME[p.item])),
    npcs: def.npcs.map((n) => at(n.id, n.col, n.row, FRAME.npc)),
    slots: slotsOf(run),
    beetles: run.enemies.filter((e) => e.map === run.map && e.kind === "beetle").map((e) => onBox(e.id, e.x, e.y, FRAME.beetle)),
    wisps: run.enemies.filter((e) => e.map === run.map && e.kind === "wisp").map((e) => onBox(e.id, e.x, e.y, FRAME.wisp)),
    swings: run.swing > 0 ? [{ id: "swing", x: run.x + BODY / 2 + ahead - TILE / 2, y: run.y + BODY / 2 + aheadY - TILE / 2, frame: FRAME.swing }] : [],
    dialogue: dialogueOf(run),
  };
}

const NO_DIALOGUE: DialogueView = { name: "", page: "", shown: 0, more: "" };

function dialogueOf(run: Run): DialogueView {
  if (run.talk === null) return NO_DIALOGUE;
  const pages = pagesOf(run, run.talk.npc);
  const page = pages[run.talk.page] ?? "";
  const length = [...page].length;
  const shown = Math.floor(run.talk.shown);
  return { name: DIALOGUE[run.talk.npc].name, page, shown, more: shown < length ? "" : run.talk.page + 1 < pages.length ? ">" : "." };
}
