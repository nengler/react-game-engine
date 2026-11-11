import { FLASH, HP_PER_WAVE, LANE_SPREAD, START_GOLD, START_LIVES, TRACER, WAVE_BONUS } from "./constants.ts";
import { buy, sell, upgrade, type Denied } from "./economy.ts";
import { ENEMIES, type EnemyKind } from "./enemies.ts";
import { pathAt, type BattleMap } from "./path.ts";
import { rollSigned } from "./rng.ts";
import { pickTarget } from "./targeting.ts";
import { statsOf, TOWERS, type TowerKind } from "./towers.ts";
import { spawnsOf, WAVES, type Spawn } from "./waves.ts";

export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  /** Pixels walked along the path. */
  readonly dist: number;
  /** Where that is on the map, sideways lane included. */
  readonly x: number;
  readonly y: number;
  /** Walking left (the picture is flipped). */
  readonly left: boolean;
  readonly hp: number;
  readonly maxHp: number;
  /** Sideways offset from the path in pixels, set at spawn from the seeded generator. */
  readonly lane: number;
  /** Seconds of slow left. */
  readonly slow: number;
  /** Seconds of hit flash left. */
  readonly flash: number;
}

export interface Tower {
  readonly kind: TowerKind;
  readonly level: number;
  /** Seconds until it can fire again. */
  readonly cooldown: number;
  /** Radians, pointing at its target (it keeps the last one). */
  readonly angle: number;
  /** Battle time of the last shot, -1 for never. */
  readonly firedAt: number;
  /** Gold put into it: the price and its upgrades. */
  readonly spent: number;
}

export interface Pad {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly tower: Tower | null;
}

export interface Shot {
  readonly id: number;
  readonly kind: TowerKind;
  /** Where it starts (the tower) and where it ends. */
  readonly x: number;
  readonly y: number;
  readonly tx: number;
  readonly ty: number;
  /** Seconds since it was fired and how long it lasts. */
  readonly t: number;
  readonly flight: number;
  readonly damage: number;
  readonly radius: number;
  /** False on the step it ends; the next step drops it. */
  readonly live: boolean;
}

export type Status = "playing" | "won" | "lost";

export interface Battle {
  readonly seed: number;
  readonly time: number;
  readonly gold: number;
  readonly lives: number;
  /** Waves started so far (0 before the first). */
  readonly wave: number;
  /** A wave is on: enemies are coming or alive. */
  readonly active: boolean;
  /** Seconds since the current wave started, and its enemies in order, of which `spawned` have come. */
  readonly clock: number;
  readonly spawns: readonly Spawn[];
  readonly spawned: number;
  readonly enemies: readonly Enemy[];
  readonly pads: readonly Pad[];
  readonly shots: readonly Shot[];
  readonly nextId: number;
  readonly status: Status;
}

export type Command =
  | { readonly type: "build"; readonly pad: number; readonly kind: TowerKind }
  | { readonly type: "upgrade"; readonly pad: number }
  | { readonly type: "sell"; readonly pad: number }
  | { readonly type: "startWave" };

export type BattleEvent =
  | { readonly type: "shot"; readonly kind: TowerKind; readonly x: number; readonly y: number }
  | { readonly type: "hit"; readonly kind: TowerKind; readonly x: number; readonly y: number }
  | { readonly type: "killed"; readonly kind: EnemyKind; readonly x: number; readonly y: number; readonly gold: number }
  | { readonly type: "leaked"; readonly kind: EnemyKind; readonly lives: number }
  | { readonly type: "built" | "upgraded" | "sold"; readonly pad: number; readonly kind: TowerKind; readonly x: number; readonly y: number }
  | { readonly type: "waveStarted"; readonly wave: number }
  | { readonly type: "waveCleared"; readonly wave: number; readonly bonus: number }
  | { readonly type: "denied"; readonly reason: Denied }
  | { readonly type: "won" }
  | { readonly type: "lost" };

export interface StepResult {
  readonly battle: Battle;
  readonly events: readonly BattleEvent[];
}

