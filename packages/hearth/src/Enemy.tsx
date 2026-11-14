import { AnimatedSprite, Collider, Entity, after, cancelTimers, useMutable, useUpdate } from "@rge/runtime/jsx";
import { HealthBar } from "./HealthBar.tsx";
import { FLASH } from "./rules/constants.ts";
import { ENEMIES } from "./rules/enemies.ts";
import { MAP } from "./rules/map.ts";
import { pathAt } from "./rules/path.ts";
import { TOWERS } from "./rules/towers.ts";

/** Each kind's four-frame walk in `enemies.png`, at its own pace. */
const WALKS = { runner: { frames: "0-3", fps: 12 }, grunt: { frames: "4-7", fps: 8 }, brute: { frames: "8-11", fps: 5 } };

interface EnemyProps {
  id: number;
  kind: "runner" | "grunt" | "brute";
  /** Sideways offset from the path, in pixels. */
  lane: number;
  maxHp: number;
  /** Its hit points ran out: it pays its gold. */
  onKilled: (id: number, kind: "runner" | "grunt" | "brute", x: number, y: number) => void;
  /** It reached the hearth: it takes its lives. */
  onLeaked: (id: number, kind: "runner" | "grunt" | "brute") => void;
}

/**
 * One enemy. It walks the path at its kind's speed (slower while frosted), takes what lands on it (a `blast` its collider
 * touches), and says when it dies or gets through. It draws a four-frame walk facing the way it goes, white for a moment when
 * hit, blue while slowed, a health bar once hurt. Towers find it by its collider, whose data says where it is.
 */
export function Enemy({ id, kind, lane, maxHp, onKilled, onLeaked }: EnemyProps) {
  const s = useMutable({ dist: 0, hp: maxHp, slow: 0, flash: false });
  const at = pathAt(MAP.path, s.dist);
  const x = at.x - at.dy * lane;
  const y = at.y + at.dx * lane;

  useUpdate((dt) => {
    if (s.hp <= 0) {
      onKilled(id, kind, x, y);
      return;
    }
    const next = s.dist + ENEMIES[kind].speed * (s.slow > 0 ? 1 - TOWERS.frost.slow : 1) * dt;
    if (next >= MAP.path.length) {
      onLeaked(id, kind);
      return;
    }
    s.dist = next;
    if (s.slow > 0) s.slow = Math.max(0, s.slow - dt);
  });

  return (
    <Entity x={x} y={y}>
      <AnimatedSprite
        sheet="enemies.png"
        frameWidth={14}
        frameHeight={14}
        animations={WALKS}
        animation={kind}
        flipX={at.dx < 0}
        originX={7}
        originY={7}
        tint={s.flash ? "#ffffff" : s.slow > 0 ? "#9ee7ff" : "#dcdcdc"}
      />
      {s.hp < maxHp && <HealthBar hp={s.hp} maxHp={maxHp} />}
      <Collider
        width={10}
        height={10}
        x={-5} y={-5}
        tag="enemy"
        layer="enemy"
        hits={["blast"]}
        data={{ id, dist: s.dist, x, y, hp: s.hp }}
        onCollisionEnter={(other) => {
          if (other.tag !== "blast") return;
          const blast = other.data;
          // A bolt hits its target only; a shell or a frost pulse everything within its radius.
          if (blast.target >= 0 ? blast.target !== id : Math.hypot(blast.x - x, blast.y - y) > blast.radius) return;
          s.hp -= blast.damage;
          // White for a moment: a timer, as the flash is only for the eye (a slow is gameplay, so it is state that counts down).
          cancelTimers();
          s.flash = true;
          after(FLASH, () => {
            s.flash = false;
          });
          if (blast.slow > 0) s.slow = Math.max(s.slow, blast.slow);
        }}
      />
    </Entity>
  );
}
