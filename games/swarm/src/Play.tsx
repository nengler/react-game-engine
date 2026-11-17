import { Camera, Entity, Hud, ParticleLayer, nearby, useInput, useMutable, useUpdate } from "@tsengine/runtime/jsx";

import { Aura } from "./Aura.tsx";
import { Blades } from "./Blades.tsx";
import { fx, sfx } from "./effects.ts";
import { Enemy } from "./Enemy.tsx";
import { useGame } from "./GameState.ts";
import { Gem } from "./Gem.tsx";
import { Ground } from "./Ground.tsx";
import { Label } from "./Label.tsx";
import { LevelUp } from "./LevelUp.tsx";
import { MenuButton } from "./MenuButton.tsx";
import { Modal } from "./Modal.tsx";
import { Player } from "./Player.tsx";
import {
  ENEMY_CAP,
  INVULN,
  MAGNET,
  MAX_GEMS,
  PLAYER_HP,
  PLAYER_SPEED,
  RUN_LENGTH,
  SPAWN_PER_STEP,
  SPAWN_RADIUS,
  TOUCH,
} from "./rules/constants.ts";
import { ENEMIES, hpAt, type EnemyKind } from "./rules/enemies.ts";
import { kindAt, ringAt, targetAt } from "./rules/spawn.ts";
import {
  magnetOf,
  maxHpOf,
  offersFor,
  raise,
  speedOf,
  FULL_BUILD,
  START_BUILD,
  xpToNext,
  type Build,
  type UpgradeId,
} from "./rules/upgrades.ts";
import { Shot } from "./Shot.tsx";
import type { Bolt, Drop, Foe } from "./swarm.ts";
import { TopBar } from "./TopBar.tsx";
import { Wand } from "./Wand.tsx";

interface PlayProps {
  /** What the spawner rolls from: the same seed and the same input play the same run. */
  seed?: number;
  /** The most enemies alive at once. */
  cap?: number;
  /** Seconds the spawner's clock starts at: a run started at 360 has 1,500 enemies coming at once (the stress scenes). */
  startTime?: number;
  /** The player is never hurt and never levels up (the stress scenes, which are about the crowd, not the run). */
  stress?: boolean;
  /** The stress scenes' player carries every weapon at its last level, so bolts, blades and the aura are all in the crowd. */
  armed?: boolean;
}

/**
 * The run. It keeps what the whole run shares: where the player is and how they are, the clock and the spawner, the experience and
 * the build, and the lists of enemies, bolts and gems, which it draws as components that each keep their own state. Enemies report
 * up when they die, bolts when they are spent, gems when they are taken; the wand when it fires. Over it all, the top bar and, when
 * a level is gained or the game paused, a menu.
 */
