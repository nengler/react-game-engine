import { Shape, send, useMutable, useUpdate } from "@tsengine/runtime/jsx";

import type { Build } from "./rules/upgrades.ts";
import { auraStats } from "./rules/upgrades.ts";
import { COLOR } from "./theme.ts";

interface AuraProps {
  build: Build;
  px: number;
  py: number;
}

/** A ring around the player that, every half second or so, hurts and shoves every enemy inside it (sent to them, `send`). */
export function Aura({ build, px, py }: AuraProps) {
  const s = useMutable({ timer: 0, pulse: 0 });
  const a = auraStats(build);

  useUpdate((dt) => {
    if (s.pulse > 0) s.pulse = Math.max(0, s.pulse - dt);
    s.timer += dt;
    if (s.timer < a.every) return;
    s.timer -= a.every;
    s.pulse = 0.15;
    send("enemy", { x: px, y: py, radius: a.radius }, { damage: a.damage, x: px, y: py, knock: 50 });
  });

  const r = a.radius * (1 + s.pulse * 0.4);
  return <Shape kind="circle" width={r * 2} height={r * 2} x={-r} y={-r} color={COLOR.aura} />;
}
