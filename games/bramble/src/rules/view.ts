/**
 * What the screen shows of a map, as plain lists: the compiler's lists come from state or props, not from a computation in a
 * component, so the rules make them and the game state holds them (`view`), updated when the run changes.
 */
import { BODY, REACH, SWING_SIZE, TILE } from "./constants.ts";
import { DIALOGUE } from "./dialogue.ts";
import { MAPS } from "./maps.ts";
import { bushKey, pagesOf, slotsOf, type Run, type Slot } from "./run.ts";

export interface Spot {
  readonly id: string;
  /** Top left of the thing's sprite, in map pixels. */
  readonly x: number;
  readonly y: number;
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

export function viewOf(run: Run): View {
  const def = MAPS[run.map];
  const bushes: Spot[] = [];
  def.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "b" && !run.cut.includes(bushKey(run.map, c, r))) bushes.push({ id: `${c},${r}`, x: c * TILE, y: r * TILE });
    }
  });
  const at = (id: string, col: number, row: number, dx = 0, dy = 0): Spot => ({ id, x: col * TILE + dx, y: row * TILE + dy });
  return {
    bushes,
    doors: def.doors.map((d) => at(d.id, d.col, d.row)),
    gates: def.gate === undefined ? [] : [at("gate", def.gate.col, def.gate.row)],
    shrines: def.shrines.map((s) => at(s.id, s.col, s.row, 2, 2)),
    pickups: def.pickups.filter((p) => !run.taken.includes(p.id)).map((p) => at(p.id, p.col, p.row, 4, 4)),
    npcs: def.npcs.map((n) => at(n.id, n.col, n.row, 2, 1)),
    slots: slotsOf(run),
    beetles: run.enemies.filter((e) => e.map === run.map && e.kind === "beetle").map((e) => ({ id: e.id, x: e.x - 1, y: e.y - 1 })),
    wisps: run.enemies.filter((e) => e.map === run.map && e.kind === "wisp").map((e) => ({ id: e.id, x: e.x - 1, y: e.y - 1 })),
    swings: run.swing > 0 ? [{ id: "swing", x: run.x + BODY / 2 + (run.fx / (Math.hypot(run.fx, run.fy) || 1)) * REACH - SWING_SIZE / 2, y: run.y + BODY / 2 + (run.fy / (Math.hypot(run.fx, run.fy) || 1)) * REACH - SWING_SIZE / 2 }] : [],
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
