import { AnimatedSprite, Collider, Entity, nearby, useMutable, useUpdate } from "@tsengine/runtime/jsx";

import { DESPAWN_RADIUS, FLASH, KNOCK_DECAY, PUSH, SPACING } from "./rules/constants.ts";
import { ENEMIES, type EnemyKind } from "./rules/enemies.ts";
import type { Hit } from "./swarm.ts";

/** Each kind's two-frame walk in `sprites.png`. */
const WALKS = {
  bat: { frames: "2-3", fps: 10 },
  zombie: { frames: "4-5", fps: 5 },
  brute: { frames: "6-7", fps: 4 },
};

interface EnemyProps {
  id: number;
  kind: EnemyKind;
  /** Where it came in, and its hit points then. */
  x: number;
  y: number;
  hp: number;
  /** Where the player is now. */
  px: number;
  py: number;
  /** Its hit points ran out: it drops its experience where it fell. */
  onKilled: (id: number, kind: EnemyKind, x: number, y: number) => void;
}

/**
 * One enemy. It walks straight at the player, keeps a little apart from the enemies next to it (it asks which are within
 * `SPACING` and steps away from them), is shoved back by what hits it, and says when it dies. Left far behind, it comes back on the
 * other side of the player. Bolts and blades hurt it through its collider; the aura is sent to it (`onReceive`).
 */
export function Enemy({ id, kind, x: x0, y: y0, hp, px, py, onKilled }: EnemyProps) {
  const s = useMutable({ x: x0, y: y0, hp: hp, kx: 0, ky: 0, flash: 0 });
  const k = ENEMIES[kind];

  const hurt = (hit: Hit) => {
    s.hp -= hit.damage;
    s.flash = FLASH;
    const dx = s.x - hit.x;
    const dy = s.y - hit.y;
    const d = Math.hypot(dx, dy) || 1;
    // Brutes barely move when hit.
    const knock = kind === "brute" ? hit.knock * 0.25 : hit.knock;
    s.kx = (dx / d) * knock;
    s.ky = (dy / d) * knock;
  };

  useUpdate((dt) => {
    if (s.hp <= 0) {
      onKilled(id, kind, s.x, s.y);
      return;
    }
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
    const dx = px - s.x;
    const dy = py - s.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > DESPAWN_RADIUS) {
      // Left behind: back on the far side, a little inside the ring.
      s.x = px + dx * 0.85;
      s.y = py + dy * 0.85;
      return;
    }
    let vx = (dx / d) * k.speed;
    let vy = (dy / d) * k.speed;
    // Keep apart from the ones nearest.
    const near = nearby("enemy", s.x, s.y, SPACING);
    for (let i = 0; i < near.length && i < 4; i++) {
      const o = near[i]!;
      const ox = s.x - o.x;
      const oy = s.y - o.y;
      const od = Math.hypot(ox, oy);
      if (od < 0.01) {
        // On top of each other: split by id, so the two go different ways.
        vx += id % 2 === 0 ? PUSH : -PUSH;
        continue;
      }
      const overlap = Math.max(0, 1 - od / k.size);
      vx += (ox / od) * PUSH * overlap;
      vy += (oy / od) * PUSH * overlap;
    }
    s.x += (vx + s.kx) * dt;
    s.y += (vy + s.ky) * dt;
    const decay = Math.pow(KNOCK_DECAY, dt);
    s.kx = Math.abs(s.kx) < 1 ? 0 : s.kx * decay;
    s.ky = Math.abs(s.ky) < 1 ? 0 : s.ky * decay;
  });

  const half = k.size / 2;
  return (
    <Entity x={s.x} y={s.y}>
      <AnimatedSprite
        sheet="sprites.png"
        frameWidth={16}
        frameHeight={16}
        animations={WALKS}
        animation={kind}
        originX={8}
        originY={8}
        flipX={px < s.x}
        flash={s.flash > 0 ? 1 : 0}
      />
      <Collider
        width={k.size}
        height={k.size}
        x={-half}
        y={-half}
        tag="enemy"
        layer="enemy"
        hits={["shot"]}
        data={{ id, damage: k.damage }}
        onCollisionEnter={(other) => {
          if (other.tag === "shot" || other.tag === "blade") hurt(other.data);
        }}
        onReceive={hurt}
      />
    </Entity>
  );
}
