/**
 * The run, and one step of it. `step(run, input, dt)` returns the next run and the events that happened, as Hearth's
 * `stepBattle` does: plain data in and out, so a test can walk the world without a window.
 *
 * What is here: eight-way movement against the map and the people (through the engine's `moveActorX`/`moveActorY`), doors,
 * talking, picking things up, cutting bushes, shrines, hearts and dying, the gate, and the save (`saveOf`, `loadRun`).
 */
import { moveActorX, moveActorY, type PixelActor } from "@rge/runtime";

import {
  BELLS_NEEDED,
  BODY,
  BODY_OFFSET,
  INVENTORY_SLOTS,
  INVULNERABLE,
  MAX_HEARTS,
  NOTICE_SECONDS,
  REACH,
  REVEAL_CPS,
  SAVE_VERSION,
  SPEED,
  SWING_SIZE,
  SWING_TIME,
  TILE,
} from "./constants.ts";
import { DIALOGUE, NEAREST_BELL, type NpcId } from "./dialogue.ts";
import { knockBack, spawnEnemy, stepEnemy, type Enemy, type EnemyWorld } from "./enemies.ts";
import { cellAt, findDoor, MAP_IDS, MAPS, mapSize, type Door, type ItemId, type MapId } from "./maps.ts";

export interface Talk {
  readonly npc: NpcId;
  readonly page: number;
  /** How many characters of the page have typed out so far (a fraction between steps); the page shows whole at its length. */
  readonly shown: number;
}

export interface Run {
  readonly map: MapId;
  /** The hitbox's top left, in pixels of the map, and what is left over below a pixel. */
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  /** Which way the character faces: each of -1, 0, 1, never both 0. */
  readonly fx: number;
  readonly fy: number;
  readonly hearts: number;
  /** How many of each item the character carries. */
  readonly items: Readonly<Partial<Record<ItemId, number>>>;
  /** Ids of pickups already picked up, and of bushes already cut (`map:col,row`). */
  readonly taken: readonly string[];
  readonly cut: readonly string[];
  /** The last shrine touched: where the character returns when the hearts run out. */
  readonly shrine: { readonly map: MapId; readonly col: number; readonly row: number };
  readonly talk: Talk | null;
  /** Every enemy still alive, on every map: only the ones on the character's map are stepped, the rest keep their place. */
  readonly enemies: readonly Enemy[];
  /** Ids of enemies defeated (kept in a save: they stay defeated). */
  readonly defeated: readonly string[];
  /** Seconds the character cannot be hurt, and seconds left of the swing. */
  readonly invuln: number;
  readonly swing: number;
  /** The state of the generator the enemies use (see `nextRandom`). */
  readonly rng: number;
  /** The shrine the character is standing on, so that stepping onto one saves once and standing there does not save every step. */
  readonly onShrine: string | null;
  /** A line shown for a moment (an item card, a locked door), and how long it has left. */
  readonly notice: string | null;
  readonly noticeLeft: number;
  /** Seconds played. */
  readonly time: number;
  /** The gate was opened: the game is over. */
  readonly done: boolean;
}

export interface Input {
  /** Direction held, each of -1, 0, 1. */
  readonly dx: number;
  readonly dy: number;
  /** The action button went down this step. */
  readonly action: boolean;
}

export type GameEvent =
  | { readonly type: "pickup"; readonly item: ItemId; readonly id: string }
  | { readonly type: "talk"; readonly npc: NpcId; readonly page: number }
  | { readonly type: "talk-end"; readonly npc: NpcId }
  | { readonly type: "door"; readonly to: MapId }
  | { readonly type: "locked"; readonly needs: ItemId }
  | { readonly type: "gate-locked"; readonly bells: number }
  | { readonly type: "cut"; readonly col: number; readonly row: number }
  | { readonly type: "swing" }
  | { readonly type: "enemy-hit"; readonly id: string }
  | { readonly type: "enemy-defeated"; readonly id: string }
  | { readonly type: "shrine"; readonly id: string }
  | { readonly type: "hurt"; readonly hearts: number }
  | { readonly type: "died" }
  | { readonly type: "win" };

export interface StepResult {
  readonly run: Run;
  readonly events: readonly GameEvent[];
}

export const NO_INPUT: Input = { dx: 0, dy: 0, action: false };

const START: Run["shrine"] = { map: "overworld", col: 6, row: 42 };

