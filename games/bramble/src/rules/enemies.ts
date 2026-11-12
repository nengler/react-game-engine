/**
 * The two enemies, as plain data and functions: a beetle wanders and turns at walls; a wisp drifts until the character is within
 * sight and in range, then follows a path to them (found again every half second, not every step) and gives up four seconds after
 * losing sight. Enemies keep their place when the character leaves a map: they are all in the run, and only the ones on the
 * character's map are stepped.
 */
import { findPath, lineOfSight, moveActorX, moveActorY, type Cell, type PixelActor } from "@rge/runtime";
import { BEETLE_HP, BEETLE_SPEED, BODY, KNOCKBACK, TILE, WISP_GIVE_UP, WISP_HP, WISP_REPATH, WISP_SIGHT, WISP_SPEED } from "./constants.ts";
import type { EnemyKind, MapId } from "./maps.ts";

export interface Enemy {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly map: MapId;
  /** The hitbox's top left in pixels, and the sub-pixel remainder (as the character has). */
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly hp: number;
  /** The way it is heading: each of -1, 0, 1. */
  readonly dx: number;
  readonly dy: number;
  /** Seconds until a wandering enemy picks a new way. */
  readonly turn: number;
  readonly chasing: boolean;
  /** Seconds since a chasing wisp last saw the character, and until it finds a new path. */
  readonly lost: number;
  readonly repath: number;
  /** The cells a chasing wisp is following, the next first. */
  readonly path: readonly Cell[];
  /** Seconds the enemy flashes after being hit. */
  readonly flash: number;
}

export interface EnemyWorld {
  /** Is the cell solid on this map (walls, water, uncut bushes). */
  solid(map: MapId, col: number, row: number): boolean;
  /** Does a box at (x, y) overlap anything an enemy cannot walk through, other than the enemy `self` (tiles, people, other enemies)? */
  blocked(map: MapId, x: number, y: number, self: string): boolean;
  width(map: MapId): number;
  height(map: MapId): number;
}

export function spawnEnemy(id: string, kind: EnemyKind, map: MapId, col: number, row: number): Enemy {
  return {
    id,
    kind,
    map,
    x: col * TILE + (TILE - BODY) / 2,
    y: row * TILE + (TILE - BODY) / 2,
    rx: 0,
    ry: 0,
    hp: kind === "beetle" ? BEETLE_HP : WISP_HP,
    dx: 1,
    dy: 0,
    turn: 1,
    chasing: false,
    lost: 0,
    repath: 0,
    path: [],
    flash: 0,
  };
}

/** A small deterministic generator: the next number in [0, 1) and the next state. Same seed, same enemies, under any engine. */
export function nextRandom(state: number): [number, number] {
  const next = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return [next / 4294967296, next];
}

const DIRECTIONS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const cellOf = (x: number, y: number): Cell => ({ x: Math.floor((x + BODY / 2) / TILE), y: Math.floor((y + BODY / 2) / TILE) });

function move(enemy: Enemy, vx: number, vy: number, dt: number, world: EnemyWorld): { enemy: Enemy; hitX: boolean; hitY: boolean } {
  const actor: PixelActor = { x: enemy.x, y: enemy.y, rx: enemy.rx, ry: enemy.ry };
  const blocked = (x: number, y: number): boolean => world.blocked(enemy.map, x, y, enemy.id);
  const hitX = vx !== 0 && moveActorX(actor, vx * dt, blocked);
  const hitY = vy !== 0 && moveActorY(actor, vy * dt, blocked);
  return { enemy: { ...enemy, x: actor.x, y: actor.y, rx: actor.rx, ry: actor.ry }, hitX, hitY };
}

