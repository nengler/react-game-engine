import { Entity, Hud, ParticleLayer, useInput, useMutable, useUpdate } from "@rge/runtime/jsx";
import { hpOf, type Built, type Fired, type Foe, type InFlight } from "./battle.ts";
import { Enemy } from "./Enemy.tsx";
import { fx, sfx } from "./effects.ts";
import { Field } from "./Field.tsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Modal } from "./Modal.tsx";
import { Pad } from "./Pad.tsx";
import { Shot } from "./Shot.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { LANE_SPREAD, START_GOLD, START_LIVES, WAVE_BONUS } from "./rules/constants.ts";
import { ENEMIES } from "./rules/enemies.ts";
import { MAP } from "./rules/map.ts";
import { rollSigned } from "./rules/rng.ts";
import { refundOf, TOWERS, upgradeCost, type TowerKind } from "./rules/towers.ts";
import { spawnsOf, WAVE_COUNT } from "./rules/waves.ts";

/** No towers yet: one empty place per pad. */
const NO_TOWERS: readonly (Built | null)[] = MAP.pads.map(() => null);

interface PlayProps {
  /** The gold a battle starts with. */
  startGold?: number;
  /** What the lanes of its enemies and the scatter of its mortar shells are rolled from: the same seed plays the same battle. */
  seed?: number;
}

/**
 * The battle. It keeps what the whole battle shares: the gold, the lives, the wave and its spawner, the towers bought on each pad,
 * and the lists of enemies and shots, which it draws as components that each keep their own state. Enemies report up when they
 * die or get through, towers when they fire, shots when they have landed; the side panel's buttons call its `build`, `upgrade`,
 * `sell` and `startWave`. Over the field, the side panel and, when paused, a menu.
 */
export function Play({ startGold = START_GOLD, seed = 1 }: PlayProps) {
  const cursor = useGame((s) => s.cursor);
  const paused = useGame((s) => s.paused);
  const { close, resume, toTitle, finish } = useGame.actions();

  const s = useMutable({
    gold: startGold,
    lives: START_LIVES as number,
    /** Waves started so far, and whether one is on (enemies are coming or alive). */
    wave: 0,
    active: false,
    /** Seconds since the wave started, how many of its enemies have come, and the seed their lanes are rolled from. */
    clock: 0,
    spawned: 0,
    laneSeed: seed,
    towers: NO_TOWERS as readonly (Built | null)[],
    enemies: [] as readonly Foe[],
    shots: [] as readonly InFlight[],
    /** The next id for an enemy or a shot (a list's key). */
    nextId: 1,
  });
  const spawns = spawnsOf(s.wave - 1);

  useUpdate((dt) => {
    if (s.lives <= 0) {
      finish(false, 0, s.wave);
      return;
    }
    if (!s.active) return;
    if (s.spawned >= spawns.length && s.enemies.length === 0) {
      s.active = false;
      s.gold += WAVE_BONUS;
      if (s.wave >= WAVE_COUNT) finish(true, s.lives, s.wave);
      return;
    }
    // The enemies whose time has come.
    s.clock += dt;
    while (s.spawned < spawns.length && spawns[s.spawned]!.at <= s.clock) {
      const kind = spawns[s.spawned]!.kind;
      const r = rollSigned(s.laneSeed);
      s.laneSeed = r.seed;
      s.enemies = [...s.enemies, { id: s.nextId, kind, lane: r.value * LANE_SPREAD, maxHp: hpOf(kind, s.wave - 1) }];
      s.spawned += 1;
      s.nextId += 1;
    }
  });
  useInput((input) => {
    if (input.pressed("back")) close();
  });

  const startWave = () => {
    if (s.active || s.wave >= WAVE_COUNT) {
      sfx.play("deny");
      return;
    }
    s.wave += 1;
    s.active = true;
    s.clock = 0;
    s.spawned = 0;
    sfx.play("wave");
  };
  /** Set the cursor's pad's tower, for `cost` gold (a sale's is negative). */
  const trade = (tower: Built | null, cost: number) => {
    const pad = MAP.pads[cursor]!;
    s.gold -= cost;
    s.towers = s.towers.map((t, i) => (i === cursor ? tower : t));
    fx.burst("dust", pad.x, pad.y);
  };
  const build = (kind: TowerKind) => {
    const cost = TOWERS[kind].cost;
    if (s.towers[cursor] !== null || s.gold < cost) {
      sfx.play("deny");
      return;
    }
    trade({ kind, level: 0, spent: cost }, cost);
    sfx.play("build");
  };
  const upgrade = () => {
    const tower = s.towers[cursor] ?? null;
    const cost = tower === null ? null : upgradeCost(tower.kind, tower.level);
    if (tower === null || cost === null || s.gold < cost) {
      sfx.play("deny");
      return;
    }
    trade({ ...tower, level: tower.level + 1, spent: tower.spent + cost }, cost);
    sfx.play("upgrade");
  };
  const sell = () => {
    const tower = s.towers[cursor] ?? null;
    if (tower === null) {
      sfx.play("deny");
      return;
    }
    trade(null, -refundOf(tower.spent));
    sfx.play("sell");
  };
  const killed = (id: number, kind: "runner" | "grunt" | "brute", x: number, y: number) => {
    s.enemies = s.enemies.filter((e) => e.id !== id);
    s.gold += ENEMIES[kind].gold;
    sfx.play("death");
    fx.burst("die", x, y);
  };
  const leaked = (id: number, kind: "runner" | "grunt" | "brute") => {
    s.enemies = s.enemies.filter((e) => e.id !== id);
    s.lives = Math.max(0, s.lives - ENEMIES[kind].lives);
    sfx.play("leak");
  };
  const fire = (shot: Fired) => {
    s.shots = [...s.shots, { ...shot, id: s.nextId }];
    s.nextId += 1;
  };
  const landed = (id: number) => {
    s.shots = s.shots.filter((shot) => shot.id !== id);
  };

  return (
    <Entity>
      <Field />
      {MAP.pads.map((p) => (
        <Pad key={p.id} id={p.id} x={p.x} y={p.y} seed={seed * 101 + p.id} tower={s.towers[p.id] ?? null} onFire={fire} />
      ))}
      {s.enemies.map((e) => (
        <Enemy key={e.id} {...e} onKilled={killed} onLeaked={leaked} />
      ))}
      {s.shots.map((shot) => (
        <Shot key={shot.id} {...shot} onLanded={landed} />
      ))}
      <ParticleLayer particles={fx} />
      <Hud>
        <SidePanel gold={s.gold} lives={s.lives} wave={s.wave} active={s.active} tower={s.towers[cursor] ?? null} onStartWave={startWave} onBuild={build} onUpgrade={upgrade} onSell={sell} />
        {paused && (
          <Modal title="PAUSED">
            <MenuButton onPress={resume}>
              <Label>RESUME</Label>
            </MenuButton>
            <MenuButton onPress={toTitle}>
              <Label>QUIT TO TITLE</Label>
            </MenuButton>
          </Modal>
        )}
      </Hud>
    </Entity>
  );
}