/** Where a body stands when placed on a tile. */
export const bodyAt = (col: number, row: number): { x: number; y: number } => ({
  x: col * TILE + BODY_OFFSET,
  y: row * TILE + BODY_OFFSET,
});

/** Every enemy of every map that has not been defeated, at its spawn. */
export function spawnAll(defeated: readonly string[]): Enemy[] {
  return MAP_IDS.flatMap((map) =>
    MAPS[map].enemies.filter((e) => !defeated.includes(e.id)).map((e) => spawnEnemy(e.id, e.kind, map, e.col, e.row))
  );
}

export function newRun(): Run {
  const at = bodyAt(START.col, START.row + 1);
  return {
    map: START.map,
    x: at.x,
    y: at.y,
    rx: 0,
    ry: 0,
    fx: 0,
    fy: 1,
    hearts: MAX_HEARTS,
    items: {},
    taken: [],
    cut: [],
    shrine: START,
    talk: null,
    enemies: spawnAll([]),
    defeated: [],
    invuln: 0,
    swing: 0,
    rng: 12345,
    onShrine: null,
    notice: null,
    noticeLeft: 0,
    time: 0,
    done: false,
  };
}

export const carries = (run: Run, item: ItemId): boolean => (run.items[item] ?? 0) > 0;
export const bellsFound = (run: Run): number => run.items.bell ?? 0;
export const bushKey = (map: MapId, col: number, row: number): string => `${map}:${col},${row}`;

/** Is the tile solid to the character: wall, water, or a bush that has not been cut. */
function solidTile(run: Run, col: number, row: number): boolean {
  return solidOn(run, run.map, col, row, false);
}

/** `solidTile` for any map. `doorsSolid`: doors and the gate are walls to enemies, which never go through them. */
function solidOn(run: Run, map: MapId, col: number, row: number, doorsSolid: boolean): boolean {
  const def = MAPS[map];
  // Doors and the gate are set into walls: the cell is open to step on (by the character).
  if (def.doors.some((d) => d.col === col && d.row === row) || (def.gate?.col === col && def.gate.row === row)) return doorsSolid;
  const ch = cellAt(map, col, row);
  if (ch === "#" || ch === "~") return true;
  return ch === "b" && !run.cut.includes(bushKey(map, col, row));
}

const overlaps = (ax: number, ay: number, bx: number, by: number, w: number): boolean =>
  ax < bx + w && ax + w > bx && ay < by + w && ay + w > by;

/** What enemies walk through: the rules for tiles and people, seen from one run. Actors block each other (people, other enemies). */
function enemyWorld(run: Run): EnemyWorld {
  return {
    solid: (map, col, row) => solidOn(run, map, col, row, true),
    blocked: (map, x, y, self) => {
      const c0 = Math.floor(x / TILE);
      const c1 = Math.floor((x + BODY - 1) / TILE);
      const r0 = Math.floor(y / TILE);
      const r1 = Math.floor((y + BODY - 1) / TILE);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solidOn(run, map, c, r, true)) return true;
      for (const npc of MAPS[map].npcs) if (overlaps(x, y, npc.col * TILE, npc.row * TILE, TILE) && BODY <= TILE) return true;
      for (const other of run.enemies) if (other.id !== self && other.map === map && overlaps(x, y, other.x, other.y, BODY)) return true;
      return false;
    },
    width: (map) => mapSize(map).cols,
    height: (map) => mapSize(map).rows,
  };
}

/** The people on the map are solid boxes the size of a tile. */
function npcBlocks(run: Run, x: number, y: number): boolean {
  for (const npc of MAPS[run.map].npcs) {
    const nx = npc.col * TILE;
    const ny = npc.row * TILE;
    if (x < nx + TILE && x + BODY > nx && y < ny + TILE && y + BODY > ny) return true;
  }
  return false;
}

function boxBlocked(run: Run, x: number, y: number): boolean {
  const c0 = Math.floor(x / TILE);
  const c1 = Math.floor((x + BODY - 1) / TILE);
  const r0 = Math.floor(y / TILE);
  const r1 = Math.floor((y + BODY - 1) / TILE);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (solidTile(run, c, r)) return true;
  return npcBlocks(run, x, y);
}

const centre = (run: Run): { x: number; y: number } => ({ x: run.x + BODY / 2, y: run.y + BODY / 2 });

/** Is the person `npc` in their later lines: has the bell (or bells) nearest them been found. */
export function npcState(run: Run, npc: NpcId): 0 | 1 {
  return NEAREST_BELL[npc].every((id) => run.taken.includes(id)) ? 1 : 0;
}