/** Step one enemy by `dt` with the character's box at (px, py). Returns it and the random state. */
export function stepEnemy(enemy: Enemy, dt: number, player: { readonly x: number; readonly y: number }, world: EnemyWorld, random: number): { enemy: Enemy; random: number } {
  let e: Enemy = enemy.flash > 0 ? { ...enemy, flash: Math.max(0, enemy.flash - dt) } : enemy;
  let r = random;
  if (e.kind === "beetle") {
    let turn = e.turn - dt;
    let { dx, dy } = e;
    if (turn <= 0) {
      let roll: number;
      [roll, r] = nextRandom(r);
      const d = DIRECTIONS[Math.floor(roll * 4)] as readonly [number, number];
      [dx, dy] = d;
      [roll, r] = nextRandom(r);
      turn = 0.8 + roll * 1.6;
    }
    const moved = move({ ...e, dx, dy, turn }, dx * BEETLE_SPEED, dy * BEETLE_SPEED, dt, world);
    e = moved.enemy;
    if (moved.hitX || moved.hitY) {
      // Turns at a wall: the next way round, at once.
      const at = DIRECTIONS.findIndex((d) => d[0] === e.dx && d[1] === e.dy);
      const d = DIRECTIONS[(at + 1) % 4] as readonly [number, number];
      e = { ...e, dx: d[0], dy: d[1], turn: 0.8 };
    }
    return { enemy: e, random: r };
  }

  // A wisp.
  const here = { x: e.x + BODY / 2, y: e.y + BODY / 2 };
  const there = { x: player.x + BODY / 2, y: player.y + BODY / 2 };
  const distance = Math.hypot(there.x - here.x, there.y - here.y);
  const sees = distance <= WISP_SIGHT && lineOfSight({ width: world.width(e.map), height: world.height(e.map), tileWidth: TILE, tileHeight: TILE }, here, there, (c, rr) => world.solid(e.map, c, rr));
  if (sees) e = { ...e, chasing: true, lost: 0 };
  else if (e.chasing) {
    const lost = e.lost + dt;
    e = lost >= WISP_GIVE_UP ? { ...e, chasing: false, lost: 0, path: [] } : { ...e, lost };
  }
  if (!e.chasing) {
    // Drifts: slowly, in a changing way.
    let turn = e.turn - dt;
    let { dx, dy } = e;
    if (turn <= 0) {
      let roll: number;
      [roll, r] = nextRandom(r);
      const d = DIRECTIONS[Math.floor(roll * 4)] as readonly [number, number];
      [dx, dy] = d;
      [roll, r] = nextRandom(r);
      turn = 1 + roll * 2;
    }
    const moved = move({ ...e, dx, dy, turn }, dx * WISP_SPEED * 0.4, dy * WISP_SPEED * 0.4, dt, world);
    return { enemy: moved.enemy, random: r };
  }
  // Chasing: a new path every WISP_REPATH seconds (and when there is none), then a step towards the next cell's middle.
  let repath = e.repath - dt;
  let path = e.path;
  if (repath <= 0 || path.length === 0) {
    const found = findPath({ width: world.width(e.map), height: world.height(e.map) }, cellOf(e.x, e.y), cellOf(player.x, player.y), {
      blocked: (c, rr) => world.solid(e.map, c, rr),
      diagonal: true,
      maxNodes: 600,
    });
    path = found ?? [];
    repath = WISP_REPATH;
  }
  // Drop the cells already reached, then head for the next one's middle (or straight at the character from the last cell).
  while (path.length > 0 && Math.hypot((path[0] as Cell).x * TILE + TILE / 2 - here.x, (path[0] as Cell).y * TILE + TILE / 2 - here.y) < 2) path = path.slice(1);
  const target = path.length > 0 ? { x: (path[0] as Cell).x * TILE + TILE / 2, y: (path[0] as Cell).y * TILE + TILE / 2 } : there;
  const len = Math.hypot(target.x - here.x, target.y - here.y) || 1;
  const vx = ((target.x - here.x) / len) * WISP_SPEED;
  const vy = ((target.y - here.y) / len) * WISP_SPEED;
  const moved = move({ ...e, path, repath }, vx, vy, dt, world);
  return { enemy: moved.enemy, random: r };
}

/** Knock an enemy back from (fromX, fromY), the way the swing came; it stops at a wall. */
export function knockBack(enemy: Enemy, fromX: number, fromY: number, world: EnemyWorld): Enemy {
  const away = Math.hypot(enemy.x + BODY / 2 - fromX, enemy.y + BODY / 2 - fromY) || 1;
  const ux = (enemy.x + BODY / 2 - fromX) / away;
  const uy = (enemy.y + BODY / 2 - fromY) / away;
  return move(enemy, ux * KNOCKBACK, uy * KNOCKBACK, 1, world).enemy;
}
