import { AnimatedSprite, Entity } from "@rge/runtime/jsx";
import { HealthBar } from "./HealthBar.tsx";

interface EnemyProps {
  kind: "runner" | "grunt" | "brute";
  x: number;
  y: number;
  left: boolean;
  hp: number;
  maxHp: number;
  slow: number;
  flash: number;
}

/** One enemy: a four-frame walk facing the way it goes, white for a moment when hit, blue while slowed, a health bar once hurt. */
export function Enemy({ kind, x, y, left, hp, maxHp, slow, flash }: EnemyProps) {
  return (
    <Entity name="Enemy" transform={{ x, y }}>
      <AnimatedSprite
        sheet="enemies.png"
        frameWidth={14}
        frameHeight={14}
        animations={{ runner: { frames: "0-3", fps: 12 }, grunt: { frames: "4-7", fps: 8 }, brute: { frames: "8-11", fps: 5 } }}
        animation={kind}
        flipX={left}
        originX={7}
        originY={7}
        tint={flash > 0 ? "#ffffff" : slow > 0 ? "#9ee7ff" : "#dcdcdc"}
      />
      {hp < maxHp && <HealthBar hp={hp} maxHp={maxHp} />}
    </Entity>
  );
}