export function pagesOf(run: Run, npc: NpcId): readonly string[] {
  const lines = DIALOGUE[npc];
  return npcState(run, npc) === 0 ? lines.before : lines.after;
}

/** What is in front of the character: a person within reach, else the tile at the reach point. */
export function facingNpc(run: Run): NpcId | null {
  const c = centre(run);
  const len = Math.hypot(run.fx, run.fy) || 1;
  const px = c.x + (run.fx / len) * REACH;
  const py = c.y + (run.fy / len) * REACH;
  for (const npc of MAPS[run.map].npcs) {
    const nx = npc.col * TILE;
    const ny = npc.row * TILE;
    if (px >= nx - 2 && px < nx + TILE + 2 && py >= ny - 2 && py < ny + TILE + 2) return npc.id;
  }
  return null;
}

export function facingTile(run: Run): { col: number; row: number } {
  const c = centre(run);
  const len = Math.hypot(run.fx, run.fy) || 1;
  return { col: Math.floor((c.x + (run.fx / len) * REACH) / TILE), row: Math.floor((c.y + (run.fy / len) * REACH) / TILE) };
}

function withNotice(run: Run, text: string): Run {
  return { ...run, notice: text, noticeLeft: NOTICE_SECONDS };
}

const ITEM_NAMES: Readonly<Record<ItemId, string>> = { lantern: "the lantern", key: "the old key", shears: "the shears", bell: "a bell" };

/** Put the character one tile out from a door. */
function arriveAt(run: Run, map: MapId, door: Door): Run {
  const at = bodyAt(door.col + door.out[0], door.row + door.out[1]);
  return { ...run, map, x: at.x, y: at.y, rx: 0, ry: 0, fx: door.out[0], fy: door.out[1] };
}

function useDoor(run: Run, door: Door, events: GameEvent[]): Run {
  if (door.needs !== undefined && !carries(run, door.needs)) {
    events.push({ type: "locked", needs: door.needs });
    const text = door.needs === "lantern" ? "It is too dark to go in." : "The door is locked.";
    // Step back out so the character is not standing on the door still asking.
    const back = bodyAt(door.col + door.out[0], door.row + door.out[1]);
    return withNotice({ ...run, x: back.x, y: back.y, rx: 0, ry: 0 }, text);
  }
  events.push({ type: "door", to: door.to.map });
  return arriveAt(run, door.to.map, findDoor(door.to.map, door.to.door));
}

/** Touching things at the character's centre: a door, the gate, a shrine, a pickup. */
function touch(run: Run, events: GameEvent[]): Run {
  const c = centre(run);
  const col = Math.floor(c.x / TILE);
  const row = Math.floor(c.y / TILE);
  const def = MAPS[run.map];

  const door = def.doors.find((d) => d.col === col && d.row === row);
  if (door !== undefined) return useDoor(run, door, events);

  if (def.gate !== undefined && def.gate.col === col && def.gate.row === row) {
    if (bellsFound(run) >= BELLS_NEEDED) {
      events.push({ type: "win" });
      return { ...run, done: true };
    }
    events.push({ type: "gate-locked", bells: bellsFound(run) });
    const back = bodyAt(col, row + 1);
    return withNotice({ ...run, x: back.x, y: back.y, rx: 0, ry: 0 }, `The gate needs ${BELLS_NEEDED} bells. You have ${bellsFound(run)}.`);
  }

  let next = run;
  const shrine = def.shrines.find((s) => s.col === col && s.row === row);
  if (shrine === undefined) next = { ...next, onShrine: null };
  else if (run.onShrine !== shrine.id) {
    events.push({ type: "shrine", id: shrine.id });
    next = withNotice(
      { ...next, shrine: { map: run.map, col, row }, hearts: MAX_HEARTS, onShrine: shrine.id },
      "The shrine hums. Your progress is kept."
    );
  }

  const pickup = def.pickups.find((p) => p.col === col && p.row === row && !run.taken.includes(p.id));
  if (pickup !== undefined) {
    events.push({ type: "pickup", item: pickup.item, id: pickup.id });
    next = withNotice(
      { ...next, taken: [...next.taken, pickup.id], items: { ...next.items, [pickup.item]: (next.items[pickup.item] ?? 0) + 1 } },
      `Got ${ITEM_NAMES[pickup.item]}!${pickup.item === "bell" ? ` (${(next.items.bell ?? 0) + 1} of ${BELLS_NEEDED})` : ""}`
    );
  }
  return next;
}

