import { AnimatedSprite, Collider, Entity, useState, useUpdate } from "@rge/runtime/jsx";
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
  const [dist, setDist] = useState(0);
  const [hp, setHp] = useState(maxHp);
  const [slow, setSlow] = useState(0);
  const [flash, setFlash] = useState(0);
  const at = pathAt(MAP.path, dist);
  const x = at.x - at.dy * lane;
  const y = at.y + at.dx * lane;

  useUpdate((dt) => {
    if (hp <= 0) {
      onKilled(id, kind, x, y);
      return;
    }
    const next = dist + ENEMIES[kind].speed * (slow > 0 ? 1 - TOWERS.frost.slow : 1) * dt;
    if (next >= MAP.path.length) {
      onLeaked(id, kind);
      return;
    }
    setDist(next);
    if (slow > 0) setSlow(Math.max(0, slow - dt));
    if (flash > 0) setFlash(Math.max(0, flash - dt));
  });

  return (
    <Entity transform={{ x, y }}>
      <AnimatedSprite
        sheet="enemies.png"
        frameWidth={14}
        frameHeight={14}
        animations={WALKS}
        animation={kind}
        flipX={at.dx < 0}
        originX={7}
        originY={7}
        tint={flash > 0 ? "#ffffff" : slow > 0 ? "#9ee7ff" : "#dcdcdc"}
      />
      {hp < maxHp && <HealthBar hp={hp} maxHp={maxHp} />}
      <Collider
        width={10}
        height={10}
        transform={{ x: -5, y: -5 }}
        tag="enemy"
        layer="enemy"
        hits={["blast"]}
        data={{ id, dist, x, y, hp }}
        onCollisionEnter={(other) => {
          if (other.tag !== "blast") return;
          const blast = other.data;
          // A bolt hits its target only; a shell or a frost pulse everything within its radius.
          if (blast.target >= 0 ? blast.target !== id : Math.hypot(blast.x - x, blast.y - y) > blast.radius) return;
          setHp((left) => left - blast.damage);
          setFlash(FLASH);
          if (blast.slow > 0) setSlow((s) => Math.max(s, blast.slow));
        }}
      />
    </Entity>
  );
}
