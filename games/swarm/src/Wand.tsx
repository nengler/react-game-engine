import { nearby, useMutable, useUpdate } from "@tsengine/runtime/jsx";

import { sfx } from "./effects.ts";
import type { Build } from "./rules/upgrades.ts";
import { wandStats } from "./rules/upgrades.ts";
import type { Bolt } from "./swarm.ts";

interface WandProps {
  build: Build;
  px: number;
  py: number;
  /** Bolts to put in the air (their ids are given by `Play`). */
  onFire: (bolts: Omit<Bolt, "id">[]) => void;
}

/** The wand: when it has cooled down it fires a bolt at each of the nearest enemies in range (more bolts as it levels). Draws nothing. */
export function Wand({ build, px, py, onFire }: WandProps) {
  const s = useMutable({ cooldown: 0.3 });

  useUpdate((dt) => {
    s.cooldown = Math.max(0, s.cooldown - dt);
    if (s.cooldown > 0) return;
    const w = wandStats(build);
    const targets = nearby("enemy", px, py, w.range);
    if (targets.length === 0) return;
    s.cooldown = w.cooldown;
    const bolts: Omit<Bolt, "id">[] = [];
    for (let i = 0; i < w.count; i++) {
      const t = targets[i % targets.length]!;
      const dx = t.x - px;
      const dy = t.y - py;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      bolts.push({ x: px, y: py, vx: (dx / d) * w.speed, vy: (dy / d) * w.speed, damage: w.damage, pierce: w.pierce });
    }
    sfx.play("shoot");
    onFire(bolts);
  });

  return null;
}