/** Lose hearts; when none are left the character is back at the last shrine with full hearts and nothing else lost. */
export function hurt(run: Run, amount: number): StepResult {
  const hearts = run.hearts - amount;
  if (hearts > 0) return { run: { ...run, hearts }, events: [{ type: "hurt", hearts }] };
  const at = bodyAt(run.shrine.col, run.shrine.row + 1);
  return {
    run: { ...run, map: run.shrine.map, x: at.x, y: at.y, rx: 0, ry: 0, hearts: MAX_HEARTS, talk: null, onShrine: null },
    events: [{ type: "died" }],
  };
}

/** The action button: advance a conversation, start one, cut a bush, or swing. */
function act(run: Run, events: GameEvent[]): Run {
  if (run.talk !== null) {
    const pages = pagesOf(run, run.talk.npc);
    const length = [...(pages[run.talk.page] ?? "")].length;
    // The first press finishes typing the page out; the next one turns it.
    if (run.talk.shown < length) return { ...run, talk: { ...run.talk, shown: length } };
    if (run.talk.page + 1 < pages.length) {
      events.push({ type: "talk", npc: run.talk.npc, page: run.talk.page + 1 });
      return { ...run, talk: { npc: run.talk.npc, page: run.talk.page + 1, shown: 0 } };
    }
    events.push({ type: "talk-end", npc: run.talk.npc });
    return { ...run, talk: null };
  }
  const npc = facingNpc(run);
  if (npc !== null) {
    events.push({ type: "talk", npc, page: 0 });
    return { ...run, talk: { npc, page: 0, shown: 0 } };
  }
  const { col, row } = facingTile(run);
  if (cellAt(run.map, col, row) === "b" && !run.cut.includes(bushKey(run.map, col, row))) {
    if (carries(run, "shears")) {
      events.push({ type: "cut", col, row });
      return { ...run, cut: [...run.cut, bushKey(run.map, col, row)] };
    }
    return withNotice(run, "The bush is too thick to push through.");
  }
  events.push({ type: "swing" });
  // The swing: a small box in front of the character. Each enemy in it loses a heart and is knocked back; at none it is defeated.
  const c = centre(run);
  const len = Math.hypot(run.fx, run.fy) || 1;
  const sx = c.x + (run.fx / len) * REACH - SWING_SIZE / 2;
  const sy = c.y + (run.fy / len) * REACH - SWING_SIZE / 2;
  const world = enemyWorld(run);
  let enemies: Enemy[] = [];
  let defeated = run.defeated;
  for (const e of run.enemies) {
    if (e.map !== run.map || !(sx < e.x + BODY && sx + SWING_SIZE > e.x && sy < e.y + BODY && sy + SWING_SIZE > e.y)) {
      enemies.push(e);
      continue;
    }
    const hp = e.hp - 1;
    events.push({ type: "enemy-hit", id: e.id });
    if (hp <= 0) {
      events.push({ type: "enemy-defeated", id: e.id });
      defeated = [...defeated, e.id];
    } else enemies.push({ ...knockBack({ ...e, hp }, c.x, c.y, world), flash: 0.2, path: [] });
  }
  return { ...run, swing: SWING_TIME, enemies, defeated };
}