export function newBattle(map: BattleMap, seed = 1): Battle {
  return {
    seed,
    time: 0,
    gold: START_GOLD,
    lives: START_LIVES,
    wave: 0,
    active: false,
    clock: 0,
    spawns: [],
    spawned: 0,
    enemies: [],
    pads: map.pads.map((p) => ({ id: p.id, x: p.x, y: p.y, tower: null })),
    shots: [],
    nextId: 1,
    status: "playing",
  };
}

/** HP of an enemy of this kind in this wave (0-based). */
export function hpOf(kind: EnemyKind, wave: number): number {
  return Math.round(ENEMIES[kind].hp * (1 + HP_PER_WAVE * wave));
}

/**
 * One fixed step of the whole simulation: the commands of this step, then spawning, walking, the towers firing, the shots
 * landing, rewards and leaks, and the end of the wave. It touches nothing outside its arguments; the engine, the sounds and the
 * pictures are the caller's. Returns the next battle and what happened in it.
 */
export function stepBattle(b: Battle, dt: number, commands: readonly Command[], map: BattleMap): StepResult {
  if (b.status !== "playing") return { battle: b, events: [] };
  const events: BattleEvent[] = [];
  let { gold, lives, seed, nextId, wave, active, clock, spawns, spawned } = b;
  let pads = b.pads;
  const time = b.time + dt;

  for (const c of commands) {
    if (c.type === "startWave") {
      if (active || wave >= WAVES.length) {
        events.push({ type: "denied", reason: "busy" });
        continue;
      }
      spawns = spawnsOf(wave);
      spawned = 0;
      clock = 0;
      active = true;
      wave += 1;
      events.push({ type: "waveStarted", wave });
      continue;
    }
    const pad = pads[c.pad];
    if (pad === undefined) continue;
    const deal = c.type === "build" ? buy(gold, pad, c.kind) : c.type === "upgrade" ? upgrade(gold, pad) : sell(gold, pad);
    if (!deal.ok) {
      events.push({ type: "denied", reason: deal.reason });
      continue;
    }
    const kind = (c.type === "sell" ? pad.tower : deal.pad.tower)!.kind;
    gold = deal.gold;
    pads = pads.map((p) => (p.id === pad.id ? deal.pad : p));
    events.push({ type: c.type === "build" ? "built" : c.type === "upgrade" ? "upgraded" : "sold", pad: pad.id, kind, x: pad.x, y: pad.y });
  }

  // Enemies: the ones already here, then the ones that come in this step.
  let enemies: Enemy[] = [...b.enemies];
  if (active) {
    clock += dt;
    while (spawned < spawns.length && (spawns[spawned] as Spawn).at <= clock) {
      const s = spawns[spawned] as Spawn;
      const r = rollSigned(seed);
      seed = r.seed;
      const hp = hpOf(s.kind, wave - 1);
      const start = pathAt(map.path, 0);
      enemies.push({ id: nextId++, kind: s.kind, dist: 0, x: start.x, y: start.y, left: false, hp, maxHp: hp, lane: r.value * LANE_SPREAD, slow: 0, flash: 0 });
      spawned += 1;
    }
  }

  // Walk. One that reaches the end takes its lives and is gone.
  const walking: Enemy[] = [];
  for (const e of enemies) {
    const def = ENEMIES[e.kind];
    const dist = e.dist + def.speed * (e.slow > 0 ? 1 - TOWERS.frost.slow : 1) * dt;
    if (dist >= map.path.length) {
      lives -= def.lives;
      events.push({ type: "leaked", kind: e.kind, lives: def.lives });
      continue;
    }
    const at = pathAt(map.path, dist);
    walking.push({ ...e, dist, x: at.x - at.dy * e.lane, y: at.y + at.dx * e.lane, left: at.dx < 0, slow: Math.max(0, e.slow - dt), flash: Math.max(0, e.flash - dt) });
  }
  enemies = walking;

  // Shots already in the air: the ones that ended last step are dropped, a mortar shell that arrives lands.
  const shots: Shot[] = [];
  const damaged = new Map<number, { hp: number; flash: number; slow: number }>();
  const hurt = (id: number, hp: number, slow = 0): void => {
    const d = damaged.get(id);
    damaged.set(id, { hp: (d?.hp ?? 0) + hp, flash: FLASH, slow: Math.max(d?.slow ?? 0, slow) });
  };
  const splash = (x: number, y: number, radius: number, damage: number, slow: number): void => {
    for (const e of enemies) if (e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= radius) hurt(e.id, damage, slow);
  };
  for (const s of b.shots) {
    if (!s.live) continue;
    const t = s.t + dt;
    if (s.kind === "mortar" && s.t < s.flight && t >= s.flight) {
      splash(s.tx, s.ty, s.radius, s.damage, 0);
      events.push({ type: "hit", kind: "mortar", x: s.tx, y: s.ty });
    }
    shots.push({ ...s, t, live: t < s.flight });
  }

  // Towers: cool down, aim and fire.
  pads = pads.map((p) => {
    const t = p.tower;
    if (t === null) return p;
    const def = TOWERS[t.kind];
    const stats = statsOf(t.kind, t.level);
    const target = pickTarget(p.x, p.y, stats.range, enemies);
    let cooldown = Math.max(0, t.cooldown - dt);
    const angle = target === null ? t.angle : Math.atan2(target.y - p.y, target.x - p.x);
    let firedAt = t.firedAt;
    if (target !== null && cooldown <= 0) {
      cooldown = def.rate;
      firedAt = time;
      events.push({ type: "shot", kind: t.kind, x: p.x, y: p.y });
      if (t.kind === "bolt") {
        hurt(target.id, stats.damage);
        events.push({ type: "hit", kind: "bolt", x: target.x, y: target.y });
        shots.push({ id: nextId++, kind: "bolt", x: p.x, y: p.y, tx: target.x, ty: target.y, t: 0, flight: TRACER, damage: stats.damage, radius: 0, live: true });
      } else if (t.kind === "frost") {
        splash(p.x, p.y, stats.radius, stats.damage, def.slowFor);
        events.push({ type: "hit", kind: "frost", x: p.x, y: p.y });
        shots.push({ id: nextId++, kind: "frost", x: p.x, y: p.y, tx: p.x, ty: p.y, t: 0, flight: TRACER, damage: stats.damage, radius: stats.radius, live: true });
      } else {
        // The shell lands where the target is now, a little off.
        const rx = rollSigned(seed);
        const ry = rollSigned(rx.seed);
        seed = ry.seed;
        shots.push({ id: nextId++, kind: "mortar", x: p.x, y: p.y, tx: target.x + rx.value * 3, ty: target.y + ry.value * 3, t: 0, flight: def.flight, damage: stats.damage, radius: stats.radius, live: true });
      }
    }
    return cooldown === t.cooldown && angle === t.angle && firedAt === t.firedAt ? p : { ...p, tower: { ...t, cooldown, angle, firedAt } };
  });

  // Damage lands; the dead pay out.
  const alive: Enemy[] = [];
  for (const e of enemies) {
    const d = damaged.get(e.id);
    if (d === undefined) {
      alive.push(e);
      continue;
    }
    const hp = e.hp - d.hp;
    if (hp <= 0) {
      const reward = ENEMIES[e.kind].gold;
      gold += reward;
      events.push({ type: "killed", kind: e.kind, x: e.x, y: e.y, gold: reward });
      continue;
    }
    alive.push({ ...e, hp, flash: d.flash, slow: Math.max(e.slow, d.slow) });
  }

  let status: Status = "playing";
  if (lives <= 0) {
    lives = 0;
    status = "lost";
    events.push({ type: "lost" });
  } else if (active && spawned >= spawns.length && alive.length === 0) {
    active = false;
    gold += WAVE_BONUS;
    events.push({ type: "waveCleared", wave, bonus: WAVE_BONUS });
    if (wave >= WAVES.length) {
      status = "won";
      events.push({ type: "won" });
    }
  }

  return { battle: { seed, time, gold, lives, wave, active, clock, spawns, spawned, enemies: alive, pads, shots, nextId, status }, events };
}
