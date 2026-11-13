import { Entity, Hud, ParticleLayer, useInput, useRef, useState, useUpdate } from "@rge/runtime/jsx";
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

  const [gold, setGold] = useState(startGold);
  const [lives, setLives] = useState<number>(START_LIVES);
  /** Waves started so far, and whether one is on (enemies are coming or alive). */
  const [wave, setWave] = useState(0);
  const [active, setActive] = useState(false);
  /** Seconds since the wave started, how many of its enemies have come, and the seed their lanes are rolled from. */
  const [clock, setClock] = useState(0);
  const [spawned, setSpawned] = useState(0);
  const [laneSeed, setLaneSeed] = useState(seed);
  const [towers, setTowers] = useState<readonly (Built | null)[]>(NO_TOWERS);
  const [enemies, setEnemies] = useState<readonly Foe[]>([]);
  const [shots, setShots] = useState<readonly InFlight[]>([]);
  /** The next id for an enemy or a shot (a list's key). */
  const nextId = useRef(1);
  const spawns = spawnsOf(wave - 1);

  useUpdate((dt) => {
    if (lives <= 0) {
      finish(false, 0, wave);
      return;
    }
    if (!active) return;
    if (spawned >= spawns.length && enemies.length === 0) {
      setActive(false);
      setGold((g) => g + WAVE_BONUS);
      if (wave >= WAVE_COUNT) finish(true, lives, wave);
      return;
    }
    // The enemies whose time has come.
    const now = clock + dt;
    const fresh: Foe[] = [];
    let next = spawned;
    let rolled = laneSeed;
    while (next < spawns.length && spawns[next]!.at <= now) {
      const kind = spawns[next]!.kind;
      const r = rollSigned(rolled);
      rolled = r.seed;
      fresh.push({ id: nextId.current, kind, lane: r.value * LANE_SPREAD, maxHp: hpOf(kind, wave - 1) });
      next += 1;
      nextId.current += 1;
    }
    setClock(now);
    if (fresh.length > 0) {
      setSpawned(next);
      setLaneSeed(rolled);
      setEnemies((list) => [...list, ...fresh]);
    }
  });
  useInput((input) => {
    if (input.pressed("back")) close();
  });

  const startWave = () => {
    if (active || wave >= WAVE_COUNT) {
      sfx.play("deny");
      return;
    }
    setWave(wave + 1);
    setActive(true);
    setClock(0);
    setSpawned(0);
    sfx.play("wave");
  };
  /** Set the cursor's pad's tower, for `cost` gold (a sale's is negative). */
  const trade = (tower: Built | null, cost: number) => {
    const pad = MAP.pads[cursor]!;
    setGold((g) => g - cost);
    setTowers(towers.map((t, i) => (i === cursor ? tower : t)));
    fx.burst("dust", pad.x, pad.y);
  };
  const build = (kind: TowerKind) => {
    const cost = TOWERS[kind].cost;
    if (towers[cursor] !== null || gold < cost) {
      sfx.play("deny");
      return;
    }
    trade({ kind, level: 0, spent: cost }, cost);
    sfx.play("build");
  };
  const upgrade = () => {
    const tower = towers[cursor] ?? null;
    const cost = tower === null ? null : upgradeCost(tower.kind, tower.level);
    if (tower === null || cost === null || gold < cost) {
      sfx.play("deny");
      return;
    }
    trade({ ...tower, level: tower.level + 1, spent: tower.spent + cost }, cost);
    sfx.play("upgrade");
  };
  const sell = () => {
    const tower = towers[cursor] ?? null;
    if (tower === null) {
      sfx.play("deny");
      return;
    }
    trade(null, -refundOf(tower.spent));
    sfx.play("sell");
  };
  const killed = (id: number, kind: "runner" | "grunt" | "brute", x: number, y: number) => {
    setEnemies((list) => list.filter((e) => e.id !== id));
    setGold((g) => g + ENEMIES[kind].gold);
    sfx.play("death");
    fx.burst("die", x, y);
  };
  const leaked = (id: number, kind: "runner" | "grunt" | "brute") => {
    setEnemies((list) => list.filter((e) => e.id !== id));
    setLives((l) => Math.max(0, l - ENEMIES[kind].lives));
    sfx.play("leak");
  };
  const fire = (shot: Fired) => {
    const id = nextId.current;
    nextId.current += 1;
    setShots((list) => [...list, { ...shot, id }]);
  };
  const landed = (id: number) => {
    setShots((list) => list.filter((s) => s.id !== id));
  };

  return (
    <Entity>
      <Field />
      {MAP.pads.map((p) => (
        <Pad key={p.id} id={p.id} x={p.x} y={p.y} seed={seed * 101 + p.id} tower={towers[p.id] ?? null} onFire={fire} />
      ))}
      {enemies.map((e) => (
        <Enemy key={e.id} {...e} onKilled={killed} onLeaked={leaked} />
      ))}
      {shots.map((s) => (
        <Shot key={s.id} {...s} onLanded={landed} />
      ))}
      <ParticleLayer particles={fx} />
      <Hud>
        <SidePanel gold={gold} lives={lives} wave={wave} active={active} tower={towers[cursor] ?? null} onStartWave={startWave} onBuild={build} onUpgrade={upgrade} onSell={sell} />
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