export function step(run: Run, input: Input, dt: number): StepResult {
  if (run.done) return { run, events: [] };
  const events: GameEvent[] = [];
  let next: Run = { ...run, time: run.time + dt, noticeLeft: Math.max(0, run.noticeLeft - dt) };
  if (next.noticeLeft === 0 && next.notice !== null) next = { ...next, notice: null };

  if (input.action) next = act(next, events);
  next = { ...next, invuln: Math.max(0, next.invuln - dt), swing: Math.max(0, next.swing - dt) };
  if (next.talk !== null) {
    // The world waits while someone is talking; the page types itself out.
    const length = [...(pagesOf(next, next.talk.npc)[next.talk.page] ?? "")].length;
    return { run: { ...next, talk: { ...next.talk, shown: Math.min(length, next.talk.shown + REVEAL_CPS * dt) } }, events };
  }

  if (input.dx !== 0 || input.dy !== 0) {
    const len = Math.hypot(input.dx, input.dy);
    const actor: PixelActor = { x: next.x, y: next.y, rx: next.rx, ry: next.ry };
    const blocked = (x: number, y: number): boolean => boxBlocked(next, x, y);
    moveActorX(actor, (input.dx / len) * SPEED * dt, blocked);
    moveActorY(actor, (input.dy / len) * SPEED * dt, blocked);
    next = {
      ...next,
      x: actor.x,
      y: actor.y,
      rx: actor.rx,
      ry: actor.ry,
      fx: Math.sign(input.dx) || (input.dy !== 0 ? 0 : next.fx),
      fy: Math.sign(input.dy) || (input.dx !== 0 ? 0 : next.fy),
    };
    next = touch(next, events);
  }
  // The enemies on this map: each moves, and one touching the character hurts them (then they have a moment of safety).
  if (next.enemies.some((e) => e.map === next.map)) {
    const world = enemyWorld(next);
    let random = next.rng;
    const moved: Enemy[] = [];
    for (const e of next.enemies) {
      if (e.map !== next.map) {
        moved.push(e);
        continue;
      }
      const stepped = stepEnemy(e, dt, next, world, random);
      random = stepped.random;
      moved.push(stepped.enemy);
    }
    next = { ...next, enemies: moved, rng: random };
    if (next.invuln === 0 && moved.some((e) => e.map === next.map && overlaps(next.x, next.y, e.x, e.y, BODY))) {
      const hit = hurt(next, 1);
      events.push(...hit.events);
      next = { ...hit.run, invuln: hit.events.some((e) => e.type === "died") ? 0 : INVULNERABLE };
    }
  }
  return { run: next, events };
}

/** What a save holds: a plain object picked from the run, with a version. The position is where the shrine put the character. */
export interface SaveData {
  readonly version: number;
  readonly items: Readonly<Partial<Record<ItemId, number>>>;
  readonly taken: readonly string[];
  readonly cut: readonly string[];
  readonly shrine: Run["shrine"];
  readonly time: number;
  /** Ids of enemies defeated. Optional so a save made before there were enemies still loads. */
  readonly defeated?: readonly string[];
}

export function saveOf(run: Run): SaveData {
  return {
    version: SAVE_VERSION,
    items: { ...run.items },
    taken: [...run.taken],
    cut: [...run.cut],
    shrine: { ...run.shrine },
    time: run.time,
    defeated: [...run.defeated],
  };
}

/** A run from a save: standing at its shrine with full hearts. Null for a save of another version or one that is not a save. */
export function loadRun(save: unknown): Run | null {
  if (typeof save !== "object" || save === null) return null;
  const s = save as Partial<SaveData>;
  if (
    s.version !== SAVE_VERSION ||
    s.items === undefined ||
    s.taken === undefined ||
    s.cut === undefined ||
    s.shrine === undefined ||
    typeof s.time !== "number"
  )
    return null;
  const at = bodyAt(s.shrine.col, s.shrine.row + 1);
  const defeated = Array.isArray(s.defeated) ? [...s.defeated] : [];
  return {
    ...newRun(),
    map: s.shrine.map,
    x: at.x,
    y: at.y,
    items: { ...s.items },
    taken: [...s.taken],
    cut: [...s.cut],
    shrine: { ...s.shrine },
    time: s.time,
    defeated,
    enemies: spawnAll(defeated),
  };
}

/** The inventory's slots, eight of them, in a fixed order; a slot the character has nothing for is empty (`item` is ""). */
export interface Slot {
  readonly id: string;
  readonly item: ItemId | "";
  /** False for an empty slot. */
  readonly filled: boolean;
  readonly name: string;
  /** "x2" for more than one, else "". */
  readonly label: string;
  readonly count: number;
  /** Where the slot sits on the pause screen, in screen pixels. */
  readonly x: number;
  readonly y: number;
}

const SLOT_ORDER: readonly ItemId[] = ["lantern", "key", "shears", "bell"];
const SLOT_NAMES: Readonly<Record<ItemId, string>> = { lantern: "Lantern", key: "Old key", shears: "Shears", bell: "Bells" };

export function slotsOf(run: Run): Slot[] {
  const place = (n: number) => ({ id: `slot${n}`, x: 12 + (n % 4) * 46, y: 24 + Math.floor(n / 4) * 40 });
  const slots: Slot[] = [];
  for (const item of SLOT_ORDER) {
    const count = run.items[item] ?? 0;
    if (count > 0)
      slots.push({ ...place(slots.length), item, filled: true, name: SLOT_NAMES[item], label: count > 1 ? `x${count}` : "", count });
  }
  while (slots.length < INVENTORY_SLOTS) slots.push({ ...place(slots.length), item: "", filled: false, name: "", label: "", count: 0 });
  return slots;
}