export function Play({ seed = 1, cap = ENEMY_CAP, startTime = 0, stress = false, armed = false }: PlayProps) {
  const paused = useGame((g) => g.paused);
  const { togglePause, resume, toTitle, choose, finish } = useGame.actions();

  const s = useMutable({
    px: 0,
    py: 0,
    facingLeft: false,
    moving: false,
    hp: PLAYER_HP as number,
    maxHp: PLAYER_HP as number,
    invuln: 0,
    /** Seconds since the run started, and the spawner's clock (the same, unless the run started later on the curve). */
    time: 0,
    clock: startTime,
    kills: 0,
    level: 1,
    xp: 0,
    build: (armed ? FULL_BUILD : START_BUILD) as Build,
    /** What the level-up menu offers; empty when it is not showing. */
    offers: [] as readonly UpgradeId[],
    seed: seed,
    enemies: [] as Foe[],
    bolts: [] as Bolt[],
    gems: [] as Drop[],
    nextId: 1,
  });
  const need = xpToNext(s.level);

  useInput((input) => {
    if (input.pressed("pause")) togglePause();
  });

  useUpdate((dt, input) => {
    if (s.hp <= 0) {
      finish(false, s.time, s.kills, s.level);
      return;
    }
    if (s.time >= RUN_LENGTH && !stress) {
      finish(true, s.time, s.kills, s.level);
      return;
    }
    s.time += dt;
    s.clock += dt;

    // Move.
    const mx = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
    const my = (input.down("down") ? 1 : 0) - (input.down("up") ? 1 : 0);
    s.moving = mx !== 0 || my !== 0;
    if (s.moving) {
      const d = Math.sqrt(mx * mx + my * my);
      const speed = PLAYER_SPEED * speedOf(s.build);
      s.px += (mx / d) * speed * dt;
      s.py += (my / d) * speed * dt;
      if (mx !== 0) s.facingLeft = mx < 0;
    }

    // Hurt by what touches.
    if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - dt);
    else if (!stress) {
      const touching = nearby("enemy", s.px, s.py, TOUCH);
      if (touching.length > 0) {
        let worst = 0;
        for (const t of touching) worst = Math.max(worst, t.data.damage);
        s.hp -= worst;
        s.invuln = INVULN;
        sfx.play("hurt");
        fx.burst("hurt", s.px, s.py);
      }
    }

    // Top the crowd up.
    const want = targetAt(s.clock, cap);
    if (s.enemies.length < want) {
      const added: Foe[] = [];
      let rolled = s.seed;
      for (let i = 0; i < Math.min(SPAWN_PER_STEP, want - s.enemies.length); i++) {
        const k = kindAt(s.clock, rolled);
        const at = ringAt(s.px, s.py, SPAWN_RADIUS, k.seed);
        rolled = at.seed;
        added.push({ id: s.nextId + i, kind: k.kind, x: at.x, y: at.y, hp: hpAt(k.kind, s.time) });
      }
      s.seed = rolled;
      s.nextId += added.length;
      s.enemies = [...s.enemies, ...added];
    }

    // A level gained: the run waits for a choice.
    if (!stress && s.offers.length === 0 && s.xp >= need) {
      const o = offersFor(s.build, s.seed);
      s.seed = o.seed;
      s.xp -= need;
      s.level += 1;
      s.offers = o.offers;
      if (o.offers.length > 0) {
        sfx.play("level");
        fx.burst("level", s.px, s.py);
        choose(true);
      }
    }
  });

  const killed = (id: number, kind: EnemyKind, x: number, y: number) => {
    s.enemies = s.enemies.filter((e) => e.id !== id);
    s.kills += 1;
    sfx.play("die");
    fx.burst("die", x, y);
    const value = ENEMIES[kind].xp;
    if (s.gems.length < MAX_GEMS) {
      s.gems = [...s.gems, { id: s.nextId, x, y, value }];
      s.nextId += 1;
    } else {
      // Too many on the ground: it goes into one already there, which grows.
      const i = id % s.gems.length;
      const g = s.gems[i]!;
      s.gems[i] = { ...g, value: g.value + value };
    }
  };
  const fired = (bolts: Omit<Bolt, "id">[]) => {
    s.bolts = [...s.bolts, ...bolts.map((b, i) => ({ ...b, id: s.nextId + i }))];
    s.nextId += bolts.length;
  };
  const spent = (id: number) => {
    s.bolts = s.bolts.filter((b) => b.id !== id);
  };
  const taken = (id: number, value: number) => {
    s.gems = s.gems.filter((g) => g.id !== id);
    s.xp += value;
    sfx.play("gem");
  };
  const pick = (id: UpgradeId) => {
    s.build = raise(s.build, id);
    if (id === "heart") {
      s.maxHp = maxHpOf(s.build, PLAYER_HP);
      s.hp = s.maxHp;
    }
    s.offers = [];
    sfx.play("pick");
    choose(false);
  };

  const magnet = MAGNET * magnetOf(s.build);
  return (
    <Entity>
      <Ground cx={s.px} cy={s.py} />
      {s.gems.map((g) => (
        <Gem key={g.id} {...g} px={s.px} py={s.py} magnet={magnet} onTaken={taken} />
      ))}
      <Entity x={s.px} y={s.py}>
        {s.build.aura > 0 && <Aura build={s.build} px={s.px} py={s.py} />}
      </Entity>
      {s.enemies.map((e) => (
        <Enemy key={e.id} {...e} px={s.px} py={s.py} onKilled={killed} />
      ))}
      {s.bolts.map((b) => (
        <Shot key={b.id} {...b} onDone={spent} />
      ))}
      <Camera smoothing={0.08}>
        <Entity x={s.px} y={s.py}>
          <Player hp={s.hp} maxHp={s.maxHp} invuln={s.invuln} facingLeft={s.facingLeft} moving={s.moving} />
          {s.build.blades > 0 && <Blades build={s.build} px={s.px} py={s.py} />}
        </Entity>
      </Camera>
      <Wand build={s.build} px={s.px} py={s.py} onFire={fired} />
      <ParticleLayer particles={fx} />
      <Hud>
        <TopBar xp={s.xp} need={need} level={s.level} time={s.time} kills={s.kills} enemies={s.enemies.length} />
        {s.offers.length > 0 && <LevelUp offers={s.offers} build={s.build} onPick={pick} />}
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
