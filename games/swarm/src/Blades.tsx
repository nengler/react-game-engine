import { Collider, Entity, Sprite, useMutable, useUpdate } from "@tsengine/runtime/jsx";

import type { Build } from "./rules/upgrades.ts";
import { bladeStats } from "./rules/upgrades.ts";

interface BladesProps {
  build: Build;
  /** Where the player is (the blades are drawn around their own origin, inside the player's entity). */
  px: number;
  py: number;
}

/** Knives circling the player. Each is a collider: an enemy it passes through is hurt (`Enemy`'s `onCollisionEnter`), once a pass. */
export function Blades({ build, px, py }: BladesProps) {
  const s = useMutable({ angle: 0 });
  const b = bladeStats(build);

  useUpdate((dt) => {
    s.angle = (s.angle + (Math.PI * 2 * dt) / b.period) % (Math.PI * 2);
  });

  const blades: { id: number; x: number; y: number; turn: number }[] = [];
  for (let i = 0; i < b.count; i++) {
    const a = s.angle + (i * Math.PI * 2) / b.count;
    blades.push({ id: i, x: Math.cos(a) * b.radius, y: Math.sin(a) * b.radius, turn: a + Math.PI / 2 });
  }
  return (
    <Entity>
      {blades.map((blade) => (
        <Entity key={blade.id} x={blade.x} y={blade.y} rotation={blade.turn}>
          <Sprite image="sprites.png" frameWidth={16} frameHeight={16} frame={11} originX={8} originY={8} />
          <Collider
            width={10}
            height={10}
            x={-5}
            y={-5}
            tag="blade"
            layer="shot"
            hits={["enemy"]}
            data={{ damage: b.damage, x: px, y: py, knock: 90 }}
          />
        </Entity>
      ))}
    </Entity>
  );
}
